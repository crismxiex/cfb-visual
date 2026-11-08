import {create} from 'zustand';
import type {SportsView} from './types';
import type {Command} from '../model';
type SportsStore={view:SportsView|null;busy:boolean;error:string;get:()=>Promise<void>;command:(command:Command)=>Promise<any>};
let pending=0;
export const useSports=create<SportsStore>((set,get)=>({view:null,busy:false,error:'',
  get:async()=>{if(!globalThis.chrome?.runtime?.id)return;try{const r=await chrome.runtime.sendMessage({type:'SPORTS_GET'});if(!r.ok)throw new Error(r.error);set({view:r.data});}catch(e){set({error:e instanceof Error?e.message:String(e)});}},
  command:async command=>{
    if(!globalThis.chrome?.runtime?.id){set({error:'Connect the installed GameDeck extension to use Sports Hub.'});return null;}
    pending++;set({busy:true,error:''});
    try{const r=await chrome.runtime.sendMessage(command);if(!r.ok)throw new Error(r.error);if(r.data?.settings&&r.data?.cache)set({view:r.data});return r.data;}
    catch(e){set({error:e instanceof Error?e.message:String(e)});return null;}
    finally{pending--;set({busy:pending>0});}
  },
}));
