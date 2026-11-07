import type { Rect } from './model';
export const NATIVE_HOST='com.gamedeck.windows';

// No native window handle is accepted from the UI. The helper pairs a window
// through title/process validation followed by an observed geometry challenge.
export function createNativeManager(api:typeof chrome,onDisconnected:(reason:string)=>void) {
  let port:chrome.runtime.Port|undefined,serial=0;
  const paired=new Map<string,number>();
  const pending=new Map<number,{resolve:(value:any)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  async function connect(){
    if(port)return;
    if(!await api.permissions.contains({permissions:['nativeMessaging']}))throw new Error('Allow the optional nativeMessaging permission, then install the helper using native/install.ps1.');
    port=api.runtime.connectNative(NATIVE_HOST);
    port.onMessage.addListener(message=>{const entry=pending.get(message.id);if(!entry)return;clearTimeout(entry.timer);pending.delete(message.id);if(message.ok)entry.resolve(message.data);else entry.reject(new Error(message.error||'Native window operation failed.'));});
    port.onDisconnect.addListener(()=>{
      const reason=api.runtime.lastError?.message||'Native helper disconnected; its saved window styles and geometry are restored on disconnect.';
      for(const entry of pending.values()){clearTimeout(entry.timer);entry.reject(new Error(reason));}pending.clear();paired.clear();port=undefined;onDisconnected(reason);
    });
    await request('hello',{});
  }
  function request(action:string,data:Record<string,unknown>):Promise<any>{
    if(!port)return Promise.reject(new Error('Native helper is not connected. Install native/install.ps1 for your extension ID.'));
    const id=++serial;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Native helper timed out. Immersive mode has been stopped.'));port?.disconnect();},8000);
      pending.set(id,{resolve,reject,timer});
      try{port!.postMessage({id,action,...data});}catch(error){clearTimeout(timer);pending.delete(id);reject(error);}
    });
  }
  const rect=(win:chrome.windows.Window):Rect=>({left:win.left!,top:win.top!,width:win.width!,height:win.height!});
  async function place(key:string,tabId:number,windowId:number,monitor:Rect,target:Rect){
    if(paired.get(key)!==windowId){
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
      paired.set(key,windowId);
    }
    return request('place',{key,rect:target,monitor});
  }
  async function release(key:string){if(!paired.has(key))return;await request('restore',{key});paired.delete(key);}
  async function stop(){try{if(port)await request('restoreAll',{});}finally{paired.clear();port?.disconnect();port=undefined;}}
  return {connect,place,release,stop};
}
