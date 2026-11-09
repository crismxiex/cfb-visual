import { describe, it, expect } from 'vitest';
import { calculateLayout, layouts } from '../src/layout';
import { durableUrl, emptyDeck, normalizeUrl, provider, reconcile } from '../src/model';
import { createController } from '../src/controller';

function fixture() {
  let local:Record<string,any>={},session:Record<string,any>={};let serial=100;
  const calls:any[]=[];
  const tabs=new Map<number,any>([1,2,3,4].map(id=>[id,{id,windowId:1,index:id-1,title:`Game ${id}`,url:`https://example.com/game/${id}`,autoDiscardable:true,pinned:false,incognito:false,mutedInfo:{muted:false}}]));
  const windows=new Map<number,any>([[1,{id:1,type:'normal',state:'normal',focused:true,left:0,top:0,width:1200,height:800}]]);
  const displays=[{id:'left',isPrimary:true,name:'Viewing monitor',isEnabled:true,workArea:{left:-1920,top:-100,width:1920,height:1040},bounds:{left:-1920,top:-100,width:1920,height:1080}}];
  const withTabs=(w:any)=>({...w,tabs:[...tabs.values()].filter(t=>t.windowId===w.id)});
  const move=(tab:any,id:number)=>{const previous=tab.windowId;tab.windowId=id;if(![...tabs.values()].some(t=>t.windowId===previous))windows.delete(previous);};
  const area=(kind:'local'|'session')=>({get:async()=>structuredClone(kind==='local'?local:session),set:async(value:any)=>{calls.push(['save',kind]);if(kind==='local')Object.assign(local,structuredClone(value));else Object.assign(session,structuredClone(value));}});
  const api:any={
    runtime:{id:'gamedeck-test'},
    storage:{local:area('local'),session:area('session')},system:{display:{getInfo:async()=>structuredClone(displays)}},
    tabs:{
      query:async(q:any)=>structuredClone([...tabs.values()].filter(t=>q.windowId==null||t.windowId===q.windowId)),
      get:async(id:number)=>{if(!tabs.has(id))throw new Error('Tab closed');return structuredClone(tabs.get(id));},
      reload:async(id:number)=>{if(!tabs.has(id))throw new Error('Tab closed');calls.push(['tabs.reload',id]);},
      update:async(id:number,props:any)=>{calls.push(['tabs.update',id,props]);if(!tabs.has(id))throw new Error('Tab closed');const {muted,...rest}=props;Object.assign(tabs.get(id),rest);if(muted!==undefined)tabs.get(id).mutedInfo={muted,reason:'extension',extensionId:'gamedeck-test'};return structuredClone(tabs.get(id));},
      move:async(id:number,props:any)=>{calls.push(['tabs.move',id,props]);const t=tabs.get(id);if(windows.get(t.windowId)?.type!=='normal'||windows.get(props.windowId)?.type!=='normal')throw new Error('Only normal windows can use tabs.move');move(t,props.windowId);t.index=props.index;return structuredClone(t);},
      remove:async(id:number)=>{calls.push(['tabs.remove',id]);tabs.delete(id);},
    },
    windows:{
      getAll:async()=>structuredClone([...windows.values()].map(withTabs)),
      get:async(id:number)=>{if(!windows.has(id))throw new Error('Window closed');return structuredClone(withTabs(windows.get(id)));},
      create:async(props:any)=>{calls.push(['windows.create',props]);const id=serial++;const win={id,state:'normal',left:20,top:20,width:800,height:600,...props};windows.set(id,win);if(props.tabId){if(!tabs.has(props.tabId))throw new Error('No tab');move(tabs.get(props.tabId),id);}else{const tabId=serial++;tabs.set(tabId,{id:tabId,windowId:id,index:0,title:'New game',url:props.url,autoDiscardable:true});}return structuredClone(withTabs(win));},
      update:async(id:number,props:any)=>{calls.push(['windows.update',id,props]);if(!windows.has(id))throw new Error('Window closed');if(props.state&&Object.keys(props).some(k=>['left','top','width','height'].includes(k)))throw new Error('Cannot combine state and bounds');Object.assign(windows.get(id),props);return structuredClone(withTabs(windows.get(id)));},
    },
  };
  return {api,tabs,windows,calls,displays,controller:createController(api),get local(){return local;},get session(){return session;},restartBrowser(){session={};},async add(id:number){return this.controller.request({type:'ADD_TAB',tabId:id});}};
}

