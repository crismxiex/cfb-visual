import type { Rect } from './model';
export const NATIVE_HOST='com.gamedeck.windows';

// No native window handle is accepted from the UI. The helper pairs a window
// through title/process validation followed by an observed geometry challenge.
export function createNativeManager(api:typeof chrome,onDisconnected:(reason:string)=>void) {
  let port:chrome.runtime.Port|undefined,serial=0;
  let overlayVisible=false,supportsOverlay=false;
  const paired=new Map<string,{windowId:number;monitor:string}>();
  const pending=new Map<number,{resolve:(value:any)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  async function connect(requireOverlay=false){
    if(port){if(requireOverlay&&!supportsOverlay)throw new Error('Update the native helper to v2.4 using native/install.ps1 to use the score ticker.');return;}
    if(!await api.permissions.contains({permissions:['nativeMessaging']}))throw new Error('Allow the optional nativeMessaging permission, then install the helper using native/install.ps1.');
    const connected=api.runtime.connectNative(NATIVE_HOST);
    port=connected;
    connected.onMessage.addListener(message=>{const entry=pending.get(message.id);if(!entry)return;clearTimeout(entry.timer);pending.delete(message.id);if(message.ok)entry.resolve(message.data);else entry.reject(new Error(message.error||'Native window operation failed.'));});
    connected.onDisconnect.addListener(()=>teardown(connected,api.runtime.lastError?.message||'Native helper disconnected; its saved window styles and geometry are restored on disconnect.'));
    let capabilities;
    try{capabilities=await request('hello',{});}catch(error){
      const detail=error instanceof Error?error.message:String(error);
      throw new Error(`Desktop helper could not start: ${detail} From the GameDeck project folder run .\\native\\install.ps1 -ExtensionId ${api.runtime.id}, then choose Retry ticker. Windows must allow the helper executable to run.`);
    }
    supportsOverlay=!!capabilities?.overlay;
    if(requireOverlay&&!supportsOverlay)throw new Error('Update the native helper to v2.4 using native/install.ps1 to use the score ticker.');
  }
  // Drops all state tied to a port. Chrome never fires onDisconnect on the side
  // that calls disconnect(), so locally ended ports must be torn down here too.
  function teardown(target:chrome.runtime.Port|undefined,reason:string){
    if(!target||port!==target)return;
    port=undefined;
    for(const entry of pending.values()){clearTimeout(entry.timer);entry.reject(new Error(reason));}
    pending.clear();paired.clear();overlayVisible=false;
    onDisconnected(reason);
  }
  function request(action:string,data:Record<string,unknown>):Promise<any>{
    if(!port)return Promise.reject(new Error('Native helper is not connected. Install native/install.ps1 for your extension ID.'));
    const id=++serial;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{
        const reason='Native helper timed out. Immersive mode has been stopped.';
        pending.delete(id);reject(new Error(reason));
        const stale=port;teardown(stale,reason);stale?.disconnect();
      },8000);
      pending.set(id,{resolve,reject,timer});
      try{port!.postMessage({id,action,...data});}catch(error){clearTimeout(timer);pending.delete(id);reject(error);}
    });
  }
  const rect=(win:chrome.windows.Window):Rect=>({left:win.left!,top:win.top!,width:win.width!,height:win.height!});
  async function ensurePair(key:string,tabId:number,windowId:number,monitor:Rect){
    const existing=paired.get(key),signature=JSON.stringify(monitor);
    if(existing?.windowId===windowId&&existing.monitor!==signature)throw new Error('The viewing monitor geometry changed. Exit immersive mode and retry the ticker to validate the new monitor.');
    if(existing?.windowId!==windowId){
      if(paired.has(key))await release(key);
      const win=await api.windows.get(windowId,{populate:true});
      if(win.type!=='popup'||win.tabs?.length!==1||win.tabs[0].id!==tabId)throw new Error('Immersive mode only pairs single-tab managed popup windows.');
      const tab=await api.tabs.get(tabId);
      if(!tab.title?.trim())throw new Error('Wait for the game tab to have a title before using immersive mode.');
      const original=rect(win);
      await request('prepare',{key,title:tab.title,rect:original,monitor});
      // Verify that a native candidate follows this exact Chrome window ID.
      const delta=original.left+original.width+19<monitor.left+monitor.width?19:-19;
      try{
        const probe=await api.windows.update(windowId,{left:original.left+delta});
        await request('pair',{key,rect:rect(probe)});
      }finally{await api.windows.update(windowId,original);}
      paired.set(key,{windowId,monitor:signature});
    }
  }
  async function place(key:string,tabId:number,windowId:number,monitor:Rect,target:Rect){
    await ensurePair(key,tabId,windowId,monitor);
    return request('place',{key,rect:target,monitor});
  }
  async function release(key:string){if(!paired.has(key))return;await request('restore',{key});paired.delete(key);}
  async function restoreWindows(){if(port)await request('restoreAll',{});paired.clear();if(!overlayVisible){port?.disconnect();port=undefined;}}
  async function overlay(payload:Record<string,unknown>){if(!port&&!payload.enabled)return;await connect(!!payload.enabled);const result=await request('overlay',payload);overlayVisible=!!payload.enabled;return result;}
  async function stop(){try{if(port)await request('restoreAll',{});}finally{paired.clear();overlayVisible=false;port?.disconnect();port=undefined;}}
  return {connect,place,release,ensurePair,overlay,restoreWindows,stop};
}
