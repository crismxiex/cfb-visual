import { create } from 'zustand';
import type { Command, View } from './model';
type Store = { view: View | null; busy: boolean; error: string; connected: boolean; refresh: () => Promise<void>; send: (command: Command) => Promise<boolean>; clearError: () => void };
let pending=0;
export const useDeck=create<Store>((set,get)=>({
  view:null,busy:false,error:'',connected:!!globalThis.chrome?.runtime?.id,
  clearError:()=>set({error:''}),
  refresh:async()=>{
    if(!get().connected) return;
    try { const r=await chrome.runtime.sendMessage({type:'GET'});if(!r.ok) throw new Error(r.error);set({view:r.data}); } catch(e){set({error:String(e)});}
  },
  send:async command=>{
    if(!get().connected){set({error:'Load the built dist folder as an unpacked Chrome extension to control real windows.'});return false;}
    if(get().busy&&!['SELECT','LISTEN','MUTE_ALL','TOGGLE_MUTE'].includes(command.type)) return false;
    pending++;
    set({busy:true,error:''});
    try {const r=await chrome.runtime.sendMessage(command);if(!r.ok) throw new Error(r.error);set({view:r.data});return true;}
    catch(e){set({error:e instanceof Error?e.message:String(e)});await get().refresh();return false;}
    finally{pending--;set({busy:pending>0});}
  },
}));
