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
import {OverlayControls} from '../src/sports/ui';

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
it('Escape closes the tab picker and returns focus to the button that opened it',async()=>{
  const opener=[...container.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.includes('Add existing tab'))!;
  opener.focus();
  await act(async()=>opener.click());
  expect(container.querySelector('[aria-label="Add existing Chrome tab"]')).not.toBeNull();
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Search open tabs');
  await act(async()=>{document.activeElement!.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));});
  expect(container.querySelector('[aria-label="Add existing Chrome tab"]')).toBeNull();
  expect(document.activeElement).toBe(opener);
});
it('Escape cancels swap mode without moving any game',async()=>{
  await act(async()=>container.querySelector<HTMLButtonElement>('[title="Swap: choose another game on the layout map"]')!.click());
  expect(container.textContent).toContain('Press Esc to cancel');
  await act(async()=>{document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));});
  expect(container.textContent).not.toContain('Press Esc to cancel');
  expect(send).not.toHaveBeenCalled();
});
it('marks only the open sidebar section as the current page',async()=>{
  const current=()=>[...container.querySelectorAll('nav button[aria-current="page"]')].map(b=>b.getAttribute('aria-label'));
  expect(current()).toEqual(['Workspace']);
  await act(async()=>container.querySelector<HTMLButtonElement>('nav button[aria-label="Preferences"]')!.click());
  expect(current()).toEqual(['Preferences']);
});
it('leads with the layout map once games exist and with setup on an empty deck',async()=>{
  const before=(a:string,b:string)=>!!(container.querySelector(a)!.compareDocumentPosition(container.querySelector(b)!)&Node.DOCUMENT_POSITION_FOLLOWING);
  expect(before('.arrangement','.url-form')).toBe(true);
  expect(before('.lineup','.url-form')).toBe(true);
  expect(container.querySelector('[aria-label="Scores and setup"] .url-form')).not.toBeNull();
  const view=structuredClone(useDeck.getState().view!);view.deck.games=[];view.runtime.bindings={};
  await act(async()=>useDeck.setState({view}));
  expect(before('.url-form','.arrangement')).toBe(true);
  expect(container.querySelector('[aria-label="Scores and setup"]')).toBeNull();
});
async function connectPlayers(granted=true){
  const event={addListener:vi.fn(),removeListener:vi.fn()};
  const request=vi.fn(async()=>granted);
  vi.stubGlobal('chrome',{permissions:{request},storage:{onChanged:event},tabs:{onUpdated:event,onRemoved:event},system:{display:{onDisplayChanged:event}}});
  const view=structuredClone(useDeck.getState().view!);
  view.tabs[0].url='https://www.dazn.com/watch/1';
  view.tabs[1].url='https://www.disneyplus.com/watch/2';
  view.tabs[2].url='https://tv.youtube.com/watch/game';
  view.tabs[3].url='https://www.youtube.com/watch?v=example';
  await act(async()=>useDeck.setState({view,connected:true}));return request;
}
it('reloads a game from the lineup without selecting it for audio',async()=>{
  await connectPlayers();
  const button=container.querySelector<HTMLButtonElement>('[aria-label="Reload Game 2"]')!;
  expect(button.disabled).toBe(false);
  await act(async()=>button.click());
  expect(send).toHaveBeenCalledExactlyOnceWith({type:'RELOAD_TAB',key:'g2'});
});
it('Clean player view requests only the selected provider origins before sending its command',async()=>{
  const request=await connectPlayers();const button=[...container.querySelectorAll('button')].find(b=>b.textContent==='Clean player view')!;
  await act(async()=>button.click());expect(request).toHaveBeenCalledExactlyOnceWith({permissions:['scripting'],origins:['https://www.dazn.com/*','https://www.disneyplus.com/*','https://tv.youtube.com/*']});expect(send).toHaveBeenCalledWith({type:'PLAYER_VIEW',enabled:true,fit:'contain'});
});
it('denied player-view permission leaves the playing tabs untouched',async()=>{
  await connectPlayers(false);const button=[...container.querySelectorAll('button')].find(b=>b.textContent==='Clean player view')!;await act(async()=>button.click());expect(send).not.toHaveBeenCalled();expect(container.textContent).toContain('Your players are unchanged.');
});
it('Restore page controls needs no new permission request',async()=>{
  const request=await connectPlayers();const button=[...container.querySelectorAll('button')].find(b=>b.textContent==='Restore page controls')!;await act(async()=>button.click());expect(request).not.toHaveBeenCalled();expect(send).toHaveBeenCalledWith({type:'PLAYER_VIEW',enabled:false,fit:'contain'});
});
it('volume access requests only managed provider origins and refreshes the original players',async()=>{
  const request=await connectPlayers();await act(async()=>[...container.querySelectorAll('button')].find(b=>b.textContent==='Enable volume controls')!.click());
  expect(request).toHaveBeenCalledExactlyOnceWith({permissions:['scripting'],origins:['https://www.dazn.com/*','https://www.disneyplus.com/*','https://tv.youtube.com/*']});expect(send).toHaveBeenCalledExactlyOnceWith({type:'AUDIO_STATUS'});
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
  await act(async()=>[...container.querySelectorAll('button')].find(b=>b.textContent==='Sports Hub')!.click());return command;
}
it('selects NFL from the Sports Hub and shows its scores without college filters',async()=>{
  await connectPlayers();
  const command=await scores(false);
  const selector=container.querySelector<HTMLSelectElement>('[aria-label="Score league"]')!;
  await act(async()=>{selector.value='nfl';selector.dispatchEvent(new Event('change',{bubbles:true}));});
  expect(command).toHaveBeenCalledWith({type:'SPORTS_SETTINGS',patch:{league:'nfl'}});
  const current=useSports.getState().view!;
  const game=current.cache.events[0];
  const nfl={...game,provider:'espn-nfl',name:'Buffalo Bills at Miami Dolphins',
    away:{...game.away,id:'2',name:'Buffalo Bills',shortName:'Bills',abbreviation:'BUF'},
    home:{...game.home,id:'15',name:'Miami Dolphins',shortName:'Dolphins',abbreviation:'MIA'},
  };
  await act(async()=>useSports.setState({view:{
    ...current,settings:{...current.settings,league:'nfl',filter:'ranked',rankedOnly:true},
    cache:{...current.cache,events:[nfl]},
  }}));
  expect(container.querySelector('[aria-label="NFL Live"]')).not.toBeNull();
  expect(container.querySelector('.score-card')?.textContent).toContain('Bills');
  expect(container.querySelector('[aria-label="Conference filter"]')).toBeNull();
  expect(container.textContent).not.toContain('Top 25');
});
it('selects college basketball with Division I conferences, Top 25 and halves',async()=>{
  await connectPlayers();
  const command=await scores(false);
  const selector=container.querySelector<HTMLSelectElement>('[aria-label="Score league"]')!;
  await act(async()=>{selector.value='cbb';selector.dispatchEvent(new Event('change',{bubbles:true}));});
  expect(command).toHaveBeenCalledWith({type:'SPORTS_SETTINGS',patch:{league:'cbb'}});
  const current=useSports.getState().view!;
  const game=current.cache.events[0];
  const hoops={...game,provider:'espn-cbb',name:'Duke Blue Devils at North Carolina Tar Heels',status:'live' as const,quarter:2,clock:'4:12',
    away:{...game.away,id:'150',name:'Duke Blue Devils',shortName:'Duke',abbreviation:'DUKE',conferenceId:'2'},
    home:{...game.home,id:'153',name:'North Carolina Tar Heels',shortName:'North Carolina',abbreviation:'UNC',conferenceId:'2'},
  };
  await act(async()=>useSports.setState({view:{...current,settings:{...current.settings,league:'cbb',filter:'all'},cache:{...current.cache,events:[hoops]}}}));
  expect(container.querySelector('[aria-label="CBB Live"]')).not.toBeNull();
  const chips=[...container.querySelectorAll('.filter-chip')].map(b=>b.textContent);
  expect(chips).toEqual(['All D-I','Live','Top 25','Big Ten','SEC','Big 12','ACC','Big East','Favorites']);
  const conferences=[...container.querySelectorAll<HTMLOptionElement>('[aria-label="Conference filter"] option')].map(o=>o.textContent);
  expect(conferences).toContain('Missouri Valley');
  expect(container.querySelector('.score-card')?.textContent).toContain('ACC');
  expect(container.textContent).not.toContain('Oregon');
  await act(async()=>container.querySelector<HTMLElement>('[aria-label="Details for Duke Blue Devils at North Carolina Tar Heels"]')!.click());
  expect(container.querySelector('.score-details')?.textContent).toContain('Tip-off');
  expect(container.querySelector('.score-details')?.textContent).toContain('2nd half · 4:12');
});
it('shows YouTube TV alongside the Mexico streaming shortcuts',()=>{
  const services=container.querySelector('[aria-label="Streaming Services"]')!;expect(services.textContent).toContain('Disney+ Mexico');expect(services.textContent).toContain('DAZN Mexico');expect(services.textContent).toContain('YouTube TV');expect(services.textContent).not.toContain('ESPN');
});
it('a linked scoreboard card reuses the existing audio selection command',async()=>{
  await scores();await act(async()=>container.querySelector<HTMLElement>('.score-card')!.click());expect(send).toHaveBeenCalledExactlyOnceWith({type:'SELECT',key:'g3'});
});
it('scoreboard Make Main promotes through the existing controller with audio selection',async()=>{
  await scores();await act(async()=>[...container.querySelectorAll('.score-card-actions button')].find(b=>b.textContent==='Make Main')!.dispatchEvent(new MouseEvent('click',{bubbles:true})));expect(send).toHaveBeenCalledExactlyOnceWith({type:'PROMOTE',key:'g3',forceAudio:true});
});
it('an unlinked card opens manual linking instead of guessing an audio target',async()=>{
  const command=await scores(false);await act(async()=>container.querySelector<HTMLElement>('.score-card')!.click());expect(send).not.toHaveBeenCalled();expect(container.querySelector('[aria-label="Link scoreboard event to window"]')).not.toBeNull();await act(async()=>container.querySelector<HTMLElement>('.link-window-option')!.click());expect(command).toHaveBeenCalledWith({type:'SPORTS_LINK',key:'g1',eventId:'99',provider:'espn'});
});
it('Show ticker enables score updates and requests missing data and helper access together',async()=>{
  const request=await connectPlayers();const settings=defaults(),command=vi.fn(async()=>true);
  await act(async()=>{useSports.setState({view:{settings,cache:emptyCache(),access:false},command});root.render(<OverlayControls/>);});
  await act(async()=>[...container.querySelectorAll('button')].find(b=>b.textContent==='Show ticker')!.click());
  expect(request).toHaveBeenCalledWith({permissions:['nativeMessaging'],origins:['https://site.api.espn.com/*']});
  expect(command).toHaveBeenCalledWith({type:'SPORTS_SETTINGS',patch:{enabled:true,overlay:{enabled:true}}});
});
it('a failed desktop ticker has a retry action and shows the startup error',async()=>{
  const request=await connectPlayers();const settings=defaults();settings.enabled=true;settings.overlay.enabled=true;const cache=emptyCache();cache.overlayStatus='Desktop ticker unavailable: Native host not found';const command=vi.fn(async()=>true);
  await act(async()=>{useSports.setState({view:{settings,cache,access:true},command});root.render(<OverlayControls/>);});
  expect(container.textContent).toContain('Native host not found');await act(async()=>[...container.querySelectorAll('button')].find(b=>b.textContent==='Retry ticker')!.click());
  expect(request).toHaveBeenCalledWith({permissions:['nativeMessaging']});expect(command).toHaveBeenCalledWith({type:'SPORTS_RETRY_OVERLAY'});
});
it('opens the browser ticker using score access without requesting native permissions',async()=>{
  const request=await connectPlayers();const settings=defaults(),command=vi.fn(async()=>true);
  await act(async()=>{useSports.setState({view:{settings,cache:emptyCache(),access:false},command});root.render(<OverlayControls/>);});
  await act(async()=>[...container.querySelectorAll('button')].find(b=>b.textContent==='Open browser ticker')!.click());
  expect(request).toHaveBeenCalledExactlyOnceWith({origins:['https://site.api.espn.com/*']});expect(command.mock.calls.map(c=>c[0])).toEqual([{type:'SPORTS_SETTINGS',patch:{enabled:true}},{type:'SPORTS_BROWSER_TICKER'}]);
});