describe('Command Center player volume',()=>{
  function players(f:ReturnType<typeof fixture>,granted=true){
    const states=new Map([[1,{available:true,volume:.25,muted:true,status:''}],[2,{available:true,volume:.8,muted:false,status:''}]]);
    f.api.permissions={contains:async()=>granted};
    f.api.scripting={executeScript:async(p:any)=>{
      if(p.args.includes(undefined))throw new TypeError('Value is unserializable');
      f.calls.push(['player',p.target.tabId,...p.args]);const state=states.get(p.target.tabId)!;
      const [action,volume]=p.args;
      if(action==='listen'){state.volume=volume>0?volume:state.volume||.5;state.muted=false;}
      if(action==='volume'){state.volume=volume;state.muted=volume===0;}
      return [{frameId:0,result:{...state}}];
    }};
    for(const id of [1,2])f.tabs.get(id).url='https://www.dazn.com/watch/'+id;
    return states;
  }
  it('reads Disney+ player volume without an undefined script argument',async()=>{
    const f=fixture();
    const media=players(f);
    f.tabs.get(1).url='https://www.disneyplus.com/watch/game';
    const added=await f.add(1);
    const key=added.deck.games[0].key;
    media.get(1)!.muted=true;
    const result=await f.controller.request({type:'AUDIO_STATUS'});
    expect(result.runtime.bindings[key].playerAudio).toMatchObject({available:true,volume:.25,muted:true});
    expect(f.calls).toContainEqual(['player',1,'read']);
    expect(media.get(1)?.muted).toBe(true);
  });
  it('unmutes the chosen player before its tab, after muting other games, without moving windows',async()=>{
    const f=fixture();const media=players(f);await f.add(1);const v=await f.add(2);media.get(2)!.muted=true;f.calls.length=0;
    const r=await f.controller.request({type:'SELECT',key:v.deck.games[1].key});
    expect(media.get(2)!.muted).toBe(false);expect(r.runtime.bindings[v.deck.games[1].key].playerAudio?.volume).toBe(.8);
    const mute=f.calls.findIndex(c=>c[0]==='tabs.update'&&c[1]===1&&c[2].muted===true),player=f.calls.findIndex(c=>c[0]==='player'&&c[1]===2),unmute=f.calls.findIndex(c=>c[0]==='tabs.update'&&c[1]===2&&c[2].muted===false);
    expect(player).toBeGreaterThan(mute);expect(unmute).toBeGreaterThan(player);expect(f.calls.some(c=>c[0].startsWith('windows.'))).toBe(false);
  });
  it('restores the last audible level after zero volume, even when only the player is muted',async()=>{
    const f=fixture();players(f);const v=await f.add(1),key=v.deck.games[0].key;
    await f.controller.request({type:'SET_VOLUME',key,volume:.37});await f.controller.request({type:'SET_VOLUME',key,volume:0});
    const r=await f.controller.request({type:'TOGGLE_MUTE',key});expect(r.runtime.bindings[key].playerAudio).toMatchObject({volume:.37,muted:false});expect(f.tabs.get(1).mutedInfo.muted).toBe(false);
  });
  it('changing a secondary volume preserves exclusive selection and geometry; choices survive restart',async()=>{
    const f=fixture();players(f);await f.add(1);const v=await f.add(2),key=v.deck.games[1].key;f.calls.length=0;
    const changed=await f.controller.request({type:'SET_VOLUME',key,volume:.42});expect(changed.runtime.audio.key).toBe(v.runtime.audio.key);expect(f.tabs.get(2).mutedInfo.muted).toBe(true);expect(f.calls.some(c=>c[0].startsWith('windows.'))).toBe(false);
    const restarted=createController(f.api);const r=await restarted.request({type:'LISTEN',key});expect(r.runtime.bindings[key].playerAudio?.volume).toBe(.42);expect(f.local.gamedeck.games[1].volume).toBe(.42);
  });
  it('does not inject without optional access and keeps ordinary tab selection working',async()=>{
    const f=fixture();players(f,false);const v=await f.add(1),key=v.deck.games[0].key;f.calls.length=0;
    const r=await f.controller.request({type:'LISTEN',key});expect(r.runtime.audio.key).toBe(key);expect(f.calls.some(c=>c[0]==='player')).toBe(false);expect(r.runtime.bindings[key].playerAudio?.available).toBe(false);
    await expect(f.controller.request({type:'SET_VOLUME',key,volume:.5})).rejects.toThrow(/Enable volume controls/);
  });
  it('reports missing players, validates requests and keeps mute-all silent after a volume change',async()=>{
    const f=fixture();players(f);const v=await f.add(1),key=v.deck.games[0].key;
    for(const volume of [-1,NaN,2,'0.5'])await expect(f.controller.request({type:'SET_VOLUME',key,volume})).rejects.toThrow(/0 to 100/);
    await f.controller.request({type:'MUTE_ALL'});const r=await f.controller.request({type:'SET_VOLUME',key,volume:.9});expect(r.runtime.audio.mode).toBe('silent');expect(f.tabs.get(1).mutedInfo.muted).toBe(true);
    f.api.scripting.executeScript=async()=>[{result:{available:false,status:'Start playback first.'}}];await expect(f.controller.request({type:'SET_VOLUME',key,volume:.5})).rejects.toThrow(/Start playback/);
  });
});

