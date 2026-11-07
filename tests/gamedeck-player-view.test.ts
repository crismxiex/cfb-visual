// @vitest-environment jsdom
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {setCleanPlayerView} from '../src/clean-player';
import {createPlayerViewController,playerOrigin} from '../src/player-view-controller';
import {emptyDeck,emptyRuntime} from '../src/model';

function playingVideo(owner:Document=document,width=960,height=540){
  const video=owner.createElement('video');video.src='https://example.com/original';video.controls=true;owner.body.append(video);
  Object.defineProperties(video,{paused:{value:false,configurable:true},ended:{value:false,configurable:true},readyState:{value:4,configurable:true}});
  vi.spyOn(video,'getBoundingClientRect').mockReturnValue({left:0,top:0,right:width,bottom:height,width,height,x:0,y:0,toJSON(){}});
  return video;
}
beforeEach(()=>{document.body.innerHTML='';document.body.removeAttribute('style');document.documentElement.removeAttribute('style');vi.stubGlobal('getComputedStyle',()=>({display:'block',visibility:'visible',opacity:'1'}));});
afterEach(()=>{setCleanPlayerView('restore');vi.unstubAllGlobals();vi.restoreAllMocks();});

describe('Saturday-style clean player presentation',()=>{
  it('styles the same playing element, changes framing without distortion, and restores exact styles and controls',()=>{
    const video=playingVideo();video.style.setProperty('object-fit','scale-down','important');video.style.position='relative';
    const parent=video.parentElement,source=video.src;const pause=vi.spyOn(video,'pause'),play=vi.spyOn(video,'play'),load=vi.spyOn(video,'load');
    expect(setCleanPlayerView('enable','contain').applied).toBe(true);expect(video.parentElement).toBe(parent);expect(video.src).toBe(source);expect(video.controls).toBe(false);expect(video.style.objectFit).toBe('contain');expect(video.style.width).toBe('100vw');
    setCleanPlayerView('enable','cover');expect(video.style.objectFit).toBe('cover');expect(document.querySelectorAll('[aria-label="Exit GameDeck clean player view"]')).toHaveLength(1);
    setCleanPlayerView('restore');expect(video.style.position).toBe('relative');expect(video.style.objectFit).toBe('scale-down');expect(video.style.getPropertyPriority('object-fit')).toBe('important');expect(video.controls).toBe(true);expect(video.style.width).toBe('');
    expect(pause).not.toHaveBeenCalled();expect(play).not.toHaveBeenCalled();expect(load).not.toHaveBeenCalled();
  });
  it('is self-contained when serialized for Chrome injection',()=>{const video=playingVideo();const serialized=Function(`return (${setCleanPlayerView.toString()})`)();expect(serialized('enable','contain').applied).toBe(true);expect(video.style.position).toBe('fixed');});
  it('does not restyle paused/login pages',()=>{const video=playingVideo();Object.defineProperty(video,'paused',{value:true,configurable:true});expect(setCleanPlayerView('enable').applied).toBe(false);expect(video.style.position).toBe('');expect(document.body.children).toHaveLength(1);});
  it('changing Fit/Fill does not reactivate a view the user restored',()=>{const video=playingVideo();setCleanPlayerView('enable');setCleanPlayerView('restore');expect(setCleanPlayerView('fit','cover').applied).toBe(false);expect(video.style.position).toBe('');expect(video.controls).toBe(true);});
  it('restores controls on pause and does not reapply after the user restores them',()=>{const video=playingVideo();setCleanPlayerView('enable');video.dispatchEvent(new Event('pause'));expect(video.style.position).toBe('');expect(video.controls).toBe(true);expect(document.querySelector('button')).toBeNull();});
  it('restores after provider replacement without reparenting or creating video elements',async()=>{const video=playingVideo();const parent=video.parentElement;setCleanPlayerView('enable');video.remove();await new Promise(r=>setTimeout(r,0));expect(video.style.position).toBe('');expect(parent?.querySelector('button')).toBeNull();expect(document.querySelectorAll('video')).toHaveLength(0);});
  it('Escape and the visible restore button both restore page presentation',()=>{const video=playingVideo();setCleanPlayerView('enable');window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));expect(video.controls).toBe(true);setCleanPlayerView('enable');(document.querySelector('button') as HTMLButtonElement).click();expect(video.style.position).toBe('');});
  it('can expand an existing same-origin embedded player and restore its frame',()=>{const frame=document.createElement('iframe');document.body.append(frame);const video=playingVideo(frame.contentDocument!);expect(setCleanPlayerView('enable').applied).toBe(true);expect(frame.style.position).toBe('fixed');expect(video.ownerDocument).toBe(frame.contentDocument);setCleanPlayerView('restore');expect(frame.style.position).toBe('');});
  it('chooses the largest visible playing video',()=>{const small=playingVideo(document,200,100),large=playingVideo();setCleanPlayerView('enable');expect(large.style.position).toBe('fixed');expect(small.style.position).toBe('');});
});

describe('optional clean player access',()=>{
  function fixture(){const deck=emptyDeck(),runtime=emptyRuntime();deck.games=[{key:'game',title:'Game',url:'https://www.dazn.com/watch/1',slot:0}];runtime.bindings.game={tabId:7,windowId:10,originalWindowId:1,originalIndex:0,originalBounds:{left:0,top:0,width:800,height:600},originalPinned:false,originalDiscardable:true,managed:true};const calls:any[]=[];const api:any={tabs:{get:async()=>({id:7,url:deck.games[0].url})},permissions:{contains:vi.fn(async()=>false)},scripting:{executeScript:vi.fn(async(props:any)=>{calls.push(props);return [{frameId:0,result:{applied:props.args[0]==='enable'}}];})}};return {deck,runtime,api,calls,controller:createPlayerViewController(api,()=>deck,()=>runtime)};}
  it('only recognizes supported HTTPS provider origins',()=>{expect(playerOrigin('https://www.espn.com/watch')).toBe('https://www.espn.com/*');expect(playerOrigin('https://dazn.com.evil.test')).toBeNull();expect(playerOrigin('http://dazn.com')).toBeNull();});
  it('never injects without optional scripting and selected-origin permission',async()=>{const f=fixture();await f.controller.set(true,'contain');expect(f.calls).toEqual([]);expect(f.runtime.playerViewReport).toContain('allow optional page access');expect(f.api.permissions.contains).toHaveBeenCalledWith({permissions:['scripting'],origins:['https://www.dazn.com/*']});});
  it('injects only into the existing selected main frame and restores on request',async()=>{const f=fixture();f.api.permissions.contains.mockResolvedValue(true);await f.controller.set(true,'cover');expect(f.calls[0]).toMatchObject({target:{tabId:7,frameIds:[0]},world:'ISOLATED',args:['enable','cover']});expect(f.runtime.bindings.game.playerViewEnabled).toBe(true);await f.controller.set(false,'cover');expect(f.calls[1].args).toEqual(['restore','cover']);expect(f.runtime.bindings.game.playerViewEnabled).toBe(false);});
  it('reports paused or inaccessible players and continues without moving windows',async()=>{const f=fixture();f.api.permissions.contains.mockResolvedValue(true);f.api.scripting.executeScript.mockResolvedValue([{frameId:0,result:{applied:false,reason:'Start playback first.'}}]);await f.controller.set(true,'contain');expect(f.runtime.playerViewReport).toContain('Start playback first');expect(f.runtime.playerViewReport).toContain('0 of 1');});
});
