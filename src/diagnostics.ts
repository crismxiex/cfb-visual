import { createController } from './controller';
import { calculateLayout } from './layout';
import './style.css';

const root=document.getElementById('root')!;
root.innerHTML='<main style="max-width:900px;margin:40px auto"><div class="eyebrow">GAMEDECK · ISOLATED INTEGRATION CHECK</div><h1>Real Chrome window test</h1><p style="margin:20px 0;color:#95a8c8;line-height:1.8">Opens three harmless example.com pages, adopts their exact tab IDs, swaps and promotes them, tests popup restoration, and closes only the test tabs. Your GameDeck settings and existing tabs are excluded. This checks window orchestration, not provider playback.</p><button id="run" class="button primary">Run window test</button><pre id="report" style="white-space:pre-wrap;line-height:1.9;margin-top:24px;font-size:12px"></pre></main>';
const button=document.getElementById('run') as HTMLButtonElement;
const report=document.getElementById('report')!;
button.addEventListener('click',async()=>{
  button.disabled=true;report.textContent='';
  const log=(message:string)=>{report.textContent+=`${message}\n`;};
  if(!globalThis.chrome?.runtime?.id){log('Load GameDeck as an unpacked extension and open its diagnostics.html page.');button.disabled=false;return;}
  const ids=new Set<number>();let anchor:number|undefined;
  let loading=0;let observing=false;
  const onUpdated=(id:number,info:{status?:string})=>{if(observing&&ids.has(id)&&info.status==='loading')loading++;};
  chrome.tabs.onUpdated.addListener(onUpdated);
  try {
    const monitors=await chrome.system.display.getInfo();
    const display=monitors.find(d=>d.isPrimary)||monitors[0];
    if(!display)throw new Error('No display available.');
    calculateLayout(display.workArea,'three-main');
    log(`Display work area: ${JSON.stringify(display.workArea)}`);
    const window=await chrome.windows.create({url:'about:blank',type:'normal',focused:false});
    if(window?.id==null)throw new Error('Test window was not created.');
    anchor=window.tabs?.[0]?.id;
    for(let n=1;n<=3;n++){const tab=await chrome.tabs.create({windowId:window.id,url:`https://example.com/?gamedeck-test=${n}`,active:false});ids.add(tab.id!);}
    const deadline=Date.now()+20000;
    while(Date.now()<deadline){const tabs=await Promise.all([...ids].map(id=>chrome.tabs.get(id)));if(tabs.every(t=>t.status==='complete'))break;await new Promise(r=>setTimeout(r,250));}
    let local:Record<string,unknown>={},session:Record<string,unknown>={};
    const storage=(type:'local'|'session')=>({get:async()=>structuredClone(type==='local'?local:session),set:async(value:Record<string,unknown>)=>{if(type==='local')Object.assign(local,structuredClone(value));else Object.assign(session,structuredClone(value));}});
    const api={...chrome,storage:{...chrome.storage,local:storage('local'),session:storage('session')},windows:{...chrome.windows,getAll:async()=>{const all=await chrome.windows.getAll({populate:true});return all.map(w=>({...w,tabs:w.tabs?.filter(t=>ids.has(t.id!))})).filter(w=>w.tabs?.length);}}} as unknown as typeof chrome;
    const c=createController(api);
    observing=true;
    for(const tabId of ids)await c.request({type:'ADD_TAB',tabId});
    let view=await c.request({type:'GET'});
    const identities=Object.values(view.runtime.bindings).map(b=>b.tabId).sort();
    if(JSON.stringify(identities)!==JSON.stringify([...ids].sort()))throw new Error('Adoption changed tab identities.');
    log('PASS · Adopted all three original tab IDs into independent popup windows.');
    const first=view.deck.games[0],third=view.deck.games[2];
    await c.request({type:'LISTEN',key:third.key});
    for(const game of view.deck.games){
      const tab=await chrome.tabs.get(view.runtime.bindings[game.key].tabId);
      if(tab.mutedInfo?.muted!==(game.key!==third.key))throw new Error('Chrome tab audio did not match the solo selection.');
    }
    log('PASS · Listen changed actual Chrome tab mute flags exclusively.');
    await c.request({type:'MUTE_ALL'});
    for(const id of ids)if(!(await chrome.tabs.get(id)).mutedInfo?.muted)throw new Error('Mute all left a test tab enabled.');
    log('PASS · Mute all silenced every managed test tab.');
    const before=await chrome.windows.get(view.runtime.bindings[first.key].windowId);
    await c.request({type:'PROMOTE',key:third.key});
    view=await c.request({type:'GET'});
    const after=await chrome.windows.get(view.runtime.bindings[third.key].windowId);
    if(after.left!==before.left||after.top!==before.top)throw new Error('Promotion did not exchange actual positions.');
    log('PASS · Promotion changed real Chrome window geometry.');
    await c.request({type:'SWAP',key:first.key,other:third.key});
    log('PASS · Swap completed using existing windows.');
    await c.request({type:'MINIMIZE',key:first.key});
    const minimized=await chrome.windows.get(view.runtime.bindings[first.key].windowId);
    if(minimized.state!=='minimized')throw new Error('Window did not minimize.');
    await c.request({type:'RESTORE_ALL'});
    log('PASS · Minimize and restore completed.');
    const restarted=createController(api);
    view=await restarted.request({type:'GET'});
    if(Object.keys(view.runtime.bindings).length!==3)throw new Error('Worker recovery lost bindings.');
    log('PASS · Controller restart recovered current-session bindings.');
    await c.request({type:'RETURN_TAB',key:first.key});
    const returned=await chrome.tabs.get([...ids][0]);
    if((await chrome.windows.get(returned.windowId)).type!=='normal')throw new Error('Popup restoration did not reach a normal window.');
    log('PASS · Popup restored through Chrome-supported normal-window bridge.');
    if(loading)throw new Error(`${loading} page loading events observed after initial load; investigate navigation or background loading.`);
    log('PASS · No page loading events observed during orchestration.');
    log('RESULT · PASS. This test does not verify DRM playback or provider behavior.');
  }catch(error){log(`RESULT · FAIL: ${error instanceof Error?error.message:String(error)}`);}
  finally{
    observing=false;chrome.tabs.onUpdated.removeListener(onUpdated);
    for(const id of [...ids,...(anchor!=null?[anchor]:[])])try{await chrome.tabs.remove(id);}catch{/* Already closed. */}
    log('Cleaned up test tabs. Existing user tabs were not adopted.');button.disabled=false;
  }
});