describe('display-aware layout engine',()=>{
  for(const l of layouts) it(`${l.id} stays inside a negative-origin work area without overlap`,()=>{
    const area={left:-2560,top:-200,width:2560,height:1400};const rects=calculateLayout(area,l.id,8);
    expect(rects.length).toBe(l.id==='custom'?4:l.capacity);
    for(const r of rects){expect(Number.isInteger(r.left)).toBe(true);expect(r.left).toBeGreaterThanOrEqual(area.left);expect(r.top).toBeGreaterThanOrEqual(area.top);expect(r.left+r.width).toBeLessThanOrEqual(area.left+area.width);expect(r.top+r.height).toBeLessThanOrEqual(area.top+area.height);}
    for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length;j++){const a=rects[i],b=rects[j];expect(a.left+a.width<=b.left||b.left+b.width<=a.left||a.top+a.height<=b.top||b.top+b.height<=a.top).toBe(true);}
  });
  it('uses a portrait 2 by 3 six-game grid',()=>{const r=calculateLayout({left:0,top:0,width:1200,height:1900},'six-grid');expect(new Set(r.map(r=>r.left)).size).toBe(2);expect(new Set(r.map(r=>r.top)).size).toBe(3);});
  it('uses 65% main width with two vertically stacked secondary windows',()=>{const r=calculateLayout({left:0,top:0,width:1920,height:1040},'three-main');expect(r[0].width).toBeGreaterThan(1200);expect(r[1].left).toBe(r[2].left);expect(r[2].top).toBeGreaterThan(r[1].top);});
  it('rejects undersized and nonfinite areas and invalid custom grids',()=>{expect(()=>calculateLayout({left:0,top:0,width:600,height:400},'four-main')).toThrow(/too small/);expect(()=>calculateLayout({left:NaN,top:0,width:800,height:600},'single')).toThrow();expect(()=>calculateLayout({left:0,top:0,width:1920,height:1080},'custom',8,{rows:4,columns:2})).toThrow();});
  it('handles odd pixel dimensions exactly',()=>{const r=calculateLayout({left:-123,top:17,width:1919,height:1039},'six-grid',7);expect(r[5].left+r[5].width).toBe(1796);expect(r[5].top+r[5].height).toBe(1056);});
});
describe('URL validation and identity',()=>{
  it('normalizes and rejects privileged URLs or embedded credentials',()=>{expect(normalizeUrl(' ESPN.com/watch ')).toBe('https://espn.com/watch');for(const s of ['http://espn.com','chrome://settings','javascript:alert(1)','https://user:pass@espn.com','not a url'])expect(()=>normalizeUrl(s)).toThrow();});
  it('removes recognized credential parameters before persistence',()=>expect(durableUrl('https://espn.com/watch?id=1&access_token=secret&signature=secret#token=secret')).toBe('https://espn.com/watch?id=1'));
  it('does not confuse provider lookalike domains',()=>{expect(provider('https://dazn.com.evil.test')).toBe('dazn.com.evil.test');expect(provider('https://plus.espn.com')).toBe('ESPN');});
  it('reconciles repeated URLs one to one, preserving a known tab identity first',()=>{
    const f=fixture();f.tabs.get(2).url=f.tabs.get(1).url;const games=[{key:'new',url:f.tabs.get(1).url,title:'new',slot:0},{key:'known',url:f.tabs.get(1).url,title:'known',slot:1}];
    const binding:any={tabId:1,windowId:1,managed:false};const r=reconcile(games,[...f.tabs.values()],[...f.windows.values()],{known:binding});expect(r.known.tabId).toBe(1);expect(r.new.tabId).toBe(2);
  });
});
describe('real-window orchestration contract',()=>{
  it('reloads the requested tab in place and keeps the lineup and audio selection',async()=>{
    const f=fixture();
    await f.add(1);
    const before=await f.add(2);
    const key=before.deck.games[1].key;
    f.calls.length=0;
    const after=await f.controller.request({type:'RELOAD_TAB',key});
    expect(f.calls.filter(([name])=>name.startsWith('tabs.')||name.startsWith('windows.'))).toEqual([['tabs.reload',2]]);
    expect(after.deck).toEqual(before.deck);
    expect(after.runtime.bindings[key]).toEqual(before.runtime.bindings[key]);
    expect(after.runtime.audio).toEqual(before.runtime.audio);

    f.tabs.delete(2);
    f.calls.length=0;
    await expect(f.controller.request({type:'RELOAD_TAB',key})).rejects.toThrow(/unavailable/);
    expect(f.calls.some(([name])=>name==='tabs.reload')).toBe(false);
  });
  it('adopts the exact existing tab and swaps geometry without navigation or recreation',async()=>{
    const f=fixture();await f.add(1);const v=await f.add(2);f.calls.length=0;
    const result=await f.controller.request({type:'SWAP',key:v.deck.games[1].key,other:v.deck.games[0].key});
    expect(result.deck.games[0].title).toBe('Game 2');expect(f.calls.filter(c=>c[0]==='windows.create')).toHaveLength(0);expect(f.calls.filter(c=>c[0]==='tabs.update').every(c=>!('url'in c[2]))).toBe(true);expect(f.calls.filter(c=>c[0]==='windows.update').every(c=>!c[2].focused)).toBe(true);
    expect(Object.values(result.runtime.bindings).map(b=>b.tabId).sort()).toEqual([1,2]);
  });
  it('prefers an existing matching URL and rejects duplicate additions',async()=>{const f=fixture();await f.controller.request({type:'ADD_URL',url:'https://example.com/game/1'});await f.add(1);expect((await f.controller.request({type:'GET'})).deck.games).toHaveLength(1);expect(f.calls.filter(c=>c[0]==='windows.create'&&c[1].url)).toHaveLength(0);});
  it('opens a new URL once in the current profile',async()=>{const f=fixture();await f.controller.request({type:'ADD_URL',url:'https://example.com/new'});await f.controller.request({type:'ADD_URL',url:'https://example.com/new'});expect(f.calls.filter(c=>c[0]==='windows.create'&&c[1].url)).toHaveLength(1);expect([...f.tabs.values()].filter(t=>t.url==='https://example.com/new')).toHaveLength(1);});
  it('persists no runtime tab/window IDs in durable state',async()=>{const f=fixture();await f.add(1);expect(JSON.stringify(f.local)).not.toMatch(/tabId|windowId|originalWindowId/);expect(f.session.gamedeck.bindings).toBeDefined();});
  it('reconnects new IDs after restart and does not open missing streams',async()=>{const f=fixture();const v=await f.add(1);f.tabs.delete(1);f.tabs.set(55,{id:55,windowId:1,index:0,title:'Restored',url:v.deck.games[0].url});f.restartBrowser();f.calls.length=0;const c=createController(f.api);const r=await c.request({type:'GET'});expect(r.runtime.bindings[v.deck.games[0].key].tabId).toBe(55);f.tabs.delete(55);const missing=await c.request({type:'STARTUP'});expect(missing.deck.games).toHaveLength(1);expect(Object.keys(missing.runtime.bindings)).toHaveLength(0);expect(f.calls.filter(c=>c[0]==='windows.create')).toHaveLength(0);});
  it('GET is read-only after initialization, preventing storage event loops',async()=>{const f=fixture();await f.controller.request({type:'GET'});f.calls.length=0;await f.controller.request({type:'GET'});expect(f.calls).toEqual([]);});
  it('reconciles manual tab moves and leaves unrelated tabs in place',async()=>{const f=fixture();const v=await f.add(1);f.windows.set(200,{id:200,type:'normal',left:0,top:0,width:1000,height:800});f.tabs.get(1).windowId=200;f.tabs.set(77,{id:77,windowId:200,index:1,url:'https://example.com/unrelated'});await f.controller.request({type:'APPLY'});expect(f.tabs.get(77).windowId).toBe(200);expect(f.tabs.get(1).windowId).not.toBe(200);expect((await f.controller.request({type:'GET'})).runtime.bindings[v.deck.games[0].key].tabId).toBe(1);});
  it('rejects too-small capacity before changing any windows',async()=>{const f=fixture();await f.add(1);await f.add(2);f.calls.length=0;await expect(f.controller.request({type:'LAYOUT',layout:'single'})).rejects.toThrow(/too few/);expect(f.calls.filter(c=>c[0]==='windows.update')).toHaveLength(0);});
  it('serializes concurrent additions and promotions',async()=>{const f=fixture();await Promise.all([f.add(1),f.add(2),f.add(3)]);const v=await f.controller.request({type:'GET'});await Promise.all(v.deck.games.map(g=>f.controller.request({type:'PROMOTE',key:g.key})));const r=await f.controller.request({type:'GET'});expect(r.deck.games[0].key).toBe(v.deck.games[2].key);expect(new Set(Object.values(r.runtime.bindings).map(b=>b.windowId)).size).toBe(3);});
  it('does not close a tab when removing a game',async()=>{const f=fixture();const v=await f.add(1);await f.controller.request({type:'REMOVE',key:v.deck.games[0].key});expect(f.tabs.has(1)).toBe(true);expect(f.calls.some(c=>c[0]==='tabs.remove')).toBe(false);expect(f.tabs.get(1).autoDiscardable).toBe(true);});
  it('returns a popup tab through a normal window safely',async()=>{const f=fixture();const v=await f.add(1);await f.controller.request({type:'RETURN_TAB',key:v.deck.games[0].key});expect(f.tabs.get(1).windowId).toBe(1);expect(f.windows.get(1).type).toBe('normal');expect(f.calls.some(c=>c[0]==='tabs.move')).toBe(true);});
  it('explicit close is a separate command',async()=>{const f=fixture();const v=await f.add(1);await f.controller.request({type:'CLOSE_GAME',key:v.deck.games[0].key});expect(f.tabs.has(1)).toBe(false);});
  it('restores minimized windows before applying geometry',async()=>{const f=fixture();const v=await f.add(1);const b=v.runtime.bindings[v.deck.games[0].key];await f.controller.request({type:'MINIMIZE',key:v.deck.games[0].key});expect(f.windows.get(b.windowId).state).toBe('minimized');await f.controller.request({type:'RESTORE_ALL'});expect(f.windows.get(b.windowId).state).toBe('normal');});
  it('disconnected displays produce an actionable error without relocating games',async()=>{const f=fixture();await f.add(1);f.displays.length=0;f.calls.length=0;await expect(f.controller.request({type:'APPLY'})).rejects.toThrow(/disconnected/);expect(f.calls.filter(c=>c[0]==='windows.update')).toHaveLength(0);});
  it('saves and restores preset order without new tabs',async()=>{const f=fixture();await f.add(1);const v=await f.add(2);const saved=await f.controller.request({type:'SAVE_PRESET',name:'Saturday'});await f.controller.request({type:'PROMOTE',key:v.deck.games[1].key});f.calls.length=0;const r=await f.controller.request({type:'LOAD_PRESET',id:saved.deck.presets[0].id});expect(r.deck.games[0].key).toBe(v.deck.games[0].key);expect(f.calls.some(c=>c[0]==='windows.create')).toBe(false);});
  it('survives a service worker restart with managed identities intact',async()=>{const f=fixture();const v=await f.add(1);const c=createController(f.api);f.calls.length=0;const r=await c.request({type:'APPLY'});expect(r.runtime.bindings).toEqual(v.runtime.bindings);expect(f.calls.some(c=>c[0]==='windows.create')).toBe(false);});
  it('moves into an empty slot and preserves that assignment through worker restarts',async()=>{const f=fixture();const v=await f.add(1);const moved=await f.controller.request({type:'MOVE_SLOT',key:v.deck.games[0].key,slot:2});expect(moved.deck.games[0].slot).toBe(2);const c=createController(f.api);expect((await c.request({type:'GET'})).deck.games[0].slot).toBe(2);await c.request({type:'PROMOTE',key:v.deck.games[0].key});expect((await c.request({type:'GET'})).deck.games[0].slot).toBe(0);});
  it('saves custom grid geometry, gaps and sparse positions in presets',async()=>{const f=fixture();await f.add(1);await f.controller.request({type:'LAYOUT',layout:'custom',custom:{columns:3,rows:2}});await f.controller.request({type:'GAP',gap:8});const v=await f.controller.request({type:'GET'});await f.controller.request({type:'MOVE_SLOT',key:v.deck.games[0].key,slot:5});const saved=await f.controller.request({type:'SAVE_PRESET',name:'Custom'});await f.controller.request({type:'LAYOUT',layout:'single'});const restored=await f.controller.request({type:'LOAD_PRESET',id:saved.deck.presets[0].id});expect(restored.deck.custom).toEqual({columns:3,rows:2});expect(restored.deck.gap).toBe(8);expect(restored.deck.games[0].slot).toBe(5);});
  it('reports operating system bounds adjustments',async()=>{const f=fixture();const original=f.api.windows.create;f.api.windows.create=async(p:any)=>{const w=await original(p);f.windows.get(w.id).width+=40;return w;};const v=await f.add(1);expect(v.runtime.warnings[0]).toMatch(/adjusted/);});
  it('does not rearrange games when an unrelated tab closes',async()=>{const f=fixture();await f.add(1);f.calls.length=0;await f.controller.request({type:'TAB_CLOSED',tabId:999});expect(f.calls.some(c=>c[0]==='windows.update')).toBe(false);});
  it('reserves a surviving exact identity before matching a stale same-URL binding',()=>{const f=fixture();f.tabs.get(2).url=f.tabs.get(1).url;const games=[{key:'stale',url:f.tabs.get(1).url,title:'stale',slot:0},{key:'live',url:f.tabs.get(1).url,title:'live',slot:1}];const r=reconcile(games,[...f.tabs.values()],[...f.windows.values()],{stale:{tabId:99} as any,live:{tabId:1,windowId:1} as any});expect(r.live.tabId).toBe(1);expect(r.stale.tabId).toBe(2);});
  it('retains a successfully adopted tab when a later geometry update fails',async()=>{const f=fixture();const v=await f.add(1);const create=f.api.windows.create;f.api.windows.create=async(p:any)=>{if(p.tabId===2)throw new Error('Window creation denied');return create(p);};await expect(f.add(2)).rejects.toThrow(/denied/);const r=await f.controller.request({type:'GET'});expect(r.runtime.bindings[v.deck.games[0].key].tabId).toBe(1);expect(r.deck.games).toHaveLength(2);expect(r.runtime.warnings[0]).toMatch(/denied/);});
});



