// @vitest-environment jsdom
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {controlPlayerAudio} from '../src/player-audio';

function video(owner:Document=document,width=960,height=540) {
  const media=owner.createElement('video');owner.body.append(media);media.src='https://example.com/original';
  Object.defineProperties(media,{paused:{value:false,configurable:true},ended:{value:false,configurable:true},readyState:{value:4,configurable:true}});
  vi.spyOn(media,'getBoundingClientRect').mockReturnValue({left:0,top:0,right:width,bottom:height,width,height,x:0,y:0,toJSON(){}});
  return media;
}
beforeEach(()=>{document.body.innerHTML='';});
afterEach(()=>vi.restoreAllMocks());

describe('original player audio',()=>{
  it('reads player mute and volume without changing playback or media',()=>{
    const v=video();v.volume=.23;v.muted=true;const play=vi.spyOn(v,'play'),pause=vi.spyOn(v,'pause'),load=vi.spyOn(v,'load');
    expect(controlPlayerAudio('read')).toMatchObject({available:true,volume:.23,muted:true});
    expect(controlPlayerAudio('listen')).toMatchObject({available:true,volume:.23,muted:false});
    expect(v.src).toBe('https://example.com/original');expect(play).not.toHaveBeenCalled();expect(pause).not.toHaveBeenCalled();expect(load).not.toHaveBeenCalled();
  });
  it('recovers zero volume and restores a chosen level on listening',()=>{
    const v=video();v.volume=0;v.muted=true;
    expect(controlPlayerAudio('listen').volume).toBe(.5);expect(v.muted).toBe(false);
    controlPlayerAudio('volume',0);expect(v.muted).toBe(true);
    expect(controlPlayerAudio('listen',.32)).toMatchObject({volume:.32,muted:false});
  });
  it('selects the main visible playing video and ignores hidden trailers',()=>{
    const hidden=video(document,1920,1080);hidden.style.display='none';
    const small=video(document,100,80),large=video();
    controlPlayerAudio('volume',.4);expect(large.volume).toBe(.4);expect(small.volume).toBe(1);expect(hidden.volume).toBe(1);
  });
  it('controls existing same-origin embedded and shadow players',()=>{
    const iframe=document.createElement('iframe');document.body.append(iframe);const inner=video(iframe.contentDocument!);
    expect(controlPlayerAudio('volume',.17).volume).toBe(.17);expect(inner.volume).toBe(.17);iframe.remove();
    const host=document.createElement('div');document.body.append(host);const shadow=host.attachShadow({mode:'open'}),v=video();shadow.append(v);
    expect(controlPlayerAudio('listen',.63).volume).toBe(.63);
  });
  it('never starts a paused player or invents an available control on an empty page',()=>{
    expect(controlPlayerAudio('read').available).toBe(false);
    const v=video();Object.defineProperty(v,'paused',{value:true});const play=vi.spyOn(v,'play');
    expect(controlPlayerAudio('listen')).toMatchObject({available:true,status:'Player paused'});expect(play).not.toHaveBeenCalled();
  });
  it('rejects invalid volume without touching the player and survives Chrome serialization',()=>{
    const v=video();for(const n of [NaN,Infinity,-.1,1.1])expect(()=>controlPlayerAudio('volume',n)).toThrow(/0 to 100/);expect(v.volume).toBe(1);
    const injected=Function(`return (${controlPlayerAudio.toString()})`)();expect(injected('listen',.35)).toMatchObject({volume:.35,muted:false});
  });
});
