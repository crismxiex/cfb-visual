import {durableUrl,normalizeUrl,YOUTUBE_TV_HOST} from '../model';
import type {StreamShortcut} from './types';
export const DEFAULT_SERVICES:StreamShortcut[]=[
  {id:'disney',name:'Disney+ Mexico',url:'https://www.disneyplus.com/',domain:'disneyplus.com'},
  {id:'dazn',name:'DAZN Mexico',url:'https://www.dazn.com/',domain:'dazn.com'},
  {id:'youtube-tv',name:'YouTube TV',url:`https://${YOUTUBE_TV_HOST}/`,domain:YOUTUBE_TV_HOST},
];
export function customService(name:string,raw:string):StreamShortcut{
  const url=durableUrl(normalizeUrl(raw)),domain=new URL(url).hostname.replace(/^www\./,'');
  if(/(^|\.)(espn|espnplus|watchespn)\.com$/.test(domain)||/^espn/i.test(name.trim()))throw new Error('ESPN is a data source, not a streaming shortcut for Mexico.');
  if(!name.trim())throw new Error('Enter a shortcut name.');return {id:crypto.randomUUID(),name:name.trim().slice(0,40),url,domain};
}
export type LaunchResult={choices?:{id:number;title:string;url:string}[];focused?:number;opened?:number};
export function createStreamingLauncher(api:typeof chrome){
  async function focus(id:number){const tab=await api.tabs.get(id);if(tab.incognito)throw new Error('Choose a regular-profile Chrome tab.');await api.tabs.update(id,{active:true});await api.windows.update(tab.windowId,{focused:true});}
  return {focus,async launch(service:StreamShortcut,openHome=false):Promise<LaunchResult>{
    const windows=await api.windows.getAll({populate:true});
    const tabs=windows.filter(w=>!w.incognito&&['normal','popup'].includes(w.type||'')).flatMap(w=>w.tabs||[]).filter(t=>{
      try{const u=new URL(t.url||t.pendingUrl||'');return !t.incognito&&u.protocol==='https:'&&(u.hostname===service.domain||u.hostname.endsWith('.'+service.domain));}catch{return false;}
    });
    if(!openHome){
      const home=tabs.find(t=>{const u=new URL(t.url||t.pendingUrl!);return u.href===service.url||u.pathname==='/';});
      if(home){await focus(home.id!);return {focused:home.id};}
      // A playing game is never navigated to the service homepage.
      if(tabs.length===1){await focus(tabs[0].id!);return {focused:tabs[0].id};}
      if(tabs.length>1)return {choices:tabs.map(t=>({id:t.id!,title:t.title||'Streaming tab',url:t.url||t.pendingUrl!}))};
    }
    const normal=windows.find(w=>w.type==='normal'&&!w.incognito&&w.focused)||windows.find(w=>w.type==='normal'&&!w.incognito);
    if(normal){const tab=await api.tabs.create({windowId:normal.id,url:service.url,active:true});await api.windows.update(normal.id!,{focused:true});return {opened:tab.id};}
    const win=await api.windows.create({url:service.url,type:'normal',focused:true});return {opened:win?.tabs?.[0]?.id};
  }};
}