describe('GameDeck audio controls',()=>{
  it('mutes other managed tabs before enabling the selected game, without touching unrelated tabs',async()=>{
    const f=fixture();await f.add(1);const v=await f.add(2);f.calls.length=0;
    await f.controller.request({type:'LISTEN',key:v.deck.games[1].key});
    const audio=f.calls.filter(c=>c[0]==='tabs.update'&&'muted'in c[2]);
    expect(audio).toEqual([['tabs.update',1,{muted:true}],['tabs.update',2,{muted:false}]]);
    expect(f.tabs.get(3).mutedInfo.muted).toBe(false);
    expect(f.calls.some(c=>c[0]==='windows.update'||c[0]==='windows.create')).toBe(false);
  });
  it('mute all and individual toggles use actual Chrome mute state',async()=>{
    const f=fixture();await f.add(1);const v=await f.add(2);await f.controller.request({type:'MUTE_ALL'});
    expect(f.tabs.get(1).mutedInfo.muted).toBe(true);expect(f.tabs.get(2).mutedInfo.muted).toBe(true);
    await f.controller.request({type:'TOGGLE_MUTE',key:v.deck.games[1].key});expect(f.tabs.get(2).mutedInfo.muted).toBe(false);
    f.tabs.get(2).mutedInfo.muted=true;await f.controller.request({type:'TOGGLE_MUTE',key:v.deck.games[1].key});expect(f.tabs.get(2).mutedInfo.muted).toBe(false);
  });
  it('waits for slow mute operations before unmuting the new source',async()=>{
    const f=fixture();await f.add(1);const v=await f.add(2);const update=f.api.tabs.update;let finished=false;
    f.api.tabs.update=async(id:number,p:any)=>{if(id===1&&p.muted===true){await new Promise(r=>setTimeout(r,15));finished=true;}if(id===2&&p.muted===false)expect(finished).toBe(true);return update(id,p);};
    await f.controller.request({type:'LISTEN',key:v.deck.games[1].key});expect(finished).toBe(true);
  });
  it('does not enable a target if muting another managed tab fails',async()=>{
    const f=fixture();await f.add(1);const v=await f.add(2);f.tabs.get(2).mutedInfo.muted=true;const update=f.api.tabs.update;
    f.api.tabs.update=async(id:number,p:any)=>{if(id===1&&p.muted===true)throw new Error('Mute blocked');return update(id,p);};
    await expect(f.controller.request({type:'LISTEN',key:v.deck.games[1].key})).rejects.toThrow('Mute blocked');expect(f.tabs.get(2).mutedInfo.muted).toBe(true);
  });
  it('rejects unavailable audio targets before changing other tabs',async()=>{
    const f=fixture();await f.add(1);f.calls.length=0;await expect(f.controller.request({type:'LISTEN',key:'missing'})).rejects.toThrow(/unavailable/);expect(f.calls.some(c=>c[0]==='tabs.update')).toBe(false);
  });
  it('keeps newly added games muted in solo or silent mode',async()=>{
    const f=fixture();const v=await f.add(1);await f.controller.request({type:'LISTEN',key:v.deck.games[0].key});await f.add(2);
    expect(f.tabs.get(1).mutedInfo.muted).toBe(false);expect(f.tabs.get(2).mutedInfo.muted).toBe(true);
    await f.controller.request({type:'MUTE_ALL'});await f.add(3);expect(f.tabs.get(3).mutedInfo.muted).toBe(true);
  });
  it('preserves audio across promotion, layout changes and worker restart',async()=>{
    const f=fixture();await f.add(1);const v=await f.add(2);await f.controller.request({type:'LISTEN',key:v.deck.games[1].key});
    const c=createController(f.api);await c.request({type:'PROMOTE',key:v.deck.games[0].key});await c.request({type:'LAYOUT',layout:'two-equal'});
    expect(f.tabs.get(1).mutedInfo.muted).toBe(true);expect(f.tabs.get(2).mutedInfo.muted).toBe(false);expect((await c.request({type:'GET'})).runtime.audio).toEqual({mode:'solo',key:v.deck.games[1].key});
  });
  it('restores originally muted and unmuted states on removal or tab return',async()=>{
    const f=fixture();f.tabs.get(2).mutedInfo.muted=true;await f.add(1);const v=await f.add(2);await f.controller.request({type:'LISTEN',key:v.deck.games[1].key});
    await f.controller.request({type:'REMOVE',key:v.deck.games[0].key});expect(f.tabs.get(1).mutedInfo.muted).toBe(false);
    await f.controller.request({type:'RETURN_TAB',key:v.deck.games[1].key});expect(f.tabs.get(2).mutedInfo.muted).toBe(true);
  });
  it('serializes competing audio selections so the final request wins',async()=>{
    const f=fixture();await f.add(1);const v=await f.add(2);await Promise.all([1,0,1,0].map(i=>f.controller.request({type:'LISTEN',key:v.deck.games[i].key})));
    expect(f.tabs.get(1).mutedInfo.muted).toBe(false);expect(f.tabs.get(2).mutedInfo.muted).toBe(true);
  });
  it('supports sessions created before audio controls existed',async()=>{
    const f=fixture();const v=await f.add(1);delete f.session.gamedeck.audio;delete f.session.gamedeck.bindings[v.deck.games[0].key].originalMuted;
    const c=createController(f.api);await c.request({type:'MUTE_ALL'});await c.request({type:'REMOVE',key:v.deck.games[0].key});expect(f.tabs.get(1).mutedInfo.muted).toBe(false);
  });
});


