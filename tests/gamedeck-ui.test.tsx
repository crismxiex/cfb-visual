// @vitest-environment jsdom
import React,{act} from 'react';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {createRoot as actualCreateRoot} from 'react-dom/client';
import {emptyDeck,emptyRuntime} from '../src/model';
import {useDeck} from '../src/store';

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
