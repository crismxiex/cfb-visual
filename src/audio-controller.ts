import { mainGameKey } from './model';
import type { Binding, Deck, Runtime } from './model';

// Called only by the controller's serialized command queue. Actual tab flags are
// authoritative; the selected key is published after all Chrome writes resolve.
export function createAudioController(api: typeof chrome, getDeck:()=>Deck, getRuntime:()=>Runtime) {
  const live=async(id:number)=>{try{return await api.tabs.get(id);}catch{return null;}};
  async function write(binding:Binding,muted:boolean) {
    const tab=await api.tabs.get(binding.tabId);
    binding.originalMuted ??= !!tab.mutedInfo?.muted;
    if(!!tab.mutedInfo?.muted===muted&&(binding.manualAudioOverride||tab.mutedInfo?.reason==='user'))return;
    binding.manualAudioOverride=false;
    await api.tabs.update(binding.tabId,{muted});
    binding.lastAudioWrite=muted;
  }
  async function select(key:string|null) {
    const runtime=getRuntime(),deck=getDeck();
    if(!deck.audioEnabled)throw new Error('Enable GameDeck audio management to choose a game.');
    const target=key===null?undefined:runtime.bindings[key];
    if(key!==null&&(!target||!await live(target.tabId)))throw new Error('This game is unavailable. Reconnect it before selecting its audio.');
    const results=await Promise.allSettled(Object.entries(runtime.bindings).filter(([k])=>k!==key).map(async([,b])=>{
      try{await write(b,true);}catch(error){if(await live(b.tabId))throw error;}
    }));
    const failure=results.find(r=>r.status==='rejected');
    if(failure?.status==='rejected'){runtime.audio={mode:'silent',key:null};throw failure.reason;}
    if(target){try{await write(target,false);}catch(error){runtime.audio={mode:'silent',key:null};throw error;}}
    runtime.audio={mode:key===null?'silent':'solo',key};
  }
  async function restore(binding:Binding) {
    if(binding.lastAudioWrite===undefined||binding.originalMuted===undefined)return;
    const tab=await live(binding.tabId);
    if(!tab)return;
    const manual=tab.mutedInfo?.reason==='user'||(tab.mutedInfo?.reason==='extension'&&!!tab.mutedInfo.extensionId&&tab.mutedInfo.extensionId!==api.runtime?.id);
    if(!binding.manualAudioOverride&&!manual&&!!tab.mutedInfo?.muted===binding.lastAudioWrite)await api.tabs.update(binding.tabId,{muted:binding.originalMuted});
    delete binding.lastAudioWrite;delete binding.manualAudioOverride;delete binding.originalMuted;
  }
  async function sync(tabs:chrome.tabs.Tab[], initialize=false) {
    const deck=getDeck(),runtime=getRuntime();
    if(!deck.audioEnabled)return;
    const bound=Object.entries(runtime.bindings);
    const enabled=bound.filter(([,b])=>{const tab=tabs.find(t=>t.id===b.tabId);return tab&&!tab.mutedInfo?.muted;});
    if(initialize&&runtime.audio.mode==='preserve'){
      const key=mainGameKey(deck);const available=key&&runtime.bindings[key]?key:bound[0]?.[0]??null;
      if(available)await select(available);return;
    }
    if(runtime.audio.key&&!runtime.bindings[runtime.audio.key]){
      const main=mainGameKey(deck);const fallback=main&&runtime.bindings[main]?main:null;
      await select(fallback);return;
    }
    if(runtime.audio.mode==='solo'&&!enabled.some(([key])=>key===runtime.audio.key))runtime.audio={mode:'silent',key:null};
  }
  async function changed(tabId:number,muted:chrome.tabs.MutedInfo) {
    const runtime=getRuntime(),deck=getDeck();
    const entry=Object.entries(runtime.bindings).find(([,b])=>b.tabId===tabId);if(!entry||!deck.audioEnabled)return;
    const [key,binding]=entry;
    const ours=muted.reason==='extension'&&muted.extensionId===api.runtime?.id;
    if(ours)return;
    const current=await live(tabId);
    if(!current||!!current.mutedInfo?.muted!==muted.muted||(current.mutedInfo?.reason==='extension'&&current.mutedInfo.extensionId===api.runtime?.id))return;
    binding.manualAudioOverride=true;
    if(muted.muted){if(runtime.audio.key===key)runtime.audio={mode:'silent',key:null};return;}
    // A manual unmute designates that game and only mutes the other games.
    const results=await Promise.allSettled(Object.entries(runtime.bindings).filter(([k])=>k!==key).map(([,b])=>write(b,true)));
    if(results.some(r=>r.status==='rejected')){runtime.audio={mode:'silent',key:null};throw new Error('Could not mute another managed game after a manual audio change.');}
    runtime.audio={mode:'solo',key};
  }
  return {select,restore,sync,changed,write,
    async mainChanged(previous:string|null) {const deck=getDeck(),main=mainGameKey(deck);if(deck.audioEnabled&&deck.audioFollowsMain&&main!==previous)await select(main&&getRuntime().bindings[main]?main:null);},
    async added(key:string) {const deck=getDeck(),runtime=getRuntime();if(!deck.audioEnabled)return;if(runtime.audio.mode==='preserve')await select(mainGameKey(deck)||key);else await write(runtime.bindings[key],runtime.audio.mode==='silent'||runtime.audio.key!==key);},
  };
}