describe('one-click control room acceptance',()=>{
  async function four(){const f=fixture();await f.controller.request({type:'LAYOUT',layout:'four-main'});for(const id of [1,2,3,4])await f.add(id);return f;}
  const audioFlags=(f:ReturnType<typeof fixture>)=>[1,2,3,4].map(id=>f.tabs.get(id)?.mutedInfo?.muted);
  it('Test 1: tile selection changes only audio and never moves, focuses or navigates windows',async()=>{
    const f=await four();const v=await f.controller.request({type:'GET'});expect(audioFlags(f)).toEqual([false,true,true,true]);f.calls.length=0;
    const r=await f.controller.request({type:'SELECT',key:v.deck.games[2].key});expect(audioFlags(f)).toEqual([true,true,false,true]);expect(r.runtime.audio.key).toBe(v.deck.games[2].key);expect(r.deck.games).toEqual(v.deck.games);
    expect(f.calls.filter(c=>c[0].startsWith('windows.'))).toEqual([]);expect(f.calls.filter(c=>c[0]==='tabs.update').every(c=>Object.keys(c[2]).join()==='muted')).toBe(true);
  });
  it('Test 2: promotion switches audio before the first geometry update',async()=>{
    const f=await four();const v=await f.controller.request({type:'GET'});await f.controller.request({type:'SELECT',key:v.deck.games[2].key});f.calls.length=0;
    const r=await f.controller.request({type:'PROMOTE',key:v.deck.games[1].key});expect(r.deck.games[0].key).toBe(v.deck.games[1].key);expect(audioFlags(f)).toEqual([true,false,true,true]);
    const unmute=f.calls.findIndex(c=>c[0]==='tabs.update'&&c[1]===2&&c[2].muted===false);const geometry=f.calls.findIndex(c=>c[0]==='windows.update');expect(unmute).toBeGreaterThanOrEqual(0);expect(unmute).toBeLessThan(geometry);
  });
  it('Test 3: dragging into slot zero promotes and selects that game, secondary swaps preserve audio',async()=>{
    const f=await four();const v=await f.controller.request({type:'GET'});const r=await f.controller.request({type:'MOVE_SLOT',key:v.deck.games[3].key,slot:0});expect(r.deck.games[0].key).toBe(v.deck.games[3].key);expect(audioFlags(f)).toEqual([true,true,true,false]);
    await f.controller.request({type:'SWAP',key:v.deck.games[1].key,other:v.deck.games[2].key});expect(audioFlags(f)).toEqual([true,true,true,false]);
  });
  it('Test 4: grid changes preserve secondary override when the main identity is unchanged',async()=>{
    const f=await four();const v=await f.controller.request({type:'GET'});await f.controller.request({type:'SELECT',key:v.deck.games[2].key});await f.controller.request({type:'LAYOUT',layout:'four-grid'});expect(audioFlags(f)).toEqual([true,true,false,true]);
    const r=await f.controller.request({type:'GET'});expect(r.deck.gap).toBe(0);for(const game of r.deck.games){const w=f.windows.get(r.runtime.bindings[game.key].windowId);expect(w.width).toBe(960);expect(w.height).toBe(520);}
  });
  it('Test 5: closing active secondary falls back to available main without stale IDs',async()=>{
    const f=await four();const v=await f.controller.request({type:'GET'});await f.controller.request({type:'SELECT',key:v.deck.games[2].key});f.tabs.delete(3);
    const r=await f.controller.request({type:'TAB_CLOSED',tabId:3});expect(r.runtime.bindings[v.deck.games[2].key]).toBeUndefined();expect(r.runtime.audio.key).toBe(v.deck.games[0].key);expect(f.tabs.get(1).mutedInfo.muted).toBe(false);
  });
  it('closing an unavailable main audio source enters a clear silent state',async()=>{
    const f=await four();f.tabs.delete(1);const r=await f.controller.request({type:'TAB_CLOSED',tabId:1});expect(r.runtime.audio).toEqual({mode:'silent',key:null});expect([2,3,4].every(id=>f.tabs.get(id).mutedInfo.muted)).toBe(true);
  });
  it('Follow main can be disabled without losing single-source audio',async()=>{
    const f=await four();const v=await f.controller.request({type:'GET'});await f.controller.request({type:'AUDIO_FOLLOWS_MAIN',enabled:false});await f.controller.request({type:'SELECT',key:v.deck.games[2].key});await f.controller.request({type:'PROMOTE',key:v.deck.games[1].key});expect(audioFlags(f)).toEqual([true,true,false,true]);
  });
  it('manual mute enters silence without fighting the user or repeated writes',async()=>{
    const f=await four();f.tabs.get(1).mutedInfo={muted:true,reason:'user'};f.calls.length=0;await f.controller.request({type:'AUDIO_CHANGED',tabId:1,mutedInfo:f.tabs.get(1).mutedInfo});await f.controller.request({type:'GET'});expect(f.calls.filter(c=>c[0]==='tabs.update')).toEqual([]);expect((await f.controller.request({type:'GET'})).runtime.audio.mode).toBe('silent');
  });
  it('manual unmute selects that managed game and ignores our own delayed events',async()=>{
    const f=await four();const v=await f.controller.request({type:'GET'});f.tabs.get(3).mutedInfo={muted:false,reason:'user'};
    await f.controller.request({type:'AUDIO_CHANGED',tabId:3,mutedInfo:f.tabs.get(3).mutedInfo});expect(audioFlags(f)).toEqual([true,true,false,true]);f.calls.length=0;
    await f.controller.request({type:'AUDIO_CHANGED',tabId:1,mutedInfo:{muted:false,reason:'extension',extensionId:'gamedeck-test'}});expect(f.calls.filter(c=>c[0]==='tabs.update')).toEqual([]);expect((await f.controller.request({type:'GET'})).runtime.audio.key).toBe(v.deck.games[2].key);
  });
  it('disabling management restores originals and preserves newer manual choices',async()=>{
    const f=await four();f.tabs.get(1).mutedInfo={muted:true,reason:'user'};await f.controller.request({type:'AUDIO_CHANGED',tabId:1,mutedInfo:f.tabs.get(1).mutedInfo});await f.controller.request({type:'AUDIO_ENABLED',enabled:false});expect(f.tabs.get(1).mutedInfo.muted).toBe(true);expect([2,3,4].every(id=>!f.tabs.get(id).mutedInfo.muted)).toBe(true);
    f.calls.length=0;const v=await f.controller.request({type:'GET'});await f.controller.request({type:'SELECT',key:v.deck.games[1].key});expect(f.calls.filter(c=>c[0]==='tabs.update')).toEqual([]);
  });
  it('replacement tabs retain stable audio/game identity',async()=>{
    const f=await four();const v=await f.controller.request({type:'GET'});const old=f.tabs.get(1);f.tabs.delete(1);f.tabs.set(99,{...old,id:99});const r=await f.controller.request({type:'TAB_REPLACED',removedTabId:1,addedTabId:99});expect(r.runtime.bindings[v.deck.games[0].key].tabId).toBe(99);expect(r.runtime.audio.key).toBe(v.deck.games[0].key);expect(f.tabs.get(99).mutedInfo.muted).toBe(false);
  });
  for(const restart of [false,true])it(`unmutes a muted replacement of the active source${restart?' after worker restart':''}`,async()=>{
    const f=await four();const v=await f.controller.request({type:'GET'}),key=v.deck.games[0].key;
    const old=f.tabs.get(1);f.tabs.delete(1);f.tabs.set(99,{...old,id:99,mutedInfo:{muted:true}});
    const r=await (restart?createController(f.api):f.controller).request({type:'TAB_REPLACED',removedTabId:1,addedTabId:99});
    expect(r.runtime.audio).toEqual({mode:'solo',key});expect(f.tabs.get(99).mutedInfo.muted).toBe(false);expect([2,3,4].every(id=>f.tabs.get(id).mutedInfo.muted)).toBe(true);
  });
  it('Fill entire display uses full bounds while Respect taskbar uses work area',async()=>{
    const f=await four();const r=await f.controller.request({type:'DISPLAY_MODE',mode:'full'});for(const game of r.deck.games){const win=f.windows.get(r.runtime.bindings[game.key].windowId);expect(win.top+win.height).toBeLessThanOrEqual(980);}expect(f.windows.get(r.runtime.bindings[r.deck.games[0].key].windowId).height).toBe(1080);
    const back=await f.controller.request({type:'DISPLAY_MODE',mode:'workArea'});expect(f.windows.get(back.runtime.bindings[back.deck.games[0].key].windowId).height).toBe(1040);
  });
  it('supports only the requested gap settings',async()=>{const f=await four();for(const gap of [0,2,4,8])expect((await f.controller.request({type:'GAP',gap})).deck.gap).toBe(gap);await expect(f.controller.request({type:'GAP',gap:16})).rejects.toThrow(/0, 2, 4, or 8/);});
  it('exactly tiles the requested 1920 by 1032 work area',()=>{const r=calculateLayout({left:0,top:0,width:1920,height:1032},'four-main');expect(r).toEqual([{left:0,top:0,width:1248,height:1032},{left:1248,top:0,width:672,height:344},{left:1248,top:344,width:672,height:344},{left:1248,top:688,width:672,height:344}]);});
  it('has exact shared edges on fractional-DPI-sized odd work areas',()=>{const a={left:-1537,top:-101,width:1919,height:1031};const r=calculateLayout(a,'four-main');expect(r.reduce((sum,v)=>sum+v.width*v.height,0)).toBe(a.width*a.height);expect(r[1].top+r[1].height).toBe(r[2].top);expect(r[2].top+r[2].height).toBe(r[3].top);expect(r[3].top+r[3].height).toBe(a.top+a.height);});
});


