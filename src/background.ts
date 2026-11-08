import { createController } from './controller';
import {createScoreboardService,SCORE_ALARM} from './sports/service';
import {live,stale} from './sports/types';
const controller=createController(chrome);
const sports=createScoreboardService(chrome,controller);
sports.onChange(async({settings,cache})=>{
  const events=cache.events.filter(e=>settings.overlay.eventIds.length?settings.overlay.eventIds.includes(e.id):live(e));
  const freshness=cache.updatedAt?`${cache.providerName.split(' · ')[0]} · ${stale(cache)?'cached · ':''}${new Intl.DateTimeFormat('en-US',{timeZone:'America/Mexico_City',hour:'numeric',minute:'2-digit'}).format(new Date(cache.updatedAt))} MX`:'no data';
  const result=await controller.request({type:'SCORE_OVERLAY',enabled:settings.enabled&&settings.overlay.enabled,settings:settings.overlay,events,freshness});
  return result.runtime.overlayStatus;
});
const safe=(type:string)=>controller.request({type}).catch(console.error);
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(sender.id!==chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL('dashboard.html'))) return false;
  const target=typeof message.type==='string'&&message.type.startsWith('SPORTS_')?sports:controller;
  target.request(message).then(data=>respond({ok:true,data}),error=>respond({ok:false,error:error.message}));return true;
});
chrome.action.onClicked.addListener(async()=>{
  const url=chrome.runtime.getURL('dashboard.html');
  const tabs=await chrome.tabs.query({});const existing=tabs.find(t=>t.url===url);
  if(existing){await chrome.tabs.update(existing.id!,{active:true});await chrome.windows.update(existing.windowId,{focused:true});}
  else await chrome.windows.create({url,type:'popup',width:1280,height:900});
});
chrome.runtime.onStartup.addListener(()=>safe('STARTUP'));
chrome.runtime.onStartup.addListener(()=>void sports.startup().catch(console.error));
chrome.runtime.onInstalled.addListener(()=>void sports.startup().catch(console.error));
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name===SCORE_ALARM)void sports.refresh().catch(console.error);});
void sports.startup().catch(console.error);
const checkDashboardClosed=async()=>{
  try{const tabs=await chrome.tabs.query({});if(!tabs.some(t=>t.url?.startsWith(chrome.runtime.getURL('dashboard.html'))))await controller.request({type:'DASHBOARD_CLOSED'});}catch(error){console.error(error);}
};
chrome.tabs.onRemoved.addListener(id=>{controller.request({type:'TAB_CLOSED',tabId:id}).catch(console.error);void checkDashboardClosed();});
chrome.tabs.onDetached.addListener(()=>safe('GET'));
chrome.tabs.onAttached.addListener(()=>safe('GET'));
chrome.tabs.onUpdated.addListener((tabId,info)=>{
  if(info.mutedInfo)controller.request({type:'AUDIO_CHANGED',tabId,mutedInfo:info.mutedInfo}).catch(console.error);
  else if(info.url)safe('METADATA');
});
chrome.tabs.onReplaced.addListener((addedTabId,removedTabId)=>controller.request({type:'TAB_REPLACED',addedTabId,removedTabId}).catch(console.error));
chrome.system.display.onDisplayChanged.addListener(()=>safe('SYNC'));
chrome.windows.onRemoved.addListener(()=>void checkDashboardClosed());
const commands:Record<string,string>={promote:'PROMOTE','cycle-focus':'CYCLE_FOCUS','next-layout':'NEXT_LAYOUT','previous-layout':'PREVIOUS','minimize-secondary':'MINIMIZE_SECONDARY','restore-all':'RESTORE_ALL'};
chrome.commands.onCommand.addListener(async name=>{
  try {const view=await controller.request({type:'GET'});await controller.request({type:commands[name],key:view.deck.selected});}catch(error){console.error(error);}
});
