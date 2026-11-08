// @vitest-environment jsdom
import React,{act} from 'react';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {createRoot as actualCreateRoot} from 'react-dom/client';
import {emptyDeck,emptyRuntime} from '../src/model';
import {useDeck} from '../src/store';
import {useSports} from '../src/sports/store';
import {defaults,emptyCache} from '../src/sports/types';

vi.mock('react-dom/client',async importOriginal=>{
  const actual=await importOriginal<typeof import('react-dom/client')>();
  return {...actual,createRoot:vi.fn(()=>({render:vi.fn()}))};
});
import {App} from '../src/main';

let root:ReturnType<typeof actualCreateRoot>,container:HTMLDivElement;
const send=vi.fn(async()=>true);
beforeEach(async()=>{
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
  const {createRoot}=await vi.importActual<typeof import('react-dom/client')>('react-dom/client');
  container=document.createElement('div');document.body.append(container);root=createRoot(container);send.mockClear();
  useSports.setState({view:null,busy:false,error:''});
  const games=[1,2,3,4].map((id,slot)=>({key:`g${id}`,title:`Game ${id}`,slot,url:`https://example.com/${id}`}));
  useDeck.setState({view:{deck:{...emptyDeck(),layout:'four-main',games},runtime:{...emptyRuntime(),audio:{mode:'solo',key:'g1'},bindings:Object.fromEntries(games.map((g,i)=>[g.key,{tabId:i+1,windowId:10+i,originalWindowId:1,originalIndex:i,originalBounds:{left:0,top:0,width:800,height:600},originalPinned:false,originalDiscardable:true,managed:true}]))},tabs:games.map((_g,i)=>({id:i+1,windowId:10+i,index:0,active:true,pinned:false,highlighted:false,incognito:false,selected:false,discarded:false,autoDiscardable:false,mutedInfo:{muted:i!==0}})),windows:[],displays:[]},busy:false,error:'',connected:false,send,refresh:async()=>{}});
  await act(async()=>root.render(<App/>));
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.unstubAllGlobals();});
const tile=(n:number)=>container.querySelector(`[role="button"][aria-label="Listen to Game ${n}"]`)!;
it('clicking a whole game tile sends audio selection without a layout command',async()=>{
  await act(async()=>tile(3).dispatchEvent(new MouseEvent('click',{bubbles:true})));
  expect(send).toHaveBeenCalledExactlyOnceWith({type:'SELECT',key:'g3'});
});
it('Enter and Space on a focused tile select audio accessibly',async()=>{
  await act(async()=>tile(3).dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})));
  await act(async()=>tile(2).dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true})));
  expect(send.mock.calls.map(c=>c[0])).toEqual([{type:'SELECT',key:'g3'},{type:'SELECT',key:'g2'}]);
});
it('Make main does not also fire the tile audio click handler',async()=>{
  const button=tile(2).querySelector('button[title="Make main game"]')!;
  await act(async()=>button.dispatchEvent(new MouseEvent('click',{bubbles:true})));
  expect(send).toHaveBeenCalledExactlyOnceWith({type:'PROMOTE',key:'g2'});
});
it('dragging into main sends a slot move and suppresses the synthetic click',async()=>{
  let key='';const dataTransfer={setData:(_format:string,value:string)=>{key=value;},getData:()=>key};
  const event=(type:string)=>{const e=new Event(type,{bubbles:true,cancelable:true});Object.defineProperty(e,'dataTransfer',{value:dataTransfer});return e;};
  await act(async()=>tile(4).dispatchEvent(event('dragstart')));
  await act(async()=>tile(1).dispatchEvent(event('drop')));
  await act(async()=>tile(1).dispatchEvent(new MouseEvent('click',{bubbles:true})));
  expect(send).toHaveBeenCalledExactlyOnceWith({type:'MOVE_SLOT',key:'g4',slot:0});
});
it('shows active audio separately from main position and marks other games muted',()=>{
  expect(tile(1).classList.contains('audio-active')).toBe(true);
  expect(tile(1).querySelector('[aria-label="Tab audio enabled"]')).not.toBeNull();
  expect(tile(2).querySelector('[aria-label="Tab muted"]')).not.toBeNull();
});
async function connectPlayers(granted=true){
  const event={addListener:vi.fn(),removeListener:vi.fn()};
  const request=vi.fn(async()=>granted);
  vi.stubGlobal('chrome',{permissions:{request},storage:{onChanged:event},tabs:{onUpdated:event,onRemoved:event},system:{display:{onDisplayChanged:event}}});
  const view=structuredClone(useDeck.getState().view!);
  view.tabs.forEach((t,i)=>t.url=i===1?'https://www.disneyplus.com/watch/2':'https://www.dazn.com/watch/'+i);
  await act(async()=>useDeck.setState({view,connected:true}));return request;
}
it('Clean player view requests only the selected provider origins before sending its command',async()=>{
  const request=await connectPlayers();const button=[...container.querySelectorAll('button')].find(b=>b.textContent==='Clean player view')!;
  await act(async()=>button.click());expect(request).toHaveBeenCalledExactlyOnceWith({permissions:['scripting'],origins:['https://www.dazn.com/*','https://www.disneyplus.com/*']});expect(send).toHaveBeenCalledWith({type:'PLAYER_VIEW',enabled:true,fit:'contain'});
});
it('denied player-view permission leaves the playing tabs untouched',async()=>{
  await connectPlayers(false);const button=[...container.querySelectorAll('button')].find(b=>b.textContent==='Clean player view')!;await act(async()=>button.click());expect(send).not.toHaveBeenCalled();expect(container.textContent).toContain('Your players are unchanged.');
});
it('Restore page controls needs no new permission request',async()=>{
  const request=await connectPlayers();const button=[...container.querySelectorAll('button')].find(b=>b.textContent==='Restore page controls')!;await act(async()=>button.click());expect(request).not.toHaveBeenCalled();expect(send).toHaveBeenCalledWith({type:'PLAYER_VIEW',enabled:false,fit:'contain'});
});
it('volume access requests only managed provider origins and refreshes the original players',async()=>{
  const request=await connectPlayers();await act(async()=>[...container.querySelectorAll('button')].find(b=>b.textContent==='Enable volume controls')!.click());
  expect(request).toHaveBeenCalledExactlyOnceWith({permissions:['scripting'],origins:['https://www.dazn.com/*','https://www.disneyplus.com/*']});expect(send).toHaveBeenCalledExactlyOnceWith({type:'AUDIO_STATUS'});
});
it('denied volume access leaves players unchanged and explains that tab mute remains available',async()=>{
  await connectPlayers(false);await act(async()=>[...container.querySelectorAll('button')].find(b=>b.textContent==='Enable volume controls')!.click());expect(send).not.toHaveBeenCalled();expect(container.textContent).toContain('Chrome tab mute controls are still available');
  expect([...container.querySelectorAll<HTMLInputElement>('input[type="range"]')].every(input=>input.disabled)).toBe(true);
});
it('a volume slider sends its chosen value without selecting a game or moving windows',async()=>{
  const view=structuredClone(useDeck.getState().view!);view.runtime.bindings.g2.playerAudio={available:true,volume:.6,muted:false,status:''};
  await act(async()=>useDeck.setState({view}));
  const input=container.querySelector<HTMLInputElement>('[aria-label="Volume for Game 2"]')!;
  expect(input.disabled).toBe(false);expect(input.value).toBe('60');
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'35');input.dispatchEvent(new Event('input',{bubbles:true}));});
  await act(async()=>input.dispatchEvent(new KeyboardEvent('keyup',{key:'ArrowLeft',bubbles:true})));
  expect(send).toHaveBeenCalledExactlyOnceWith({type:'SET_VOLUME',key:'g2',volume:.35});
});
it('an in-player mute is shown in the Command Center even if Chrome has the tab unmuted',async()=>{
  const view=structuredClone(useDeck.getState().view!);view.runtime.bindings.g1.playerAudio={available:true,volume:.4,muted:true,status:''};await act(async()=>useDeck.setState({view}));
  expect(container.querySelector('[aria-label="Unmute Game 1"]')).not.toBeNull();expect(tile(1).querySelector('[aria-label="Tab muted"]')).not.toBeNull();
});
async function scores(linked=true){
  const settings=defaults();settings.enabled=true;if(linked)settings.links.g3={provider:'espn',eventId:'99',confirmedAt:1};
  const cache=emptyCache();cache.date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Mexico_City',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());cache.updatedAt=Date.now();cache.events=[{id:'99',provider:'espn',name:'BYU Cougars at Utah Utes',date:new Date().toISOString(),home:{id:'254',name:'Utah Utes',shortName:'Utah',abbreviation:'UTAH',score:14},away:{id:'252',name:'BYU Cougars',shortName:'BYU',abbreviation:'BYU',score:7},status:'live',statusText:'Q3 · 8:00',quarter:3,clock:'8:00',networks:[]}];
  const command=vi.fn(async()=>({settings,cache,access:true}));
  await act(async()=>useSports.setState({view:{settings,cache,access:true},command}));
  await act(async()=>[...container.querySelectorAll('button')].find(b=>b.textContent==='CFB Live')!.click());return command;
}
it('only Disney+ and DAZN appear as default streaming-service destinations',()=>{
  const services=container.querySelector('[aria-label="Streaming Services"]')!;expect(services.textContent).toContain('Disney+ Mexico');expect(services.textContent).toContain('DAZN Mexico');expect(services.textContent).not.toContain('ESPN');
});
it('a linked scoreboard card reuses the existing audio selection command',async()=>{
  await scores();await act(async()=>container.querySelector<HTMLElement>('.score-card')!.click());expect(send).toHaveBeenCalledExactlyOnceWith({type:'SELECT',key:'g3'});
});
it('scoreboard Make Main promotes through the existing controller with audio selection',async()=>{
  await scores();await act(async()=>[...container.querySelectorAll('.score-card-actions button')].find(b=>b.textContent==='Make Main')!.dispatchEvent(new MouseEvent('click',{bubbles:true})));expect(send).toHaveBeenCalledExactlyOnceWith({type:'PROMOTE',key:'g3',forceAudio:true});
});
it('an unlinked card opens manual linking instead of guessing an audio target',async()=>{
  const command=await scores(false);await act(async()=>container.querySelector<HTMLElement>('.score-card')!.click());expect(send).not.toHaveBeenCalled();expect(container.querySelector('[aria-label="Link scoreboard event to window"]')).not.toBeNull();await act(async()=>container.querySelector<HTMLElement>('.link-window-option')!.click());expect(command).toHaveBeenCalledWith({type:'SPORTS_LINK',key:'g1',eventId:'99'});
});