it('reuses recovered single-tab popups without recreating playing windows',async()=>{
  const f=fixture();await f.add(1);f.restartBrowser();const c=createController(f.api);await c.request({type:'GET'});f.calls.length=0;await c.request({type:'APPLY'});expect(f.calls.some(c=>c[0]==='windows.create')).toBe(false);
});
it('migrates earlier geometry preferences to zero gap only once',async()=>{
  const f=fixture();await f.controller.request({type:'GET'});delete f.local.gamedeck.geometryVersion;f.local.gamedeck.gap=16;const c=createController(f.api);expect((await c.request({type:'GET'})).deck.gap).toBe(0);await c.request({type:'GAP',gap:4});expect((await createController(f.api).request({type:'GET'})).deck.gap).toBe(4);
});

it('ignores stale manual events after a newer extension-controlled audio choice',async()=>{
  const f=fixture();await f.add(1);const v=await f.add(2);await f.controller.request({type:'SELECT',key:v.deck.games[1].key});f.calls.length=0;
  const r=await f.controller.request({type:'AUDIO_CHANGED',tabId:1,mutedInfo:{muted:false,reason:'user'}});expect(r.runtime.audio.key).toBe(v.deck.games[1].key);expect(f.calls.some(c=>c[0]==='tabs.update')).toBe(false);
});


