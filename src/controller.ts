import { createAudioController } from './audio-controller';
import { createNativeManager } from './native';
import { calculateLayout, layoutForAddition, layouts } from './layout';
import { createPlayerViewController } from './player-view-controller';
import { displayArea, mainGameKey, durableUrl, emptyDeck, emptyRuntime, normalizeUrl, provider, reconcile } from './model';
import type { Binding, Command, Deck, Display, LayoutId, Runtime, Snapshot, View } from './model';

export function createController(api: typeof chrome) {
  let deck: Deck, runtime: Runtime;
  let queue = Promise.resolve<unknown>(undefined);
  const audio=createAudioController(api,()=>deck,()=>runtime);
  const playerView=createPlayerViewController(api,()=>deck,()=>runtime);
  const native=createNativeManager(api,reason=>{if(runtime){runtime.immersive=false;runtime.nativeStatus=reason;void api.storage.session.set({gamedeck:structuredClone(runtime)}).catch(console.error);}});
  const persist = async () => {
    await api.storage.local.set({ gamedeck: structuredClone(deck) });
    await api.storage.session.set({ gamedeck: structuredClone(runtime) });
  };
  const inventory = async () => {
    const windows = await api.windows.getAll({ populate: true });
    const tabs = windows.flatMap(w => w.tabs || []);
    return { windows, tabs };
  };
  const screens = async (): Promise<Display[]> => {
    const all = await api.system.display.getInfo();
    return all.filter(d=>d.isEnabled !== false && d.activeState !== 'inactive').map(d=>({ id:d.id,name:d.name,isPrimary:d.isPrimary,workArea:d.workArea,bounds:d.bounds }));
  };
  async function refresh() {
    const { windows, tabs } = await inventory();
    runtime.bindings = reconcile(deck.games,tabs,windows,runtime.bindings);
    // Follow provider navigation without reading page content.
    for (const game of deck.games) {
      const tab=tabs.find(t=>t.id===runtime.bindings[game.key]?.tabId);
      if(tab?.url?.startsWith('https://')) game.url=durableUrl(tab.url);
    }
    return { windows, tabs };
  }
  function snapshot(): Snapshot { return { layout:deck.layout,displayId:deck.displayId,order:deck.games.map(g=>g.key),positions:Object.fromEntries(deck.games.map(g=>[g.key,g.slot])),custom:{...deck.custom},gap:deck.gap,displayMode:deck.displayMode }; }
  function restoreSnapshot(value: Snapshot) {
    deck.layout=value.layout; deck.displayId=value.displayId;deck.custom=value.custom;deck.gap=[0,2,4,8].includes(value.gap)?value.gap:0;deck.displayMode=value.displayMode||'workArea';
    deck.games.sort((a,b)=> { const ai=value.order.indexOf(a.key),bi=value.order.indexOf(b.key); return (ai<0?999:ai)-(bi<0?999:bi); });
    const used=new Set<number>();
    deck.games.forEach(g=>{ const slot=value.positions[g.key];if(slot!=null&&!used.has(slot)){g.slot=slot;used.add(slot);}else g.slot=-1; });
    deck.games.filter(g=>g.slot<0).forEach(g=>{let slot=0;while(used.has(slot))slot++;g.slot=slot;used.add(slot);});
    deck.games.sort((a,b)=>a.slot-b.slot);
  }
  function remember() { deck.previous=snapshot(); }
  async function apply() {
    if (!deck.games.length) { runtime.arranged=false; return; }
    const monitors=await screens();
    const display=monitors.find(d=>d.id===deck.displayId);
    if(!display) throw new Error('The selected display is disconnected. Choose an available monitor.');
    const bounds=calculateLayout(displayArea(display,deck.displayMode),deck.layout,deck.gap,deck.custom);
    if(deck.games.length>bounds.length || deck.games.some(g=>g.slot>=bounds.length)) throw new Error(`This layout has ${bounds.length} slots for your assigned games. Choose a larger layout or move games to earlier slots first.`);
    runtime.warnings=[];
    for (const game of deck.games) {
      const binding=runtime.bindings[game.key];
      if(!binding) continue; // Unavailable games are never silently reopened.
      const target=bounds[game.slot];
      try {
        const tab=await api.tabs.get(binding.tabId);
        const current=await api.windows.get(tab.windowId,{ populate:true });
        let win: chrome.windows.Window | undefined;
        if(binding.managed && current.id===binding.windowId && current.tabs?.length===1) {
          if(current.state!=='normal') await api.windows.update(tab.windowId,{ state:'normal' });
          win=await api.windows.update(tab.windowId,target);
        } else {
          if (!['normal','popup'].includes(current.type || '')) throw new Error('Installed apps and this window type cannot be adopted. Use a regular Chrome website tab.');
          if(tab.pinned) await api.tabs.update(tab.id!,{ pinned:false });
          win=await api.windows.create({ tabId:binding.tabId,type:'popup',focused:false,...target });
          if(win?.id==null) throw new Error('Chrome did not return a window ID.');
          binding.windowId=win.id; binding.managed=true;
          await api.storage.session.set({ gamedeck:structuredClone(runtime) });
        }
        if(!win) throw new Error('Chrome did not return window bounds.');
        await api.tabs.update(binding.tabId,{ autoDiscardable:false });
        const actual=await api.windows.get(win.id!);
        if(runtime.immersive){
          if(!display.bounds)throw new Error('Full monitor metadata is required for native DPI mapping.');
          const result=await native.place(game.key,binding.tabId,win.id!,display.bounds,target);
          if(result?.adjusted)runtime.warnings.push(`${game.title}: Windows or Chrome adjusted native bounds. Exit immersive mode if the windows do not align.`);
        }else if((['left','top','width','height'] as const).some(k=>(actual[k]??target[k])!==target[k])) runtime.warnings.push(`${game.title}: Chrome or Windows adjusted the requested bounds. Use fewer slots or a larger display if windows overlap.`);
      } catch(error) {
        if(runtime.immersive){await native.stop().catch(console.error);runtime.immersive=false;runtime.nativeStatus='Native placement failed. Paired windows restore their original styles and geometry.';}
        runtime.warnings.push(`${game.title}: ${error instanceof Error ? error.message : String(error)}`);
        await persist();
        throw new Error(runtime.warnings.at(-1));
      }
    }
    runtime.arranged=true;
  }
  async function load() {
    if(deck) return;
    deck={ ...emptyDeck(),...(await api.storage.local.get('gamedeck')).gamedeck as Partial<Deck> };
    if(!deck.geometryVersion){deck.gap=0;deck.geometryVersion=1;}
    runtime={ ...emptyRuntime(),...(await api.storage.session.get('gamedeck')).gamedeck as Partial<Runtime> };
    if(runtime.immersive){runtime.immersive=false;runtime.nativeStatus='The prior helper connection ended; native windows restore when it disconnects. Enable immersive mode again to pair current windows.';}
    const displays=await screens();
    deck.displayId ||= (displays.find(d=>d.isPrimary)||displays[0])?.id || '';
    deck.games.sort((a,b)=>a.slot-b.slot);
    const initial=await refresh();
    await audio.sync(initial.tabs,true);
    await persist();
  }
  async function focus(key: string) {
    const b=runtime.bindings[key]; if(!b) throw new Error('This game is unavailable. Reopen it explicitly or choose an existing tab.');
    const win=await api.windows.get(b.windowId);
    if(win.state==='minimized') await api.windows.update(win.id!,{state:'normal'});
    await api.tabs.update(b.tabId,{ active:true });
    await api.windows.update(b.windowId,{ focused:true });
    deck.selected=key;
  }
  async function returnTab(binding: Binding) {
    const tab=await api.tabs.get(binding.tabId);
    if(binding.managed) {
      let target: chrome.windows.Window | undefined;
      try { const win=await api.windows.get(binding.originalWindowId); if(win.type==='normal' && !win.incognito) target=win; } catch { /* Original window closed when its last tab moved. */ }
      if(!target) {
        target=await api.windows.create({tabId:binding.tabId,type:'normal',focused:false,...binding.originalBounds});
        if(target?.id!=null) for(const other of Object.values(runtime.bindings)) if(other.originalWindowId===binding.originalWindowId) other.originalWindowId=target.id;
      } else if(tab.windowId!==target.id) {
        if((await api.windows.get(tab.windowId)).type!=='normal') await api.windows.create({tabId:tab.id,type:'normal',focused:false});
        await api.tabs.move(binding.tabId,{windowId:target.id!,index:binding.originalIndex});
      }
    }
    await audio.restore(binding);
    await api.tabs.update(binding.tabId,{pinned:binding.originalPinned,autoDiscardable:binding.originalDiscardable});
  }
  async function dispatch(message: Command): Promise<View> {
    await load();
    const managedTabClosed=message.type==='TAB_CLOSED'&&Object.values(runtime.bindings).some(b=>b.tabId===message.tabId);
    if(message.type==='TAB_REPLACED'){
      const binding=Object.values(runtime.bindings).find(b=>b.tabId===message.removedTabId);
      if(binding){const tab=await api.tabs.get(Number(message.addedTabId));binding.tabId=tab.id!;binding.windowId=tab.windowId;}
    }
    const priorBindings=Object.keys(runtime.bindings);
    const inventoryBefore=await refresh();
    if(runtime.immersive)for(const key of priorBindings)if(!runtime.bindings[key])await native.release(key);
    const previousMain=mainGameKey(deck);
    await audio.sync(inventoryBefore.tabs);
    const key=String(message.key||'');
    if(['LAYOUT','NEXT_LAYOUT','PREVIOUS','LOAD_PRESET','DISPLAY_MODE'].includes(message.type))runtime.layoutNotice='';
    try {
      if(message.type==='ADD_TAB' || message.type==='ADD_URL' || message.type==='REOPEN') {
        const game=message.type==='REOPEN' ? deck.games.find(g=>g.key===key) : undefined;
        if(message.type==='REOPEN' && !game) throw new Error('Unknown saved game.');
        if(game && runtime.bindings[key]) { /* Already reconnected: no duplicate. */ }
        else {
          const { tabs,windows }=await inventory();
          let tab=message.type==='ADD_TAB' ? tabs.find(t=>t.id===message.tabId) : undefined;
          const url=message.type==='ADD_TAB' ? normalizeUrl(tab?.url||'') : normalizeUrl(game?.url||String(message.url||''));
          if(message.type==='ADD_TAB' && !tab) throw new Error('This tab is no longer available.');
          if(!tab) tab=tabs.find(t=> !t.incognito && (t.url||t.pendingUrl)===url) || tabs.find(t=>{try{return !t.incognito && durableUrl(t.url||t.pendingUrl!)===durableUrl(url);}catch{return false;}});
          if(tab?.incognito) throw new Error('Use a tab from this regular Chrome profile.');
          if(tab && !windows.some(w=>w.id===tab!.windowId && ['normal','popup'].includes(w.type||''))) throw new Error('This tab belongs to an unsupported app window.');
          const already=tab && Object.entries(runtime.bindings).find(([,b])=>b.tabId===tab!.id);
          if(already) { deck.selected=already[0]; }
          else {
            if(!game && deck.games.length>=9) throw new Error('GameDeck supports up to nine games.');
            const screen=(await screens()).find(d=>d.id===deck.displayId);
            if(!screen) throw new Error('Choose an available viewing monitor first.');
            let slot=game?.slot??0;while(!game&&deck.games.some(g=>g.slot===slot))slot++;
            const requiredSlots=Math.max(slot+1,...deck.games.map(g=>g.slot+1));
            const next=layoutForAddition(displayArea(screen,deck.displayMode),deck.layout,requiredSlots,deck.gap,deck.custom);
            if(!tab) {
              const win=await api.windows.create({url,type:'popup',focused:false});
              if(win?.id==null) throw new Error('Chrome could not open this URL.');
              tab=(await api.tabs.query({windowId:win.id}))[0];
              if(!tab) throw new Error('The new Chrome tab was not found.');
            }
            const win=await api.windows.get(tab.windowId,{populate:true});
            if(next.layout!==deck.layout||next.custom.columns!==deck.custom.columns||next.custom.rows!==deck.custom.rows){
              remember();deck.layout=next.layout;deck.custom=next.custom;
              runtime.layoutNotice=`Layout expanded to ${layouts.find(l=>l.id===deck.layout)?.name} for ${deck.games.length+(game?0:1)} games.`;
            }
            const item=game||{key:crypto.randomUUID(),title:tab.title||provider(url),url:durableUrl(url),slot};
            if(!game) {deck.games.push(item);deck.games.sort((a,b)=>a.slot-b.slot);}
            runtime.bindings[item.key]={tabId:tab.id!,windowId:tab.windowId,originalWindowId:tab.windowId,originalIndex:tab.index,originalBounds:{left:win.left??0,top:win.top??0,width:win.width??800,height:win.height??600},originalPinned:!!tab.pinned,originalDiscardable:tab.autoDiscardable!==false,originalMuted:!!tab.mutedInfo?.muted,managed:win.type==='popup'&&win.tabs?.length===1};
            deck.selected=item.key;
            await audio.added(item.key);
            await persist(); await audio.mainChanged(previousMain);await apply();
          }
        }
      } else if(message.type==='APPLY' || message.type==='RESTORE_ALL') {await audio.mainChanged(previousMain);await apply();}
      else if(message.type==='STARTUP') { if(Object.keys(runtime.bindings).length){await audio.mainChanged(previousMain);await apply();} }
      else if(message.type==='LAYOUT') {
        if(!layouts.some(l=>l.id===message.layout)) throw new Error('Unknown layout.');
        const next=message.layout as LayoutId;
        const display=(await screens()).find(d=>d.id===deck.displayId);
        if(!display) throw new Error('Choose a connected monitor.');
        const custom=message.custom as Deck['custom']||deck.custom;
        if(calculateLayout(displayArea(display,deck.displayMode),next,deck.gap,custom).length<deck.games.length) throw new Error('This layout has too few slots for your lineup.');
        remember(); deck.layout=next;deck.custom=custom;deck.games.forEach((g,i)=>g.slot=i);await audio.mainChanged(previousMain);await apply();
      } else if(message.type==='DISPLAY') {
        if(!(await screens()).some(d=>d.id===message.displayId)) throw new Error('That display is disconnected.');
        if(runtime.immersive){await native.stop();runtime.immersive=false;runtime.nativeStatus='Immersive mode exited before changing monitors. Enable it again to validate the new display.';}
        remember();deck.displayId=String(message.displayId);await audio.mainChanged(previousMain);await apply();
      } else if(message.type==='SWAP' || message.type==='PROMOTE' || message.type==='MOVE_SLOT') {
        const game=deck.games.find(g=>g.key===key);
        const target=message.type==='PROMOTE'?0:message.type==='MOVE_SLOT'?Number(message.slot):deck.games.find(g=>g.key===message.other)?.slot;
        const display=(await screens()).find(d=>d.id===deck.displayId);
        if(!game||target==null||!Number.isInteger(target)||target<0||!display||target>=calculateLayout(displayArea(display,deck.displayMode),deck.layout,deck.gap,deck.custom).length) throw new Error('Choose an available layout position.');
        remember();const other=deck.games.find(g=>g.slot===target);if(other)other.slot=game.slot;game.slot=target;deck.games.sort((a,b)=>a.slot-b.slot);await audio.mainChanged(previousMain);await apply();
      } else if(message.type==='PLAYER_VIEW') {
        const keys=Array.isArray(message.keys)?message.keys.map(String):undefined;
        await playerView.set(!!message.enabled,(message.fit||deck.playerFit) as Deck['playerFit'],keys);
      } else if(message.type==='PLAYER_FIT') {
        if(!['contain','cover'].includes(String(message.fit)))throw new Error('Choose Fit or Fill.');deck.playerFit=message.fit as Deck['playerFit'];
        const keys=Object.entries(runtime.bindings).filter(([,b])=>b.playerViewEnabled).map(([key])=>key);
        if(keys.length)await playerView.set(true,deck.playerFit,keys,true);
      } else if(message.type==='LISTEN') await audio.select(key);
      else if(message.type==='MUTE_ALL') await audio.select(null);
      else if(message.type==='TOGGLE_MUTE') {
        const binding=runtime.bindings[key];if(!binding)throw new Error('This game is unavailable.');
        const tab=await api.tabs.get(binding.tabId);
        if(tab.mutedInfo?.muted)await audio.select(key);else await audio.select(null);
      } else if(message.type==='AUDIO_CHANGED') {await audio.changed(Number(message.tabId),message.mutedInfo as chrome.tabs.MutedInfo);
      } else if(message.type==='IMMERSIVE') {
        if(!message.enabled){await native.stop();runtime.immersive=false;runtime.nativeStatus='Original native styles and geometry restored.';}
        else{
          if(!deck.games.length)throw new Error('Add a game before enabling immersive mode.');
          await apply();
          try{await native.connect();runtime.immersive=true;await apply();runtime.nativeStatus='Helper connected. Native frame reduction is best effort; Chrome may retain its custom title bar.';}
          catch(error){await native.stop().catch(()=>{});runtime.immersive=false;runtime.nativeStatus='Immersive mode stopped; helper restores paired window styles and geometry.';throw error;}
        }
      } else if(message.type==='DASHBOARD_CLOSED') {
        if(runtime.immersive){await native.stop();runtime.immersive=false;runtime.nativeStatus='Dashboard closed; native window styles and geometry restored.';}
      } else if(message.type==='AUDIO_FOLLOWS_MAIN') {deck.audioFollowsMain=!!message.enabled;
      } else if(message.type==='AUDIO_ENABLED') {
        const enabled=!!message.enabled;
        if(!enabled){for(const binding of Object.values(runtime.bindings))await audio.restore(binding);runtime.audio={mode:'preserve',key:null};deck.audioEnabled=false;}
        else{deck.audioEnabled=true;await audio.select(mainGameKey(deck)&&runtime.bindings[mainGameKey(deck)!]?mainGameKey(deck):Object.keys(runtime.bindings)[0]||null);}
      } else if(message.type==='TAB_REPLACED') {
        const entry=Object.entries(runtime.bindings).find(([,b])=>b.tabId===message.addedTabId);
        if(entry&&deck.audioEnabled)await audio.write(entry[1],runtime.audio.mode==='silent'||runtime.audio.key!==entry[0]);
      } else if(message.type==='DISPLAY_MODE') {
        if(!['workArea','full'].includes(String(message.mode)))throw new Error('Choose Respect taskbar or Fill entire display.');
        const monitor=(await screens()).find(d=>d.id===deck.displayId);if(!monitor)throw new Error('Choose an available monitor.');
        calculateLayout(displayArea(monitor,message.mode as Deck['displayMode']),deck.layout,deck.gap,deck.custom);remember();deck.displayMode=message.mode as Deck['displayMode'];await apply();
      } else if(message.type==='SELECT') {if(deck.games.some(g=>g.key===key)){deck.selected=key;if(deck.audioEnabled)await audio.select(key);}}
      else if(message.type==='FOCUS') await focus(key);
      else if(message.type==='CYCLE_FOCUS') {
        const games=deck.games.filter(g=>runtime.bindings[g.key]);
        if(games.length) await focus(games[(games.findIndex(g=>g.key===deck.selected)+1)%games.length].key);
      } else if(message.type==='NEXT_LAYOUT') {
        const compatible=layouts.filter(l=>l.id!=='custom' && l.capacity>=deck.games.length);
        remember();deck.layout=compatible[(compatible.findIndex(l=>l.id===deck.layout)+1)%compatible.length]?.id||'custom';deck.games.forEach((g,i)=>g.slot=i); await audio.mainChanged(previousMain);await apply();
      } else if(message.type==='PREVIOUS') {
        if(!deck.previous) throw new Error('No previous arrangement yet.');
        const screen=(await screens()).find(d=>d.id===deck.previous!.displayId);
        if(!screen)throw new Error('The previous display is disconnected.');
        if(calculateLayout(displayArea(screen,deck.previous.displayMode||'workArea'),deck.previous.layout,deck.previous.gap,deck.previous.custom).length<deck.games.length)throw new Error('The previous arrangement has too few slots for the current lineup.');
        const current=snapshot();restoreSnapshot(deck.previous);deck.previous=current;await audio.mainChanged(previousMain);await apply();
      } else if(message.type==='MINIMIZE' || message.type==='MINIMIZE_SECONDARY' || message.type==='RESTORE_WINDOW') {
        const games=deck.games.filter(g=>message.type==='MINIMIZE_SECONDARY'?g.slot!==0:g.key===key);
        for(const g of games) {const b=runtime.bindings[g.key];if(b) await api.windows.update(b.windowId,{state:message.type==='RESTORE_WINDOW'?'normal':'minimized'});}
      } else if(message.type==='REMOVE' || message.type==='RETURN_TAB' || message.type==='CLOSE_GAME') {
        const b=runtime.bindings[key];
        if(b?.playerViewEnabled&&message.type!=='CLOSE_GAME')await playerView.set(false,deck.playerFit,[key]);
        if(runtime.immersive)await native.release(key);
        if(b) {
          if(message.type==='CLOSE_GAME') await api.tabs.remove(b.tabId);
          else if(message.type==='RETURN_TAB') await returnTab(b);
          else {await audio.restore(b);await api.tabs.update(b.tabId,{autoDiscardable:b.originalDiscardable});}
        }
        deck.games=deck.games.filter(g=>g.key!==key);delete runtime.bindings[key];deck.games.forEach((g,i)=>g.slot=i);
        runtime.layoutNotice='';
        if(deck.selected===key) deck.selected=deck.games[0]?.key||null;
        await audio.sync((await inventory()).tabs);
        await audio.mainChanged(previousMain);await apply();
      } else if(message.type==='EDIT') {
        const g=deck.games.find(g=>g.key===key);if(g) {g.title=String(message.title||g.title).trim().slice(0,100);g.teams=String(message.teams||'').slice(0,100);g.score=String(message.score||'').slice(0,30);}
      } else if(message.type==='SAVE_PRESET') {
        const name=String(message.name||'').trim().slice(0,60);if(!name) throw new Error('Give the preset a name.');
        deck.presets.push({...snapshot(),id:crypto.randomUUID(),name});
      } else if(message.type==='LOAD_PRESET') {
        const p=deck.presets.find(p=>p.id===message.id);if(!p) throw new Error('Preset not found.');
        const screen=(await screens()).find(d=>d.id===p.displayId);
        if(!screen)throw new Error('The saved display is disconnected. Choose another arrangement.');
        if(calculateLayout(displayArea(screen,p.displayMode||'workArea'),p.layout,p.gap,p.custom).length<deck.games.length)throw new Error('This saved layout has too few slots for your current lineup.');
        remember();restoreSnapshot(p);await audio.mainChanged(previousMain);await apply();
      } else if(message.type==='DELETE_PRESET') deck.presets=deck.presets.filter(p=>p.id!==message.id);
      else if(message.type==='GAP') {if(![0,2,4,8].includes(Number(message.gap)))throw new Error('Choose a gap of 0, 2, 4, or 8 pixels.');deck.gap=Number(message.gap);await audio.mainChanged(previousMain);await apply();}
      else if(message.type!=='GET' && message.type!=='SYNC' && message.type!=='TAB_CLOSED' && message.type!=='METADATA') throw new Error('Unknown GameDeck command.');
      if((message.type==='SYNC'||managedTabClosed) && runtime.arranged && deck.games.length){await audio.mainChanged(previousMain);await apply();}
    } finally { if(message.type!=='GET') await persist(); }
    const {tabs,windows}=await refresh();
    return {deck:structuredClone(deck),runtime:structuredClone(runtime),tabs:tabs.filter(t=>/^https:\/\//.test(t.url||t.pendingUrl||'')&&!t.incognito),windows,displays:await screens()};
  }
  return {request(message:Command) {const task=queue.then(()=>dispatch(message));queue=task.catch(()=>{});return task;} };
}
