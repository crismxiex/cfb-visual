import { describe, it, expect } from 'vitest';
import { calculateLayout, layouts } from '../src/layout';
import { durableUrl, emptyDeck, normalizeUrl, provider, reconcile } from '../src/model';
import { createController } from '../src/controller';

function fixture() {
  let local:Record<string,any>={},session:Record<string,any>={};let serial=100;
  const calls:any[]=[];
  const tabs=new Map<number,any>([1,2,3,4].map(id=>[id,{id,windowId:1,index:id-1,title:`Game ${id}`,url:`https://example.com/game/${id}`,autoDiscardable:true,pinned:false,incognito:false}]));
  const windows=new Map<number,any>([[1,{id:1,type:'normal',state:'normal',focused:true,left:0,top:0,width:1200,height:800}]]);
  const displays=[{id:'left',isPrimary:true,name:'Viewing monitor',isEnabled:true,workArea:{left:-1920,top:-100,width:1920,height:1040}}];
  const withTabs=(w:any)=>({...w,tabs:[...tabs.values()].filter(t=>t.windowId===w.id)});
  const move=(tab:any,id:number)=>{const previous=tab.windowId;tab.windowId=id;if(![...tabs.values()].some(t=>t.windowId===previous))windows.delete(previous);};
  const area=(kind:'local'|'session')=>({get:async()=>structuredClone(kind==='local'?local:session),set:async(value:any)=>{calls.push(['save',kind]);if(kind==='local')Object.assign(local,structuredClone(value));else Object.assign(session,structuredClone(value));}});
  const api:any={
    storage:{local:area('local'),session:area('session')},system:{display:{getInfo:async()=>structuredClone(displays)}},
    tabs:{
      query:async(q:any)=>structuredClone([...tabs.values()].filter(t=>q.windowId==null||t.windowId===q.windowId)),
      get:async(id:number)=>{if(!tabs.has(id))throw new Error('Tab closed');return structuredClone(tabs.get(id));},
      update:async(id:number,props:any)=>{calls.push(['tabs.update',id,props]);if(!tabs.has(id))throw new Error('Tab closed');Object.assign(tabs.get(id),props);return structuredClone(tabs.get(id));},
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

describe('display-aware layout engine',()=>{
  for(const l of layouts) it(`${l.id} stays inside a negative-origin work area without overlap`,()=>{
    const area={left:-2560,top:-200,width:2560,height:1400};const rects=calculateLayout(area,l.id,8);
    expect(rects.length).toBe(l.id==='custom'?4:l.capacity);
    for(const r of rects){expect(Number.isInteger(r.left)).toBe(true);expect(r.left).toBeGreaterThanOrEqual(area.left);expect(r.top).toBeGreaterThanOrEqual(area.top);expect(r.left+r.width).toBeLessThanOrEqual(area.left+area.width);expect(r.top+r.height).toBeLessThanOrEqual(area.top+area.height);}
    for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length;j++){const a=rects[i],b=rects[j];expect(a.left+a.width<=b.left||b.left+b.width<=a.left||a.top+a.height<=b.top||b.top+b.height<=a.top).toBe(true);}
  });
  it('uses a portrait 2 by 3 six-game grid',()=>{const r=calculateLayout({left:0,top:0,width:1200,height:1900},'six-grid');expect(new Set(r.map(r=>r.left)).size).toBe(2);expect(new Set(r.map(r=>r.top)).size).toBe(3);});
  it('uses 65% main width with two vertically stacked secondary windows',()=>{const r=calculateLayout({left:0,top:0,width:1920,height:1040},'three-main');expect(r[0].width).toBeGreaterThan(1200);expect(r[1].left).toBe(r[2].left);expect(r[2].top).toBeGreaterThan(r[1].top);});
  it('rejects undersized and nonfinite areas and invalid custom grids',()=>{expect(()=>calculateLayout({left:0,top:0,width:800,height:600},'four-main')).toThrow(/too small/);expect(()=>calculateLayout({left:NaN,top:0,width:800,height:600},'single')).toThrow();expect(()=>calculateLayout({left:0,top:0,width:1920,height:1080},'custom',8,{rows:4,columns:2})).toThrow();});
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
  it('retains a successfully adopted tab when a later geometry update fails',async()=>{const f=fixture();const v=await f.add(1);const create=f.api.windows.create;f.api.windows.create=async(p:any)=>{if(p.tabId===2)throw new Error('Window creation denied');return create(p);};await expect(f.add(2)).rejects.toThrow(/denied/);const r=await f.controller.request({type:'GET'});expect(r.runtime.bindings[v.deck.games[0].key].tabId).toBe(1);expect(r.deck.games).toHaveLength(2);expect(r.runtime.warnings[0]).toMatch(/denied/);});
});
