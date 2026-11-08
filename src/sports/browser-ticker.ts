import {displayArea} from '../model';
import type {Command,View} from '../model';

export async function openBrowserTicker(api:typeof chrome,controller:{request:(message:Command)=>Promise<View>},position:'top'|'bottom') {
  const url=api.runtime.getURL('dashboard.html?view=ticker');
  const existing=(await api.tabs.query({})).find(tab=>tab.url===url&&!tab.incognito);
  if(existing){
    const win=await api.windows.get(existing.windowId);
    if(win.state==='minimized')await api.windows.update(existing.windowId,{state:'normal'});
    await api.tabs.update(existing.id!,{active:true});await api.windows.update(existing.windowId,{focused:true});return {focused:existing.id};
  }
  const {deck,displays}=await controller.request({type:'GET'});
  const display=displays.find(d=>d.id===deck.displayId)||displays.find(d=>d.isPrimary)||displays[0];
  if(!display)throw new Error('Connect a display before opening the browser ticker.');
  const area=displayArea(display,deck.displayMode),height=Math.min(180,area.height);
  const win=await api.windows.create({url,type:'popup',focused:true,left:area.left,top:position==='top'?area.top:area.top+area.height-height,width:area.width,height});
  return {opened:win?.id};
}
