import { calculateLayout, layouts } from './layout';
import { durableUrl, emptyDeck, emptyRuntime, normalizeUrl, provider, reconcile } from './model';
import type { Binding, Command, Deck, Display, LayoutId, Runtime, Snapshot, View } from './model';

export function createController(api: typeof chrome) {
  let deck: Deck, runtime: Runtime;
  let queue = Promise.resolve<unknown>(undefined);
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
    return all.filter(d=>d.isEnabled !== false && d.activeState !== 'inactive').map(d=>({ id:d.id,name:d.name,isPrimary:d.isPrimary,workArea:d.workArea }));
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
  function snapshot(): Snapshot { return { layout:deck.layout,displayId:deck.displayId,order:deck.games.map(g=>g.key) }; }
  function restoreSnapshot(value: Snapshot) {
    deck.layout=value.layout; deck.displayId=value.displayId;
    deck.games.sort((a,b)=> { const ai=value.order.indexOf(a.key),bi=value.order.indexOf(b.key); return (ai<0?999:ai)-(bi<0?999:bi); });
    deck.games.forEach((g,i)=>g.slot=i);
  }
  function remember() { deck.previous=snapshot(); }
  async function apply() {
    if (!deck.games.length) { runtime.arranged=false; return; }
    const monitors=await screens();
    const display=monitors.find(d=>d.id===deck.displayId);
    if(!display) throw new Error('The selected display is disconnected. Choose an available monitor.');
    const bounds=calculateLayout(display.workArea,deck.layout,deck.gap,deck.custom);
    if(deck.games.length>bounds.length) throw new Error(`This layout has ${bounds.length} slots for ${deck.games.length} games. Choose a larger layout first.`);
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
        if((['left','top','width','height'] as const).some(k=>Math.abs((actual[k]??target[k])-target[k])>8)) runtime.warnings.push(`${game.title}: Chrome or Windows adjusted the requested bounds. Use fewer slots or a larger display if windows overlap.`);
      } catch(error) {
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
    runtime={ ...emptyRuntime(),...(await api.storage.session.get('gamedeck')).gamedeck as Partial<Runtime> };
    const displays=await screens();
    deck.displayId ||= (displays.find(d=>d.isPrimary)||displays[0])?.id || '';
    deck.games.sort((a,b)=>a.slot-b.slot).forEach((g,i)=>g.slot=i);
    await refresh();
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
    await api.tabs.update(binding.tabId,{pinned:binding.originalPinned,autoDiscardable:binding.originalDiscardable});
  }
  async function dispatch(message: Command): Promise<View> {
    await load(); await refresh();
    const key=String(message.key||'');
    try {
      if(message.type==='ADD_TAB' || message.type==='ADD_URL' || message.type==='REOPEN') {
        const game=message.type==='REOPEN' ? deck.games.find(g=>g.key===key) : undefined;
        if(message.type==='REOPEN' && !game) throw new Error('Unknown saved game.');
        if(game && runtime.bindings[key]) { /* Already reconnected: no duplicate. */ }
        else {
          if(!game && deck.games.length>=9) throw new Error('GameDeck supports up to nine games.');
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
            const screen=(await screens()).find(d=>d.id===deck.displayId);
            if(!screen) throw new Error('Choose an available viewing monitor first.');
            const capacity=calculateLayout(screen.workArea,deck.layout,deck.gap,deck.custom).length;
            if(!game && deck.games.length>=capacity) throw new Error('All layout slots are assigned. Choose a layout with more slots before adding a game.');
            if(!tab) {
              const win=await api.windows.create({url,type:'popup',focused:false});
              if(win?.id==null) throw new Error('Chrome could not open this URL.');
              tab=(await api.tabs.query({windowId:win.id}))[0];
              if(!tab) throw new Error('The new Chrome tab was not found.');
            }
            const win=await api.windows.get(tab.windowId);
            const item=game||{key:crypto.randomUUID(),title:tab.title||provider(url),url:durableUrl(url),slot:deck.games.length};
            if(!game) deck.games.push(item);
            runtime.bindings[item.key]={tabId:tab.id!,windowId:tab.windowId,originalWindowId:tab.windowId,originalIndex:tab.index,originalBounds:{left:win.left??0,top:win.top??0,width:win.width??800,height:win.height??600},originalPinned:!!tab.pinned,originalDiscardable:tab.autoDiscardable!==false,managed:false};
            deck.selected=item.key;
            await persist(); await apply();
          }
        }
      } else if(message.type==='APPLY' || message.type==='RESTORE_ALL') await apply();
      else if(message.type==='STARTUP') { if(Object.keys(runtime.bindings).length) await apply(); }
      else if(message.type==='LAYOUT') {
        if(!layouts.some(l=>l.id===message.layout)) throw new Error('Unknown layout.');
        const next=message.layout as LayoutId;
        const display=(await screens()).find(d=>d.id===deck.displayId);
        if(!display) throw new Error('Choose a connected monitor.');
        const custom=message.custom as Deck['custom']||deck.custom;
        if(calculateLayout(display.workArea,next,deck.gap,custom).length<deck.games.length) throw new Error('This layout has too few slots for your lineup.');
        remember(); deck.layout=next;deck.custom=custom;await apply();
      } else if(message.type==='DISPLAY') {
        if(!(await screens()).some(d=>d.id===message.displayId)) throw new Error('That display is disconnected.');
        remember();deck.displayId=String(message.displayId);await apply();
      } else if(message.type==='SWAP' || message.type==='PROMOTE') {
        const a=deck.games.findIndex(g=>g.key===key),b=message.type==='PROMOTE'?0:deck.games.findIndex(g=>g.key===message.other);
        if(a<0||b<0) throw new Error('Select two games to swap.');
        remember();[deck.games[a],deck.games[b]]=[deck.games[b],deck.games[a]];deck.games.forEach((g,i)=>g.slot=i);await apply();
      } else if(message.type==='SELECT') deck.selected=key;
      else if(message.type==='FOCUS') await focus(key);
      else if(message.type==='CYCLE_FOCUS') {
        const games=deck.games.filter(g=>runtime.bindings[g.key]);
        if(games.length) await focus(games[(games.findIndex(g=>g.key===deck.selected)+1)%games.length].key);
      } else if(message.type==='NEXT_LAYOUT') {
        const compatible=layouts.filter(l=>l.id!=='custom' && l.capacity>=deck.games.length);
        remember();deck.layout=compatible[(compatible.findIndex(l=>l.id===deck.layout)+1)%compatible.length]?.id||'custom'; await apply();
      } else if(message.type==='PREVIOUS') {
        if(!deck.previous) throw new Error('No previous arrangement yet.');
        const current=snapshot();restoreSnapshot(deck.previous);deck.previous=current;await apply();
      } else if(message.type==='MINIMIZE' || message.type==='MINIMIZE_SECONDARY' || message.type==='RESTORE_WINDOW') {
        const games=deck.games.filter(g=>message.type==='MINIMIZE_SECONDARY'?g.slot!==0:g.key===key);
        for(const g of games) {const b=runtime.bindings[g.key];if(b) await api.windows.update(b.windowId,{state:message.type==='RESTORE_WINDOW'?'normal':'minimized'});}
      } else if(message.type==='REMOVE' || message.type==='RETURN_TAB' || message.type==='CLOSE_GAME') {
        const b=runtime.bindings[key];
        if(b) {
          if(message.type==='CLOSE_GAME') await api.tabs.remove(b.tabId);
          else if(message.type==='RETURN_TAB') await returnTab(b);
          else await api.tabs.update(b.tabId,{autoDiscardable:b.originalDiscardable});
        }
        deck.games=deck.games.filter(g=>g.key!==key);delete runtime.bindings[key];deck.games.forEach((g,i)=>g.slot=i);
        if(deck.selected===key) deck.selected=deck.games[0]?.key||null;
        await apply();
      } else if(message.type==='EDIT') {
        const g=deck.games.find(g=>g.key===key);if(g) {g.title=String(message.title||g.title).trim().slice(0,100);g.teams=String(message.teams||'').slice(0,100);g.score=String(message.score||'').slice(0,30);}
      } else if(message.type==='SAVE_PRESET') {
        const name=String(message.name||'').trim().slice(0,60);if(!name) throw new Error('Give the preset a name.');
        deck.presets.push({...snapshot(),id:crypto.randomUUID(),name});
      } else if(message.type==='LOAD_PRESET') {
        const p=deck.presets.find(p=>p.id===message.id);if(!p) throw new Error('Preset not found.');
        remember();restoreSnapshot(p);await apply();
      } else if(message.type==='DELETE_PRESET') deck.presets=deck.presets.filter(p=>p.id!==message.id);
      else if(message.type==='GAP') {deck.gap=Math.max(0,Math.min(32,Number(message.gap)||0));await apply();}
      else if(message.type!=='GET' && message.type!=='SYNC') throw new Error('Unknown GameDeck command.');
      if(message.type==='SYNC' && runtime.arranged && deck.games.length) await apply();
    } finally { if(message.type!=='GET') await persist(); }
    const {tabs,windows}=await refresh();
    return {deck:structuredClone(deck),runtime:structuredClone(runtime),tabs:tabs.filter(t=>/^https:\/\//.test(t.url||t.pendingUrl||'')&&!t.incognito),windows,displays:await screens()};
  }
  return {request(message:Command) {const task=queue.then(()=>dispatch(message));queue=task.catch(()=>{});return task;} };
}