describe('adding games automatically expands the layout',()=>{
  it('adds a fourth tab to Main + Two by upgrading to Main + Three',async()=>{
    const f=fixture();for(const id of [1,2,3])await f.add(id);const before=await f.controller.request({type:'GET'});f.calls.length=0;
    const after=await f.add(4);expect(after.deck.layout).toBe('four-main');expect(after.deck.games).toHaveLength(4);expect(after.deck.games[0].key).toBe(before.deck.games[0].key);expect(after.runtime.audio.key).toBe(before.runtime.audio.key);
    for(const game of before.deck.games)expect(after.runtime.bindings[game.key]).toEqual(before.runtime.bindings[game.key]);expect(f.calls.filter(c=>c[0]==='windows.create')).toHaveLength(1);expect(after.runtime.layoutNotice).toContain('Main + three');
  });
  it('also expands when adding a pasted URL, opening it only once',async()=>{
    const f=fixture();for(const id of [1,2,3])await f.add(id);f.calls.length=0;const after=await f.controller.request({type:'ADD_URL',url:'https://example.com/fourth'});expect(after.deck.layout).toBe('four-main');expect(f.calls.filter(c=>c[0]==='windows.create'&&c[1].url)).toHaveLength(1);
  });
  it('preserves a larger layout and ignores duplicate additions when all slots are full',async()=>{
    const f=fixture();await f.controller.request({type:'LAYOUT',layout:'six-grid'});await f.add(1);expect((await f.add(2)).deck.layout).toBe('six-grid');await f.add(3);await f.add(4);const before=await f.controller.request({type:'GET'});expect((await f.add(4)).deck.games).toHaveLength(4);expect((await f.controller.request({type:'GET'})).deck.layout).toBe(before.deck.layout);
  });
  it('grows a one-game layout and handles queued additions',async()=>{
    const f=fixture();await f.controller.request({type:'LAYOUT',layout:'single'});await Promise.all([1,2,3,4].map(id=>f.add(id)));const after=await f.controller.request({type:'GET'});expect(after.deck.layout).toBe('four-main');expect(new Set(Object.values(after.runtime.bindings).map(b=>b.tabId)).size).toBe(4);
  });
  it('expands to six and then nine slots while keeping every existing identity',async()=>{
    const f=fixture();for(let id=5;id<=9;id++)f.tabs.set(id,{...f.tabs.get(1),id,index:id-1,title:'Game '+id,url:'https://example.com/game/'+id});
    for(let id=1;id<=9;id++)await f.add(id);const after=await f.controller.request({type:'GET'});expect(after.deck.games).toHaveLength(9);expect(after.deck.layout).toBe('custom');expect(after.deck.custom).toEqual({columns:3,rows:3});expect(Object.values(after.runtime.bindings).map(b=>b.tabId).sort()).toEqual([1,2,3,4,5,6,7,8,9]);expect((await f.add(1)).deck.games).toHaveLength(9);
  });
  it('expands a custom grid instead of rejecting the next game',async()=>{
    const f=fixture();await f.controller.request({type:'LAYOUT',layout:'custom',custom:{columns:1,rows:1}});await f.add(1);const r=await f.add(2);expect(r.deck.layout).toBe('custom');expect(r.deck.custom.columns*r.deck.custom.rows).toBeGreaterThanOrEqual(2);
  });
  it('falls back to a fitting grid if a focused layout cannot fit the monitor',async()=>{
    const f=fixture();for(const id of [1,2,3])await f.add(id);f.displays[0].workArea={left:0,top:0,width:600,height:400};expect((await f.add(4)).deck.layout).toBe('four-grid');
  });
  it('fails before opening a URL only if no usable layout fits the display',async()=>{
    const f=fixture();for(const id of [1,2,3])await f.add(id);f.displays[0].workArea={left:0,top:0,width:320,height:240};f.calls.length=0;
    await expect(f.controller.request({type:'ADD_URL',url:'https://example.com/fourth'})).rejects.toThrow(/Cannot fit 4 games/);expect(f.calls.some(c=>c[0]==='windows.create')).toBe(false);expect((await f.controller.request({type:'GET'})).deck.games).toHaveLength(3);
  });
  it('rejects restoring a now-too-small previous layout without corrupting current geometry',async()=>{
    const f=fixture();for(const id of [1,2,3,4])await f.add(id);await expect(f.controller.request({type:'PREVIOUS'})).rejects.toThrow(/too few slots/);expect((await f.controller.request({type:'GET'})).deck.layout).toBe('four-main');
  });
  it('restores player-only presentation before removing a managed tab',async()=>{
    const f=fixture();f.tabs.get(1).url='https://www.dazn.com/watch/1';const v=await f.add(1);const calls:any[]=[];f.api.permissions={contains:async()=>true};f.api.scripting={executeScript:async(p:any)=>{calls.push(p);return [{frameId:0,result:{applied:p.args[0]==='enable'}}];}};
    await f.controller.request({type:'PLAYER_VIEW',enabled:true,fit:'cover'});await f.controller.request({type:'REMOVE',key:v.deck.games[0].key});expect(calls.map(c=>c.args[0])).toEqual(['enable','restore']);expect(f.tabs.has(1)).toBe(true);
  });
});


