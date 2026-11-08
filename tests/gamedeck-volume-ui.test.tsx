// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {it,expect,vi} from 'vitest';
import {GameAudio} from '../src/audio';
import {useDeck} from '../src/store';
import {emptyDeck,emptyRuntime} from '../src/model';

it('keeps dragging enabled during an update and coalesces pending changes to the final value',async()=>{
  vi.useFakeTimers();(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
  let finish:()=>void=()=>{};
  const first=new Promise<void>(resolve=>finish=resolve);
  const view:any={deck:{...emptyDeck(),games:[{key:'g',title:'Game',slot:0,url:'https://www.dazn.com/watch/1'}]},runtime:{...emptyRuntime(),bindings:{g:{tabId:1,playerAudio:{available:true,volume:.6,muted:false,status:''}}}},tabs:[{id:1,mutedInfo:{muted:false}}],windows:[],displays:[]};
  const commands:any[]=[];
  vi.stubGlobal('chrome',{runtime:{sendMessage:vi.fn(async command=>{
    commands.push(command);if(commands.length===1)await first;
    const updated=structuredClone(view);updated.runtime.bindings.g.playerAudio.volume=command.volume;return {ok:true,data:updated};
  })}});
  useDeck.setState({view,connected:true,busy:false});const el=document.createElement('div');document.body.append(el);const root=createRoot(el);
  try{
    await act(async()=>root.render(<GameAudio gameKey="g"/>));const range=el.querySelector('input')!;
    async function change(value:string){await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(range,value);range.dispatchEvent(new Event('input',{bubbles:true}));});}
    await change('35');await act(async()=>vi.advanceTimersByTime(150));expect(range.disabled).toBe(false);expect(useDeck.getState().busy).toBe(true);
    await change('50');await act(async()=>vi.advanceTimersByTime(150));await change('85');
    await act(async()=>range.dispatchEvent(new Event('pointerup',{bubbles:true})));expect(commands).toHaveLength(1);
    await act(async()=>{finish();await first;});
    expect(commands).toEqual([{type:'SET_VOLUME',key:'g',volume:.35},{type:'SET_VOLUME',key:'g',volume:.85}]);
    expect(range.value).toBe('85');expect(useDeck.getState().busy).toBe(false);
  }finally{finish();await act(async()=>root.unmount());el.remove();vi.useRealTimers();vi.unstubAllGlobals();}
});
