import { createController } from './controller';
const controller=createController(chrome);
const safe=(type:string)=>controller.request({type}).catch(console.error);
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(sender.id!==chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL('dashboard.html'))) return false;
  controller.request(message).then(data=>respond({ok:true,data}),error=>respond({ok:false,error:error.message}));return true;
});
chrome.action.onClicked.addListener(async()=>{
  const url=chrome.runtime.getURL('dashboard.html');
  const tabs=await chrome.tabs.query({});const existing=tabs.find(t=>t.url===url);
  if(existing){await chrome.tabs.update(existing.id!,{active:true});await chrome.windows.update(existing.windowId,{focused:true});}
  else await chrome.windows.create({url,type:'popup',width:1280,height:900});
});
chrome.runtime.onStartup.addListener(()=>safe('STARTUP'));
chrome.tabs.onRemoved.addListener(()=>safe('SYNC'));
chrome.tabs.onDetached.addListener(()=>safe('GET'));
chrome.tabs.onAttached.addListener(()=>safe('GET'));
chrome.tabs.onUpdated.addListener((_id,info)=>{if(info.url) safe('GET');});
chrome.system.display.onDisplayChanged.addListener(()=>safe('SYNC'));
const commands:Record<string,string>={promote:'PROMOTE','cycle-focus':'CYCLE_FOCUS','next-layout':'NEXT_LAYOUT','previous-layout':'PREVIOUS','minimize-secondary':'MINIMIZE_SECONDARY','restore-all':'RESTORE_ALL'};
chrome.commands.onCommand.addListener(async name=>{
  try {const view=await controller.request({type:'GET'});await controller.request({type:commands[name],key:view.deck.selected});}catch(error){console.error(error);}
});