describe('optional native score ticker reservation',()=>{
  function helper(f:ReturnType<typeof fixture>){
    const receive:((message:any)=>void)[]=[],disconnect:(()=>void)[]=[];
    const port={onMessage:{addListener:(fn:any)=>receive.push(fn)},onDisconnect:{addListener:(fn:any)=>disconnect.push(fn)},postMessage:(message:any)=>{f.calls.push(['native',message]);queueMicrotask(()=>receive.forEach(fn=>fn({id:message.id,ok:true,data:message.action==='hello'?{overlay:true}:{}})));},disconnect:()=>disconnect.forEach(fn=>fn())};
    f.api.permissions={contains:async()=>true};f.api.runtime.connectNative=()=>port;
  }
  const options={enabled:true,position:'bottom',height:64,opacity:.9,clickThrough:true,reserve:true,eventIds:[]};
  for(const mode of ['LOAD_PRESET','PREVIOUS'])it(`${mode} restores native windows and hides the ticker before changing monitors`,async()=>{
    const f=fixture();helper(f);f.displays.push({...f.displays[0],id:'right',isPrimary:false,workArea:{left:0,top:0,width:1920,height:1040},bounds:{left:0,top:0,width:1920,height:1080}});
    await f.add(1);await f.controller.request({type:'DISPLAY',displayId:'right'});const saved=await f.controller.request({type:'SAVE_PRESET',name:'Right monitor'});await f.controller.request({type:'DISPLAY',displayId:'left'});
    await f.controller.request({type:'IMMERSIVE',enabled:true});await f.controller.request({type:'SCORE_OVERLAY',enabled:true,settings:options,events:[]});f.calls.length=0;
    const r=await f.controller.request({type:mode,id:saved.deck.presets[0].id});
    expect(r.deck.displayId).toBe('right');expect(r.runtime.immersive).toBe(false);expect(r.runtime.scoreOverlay?.active).toBe(false);
    const restore=f.calls.findIndex(c=>c[0]==='native'&&c[1].action==='restoreAll'),firstMove=f.calls.findIndex(c=>c[0]==='windows.update');expect(restore).toBeGreaterThan(-1);expect(firstMove).toBeGreaterThan(restore);
    const win=f.windows.get(r.runtime.bindings[r.deck.games[0].key].windowId);expect(win.left).toBe(0);expect(win.height).toBe(1040);expect(f.calls.some(c=>c[0]==='native'&&c[1].action==='place')).toBe(false);
  });
  it('reserves and then restores monitor space without recreating or navigating stream windows',async()=>{
    const f=fixture();helper(f);await f.controller.request({type:'LAYOUT',layout:'four-main'});for(const id of [1,2,3,4])await f.add(id);const before=await f.controller.request({type:'GET'});f.calls.length=0;
    const shown=await f.controller.request({type:'SCORE_OVERLAY',enabled:true,settings:options,events:[],freshness:'test'});expect(shown.runtime.scoreOverlay?.active).toBe(true);expect(f.windows.get(shown.runtime.bindings[shown.deck.games[0].key].windowId).height).toBe(976);
    const hidden=await f.controller.request({type:'SCORE_OVERLAY',enabled:false});expect(hidden.runtime.scoreOverlay?.active).toBe(false);expect(f.windows.get(hidden.runtime.bindings[hidden.deck.games[0].key].windowId).height).toBe(1040);expect(Object.values(hidden.runtime.bindings).map(b=>b.windowId)).toEqual(Object.values(before.runtime.bindings).map(b=>b.windowId));expect(f.calls.some(c=>c[0]==='windows.create')).toBe(false);expect(f.calls.filter(c=>c[0]==='tabs.update').some(c=>'url'in c[2])).toBe(false);
  });
  it('floating mode retains the original layout geometry after safe pairing',async()=>{
    const f=fixture();helper(f);const before=await f.add(1);const id=before.runtime.bindings[before.deck.games[0].key].windowId;const original={...f.windows.get(id)};await f.controller.request({type:'SCORE_OVERLAY',enabled:true,settings:{...options,reserve:false},events:[]});expect(f.windows.get(id)).toEqual(original);await f.controller.request({type:'SCORE_OVERLAY',enabled:false});
  });
});
