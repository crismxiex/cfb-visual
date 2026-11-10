import { setCleanPlayerView } from './clean-player';
import { playerProvider } from './model';
import type { Deck, Runtime } from './model';

export function playerOrigin(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || !playerProvider(url.hostname)) return null;
    return `${url.origin}/*`;
  } catch {
    return null;
  }
}
export function createPlayerViewController(api: typeof chrome, getDeck:()=>Deck, getRuntime:()=>Runtime) {
  async function set(enabled:boolean,fit:Deck['playerFit'],keys?:string[],updateOnly=false) {
    if(!['contain','cover'].includes(fit))throw new Error('Choose Fit or Fill.');
    const deck=getDeck(),runtime=getRuntime();
    const games=deck.games.filter(g=>!keys||keys.includes(g.key));
    const details:string[]=[];let applied=0,available=0;
    for(const game of games){
      const binding=runtime.bindings[game.key];if(!binding)continue;
      try{
        const tab=await api.tabs.get(binding.tabId),origin=playerOrigin(tab.url||'');
        if(!origin){if(enabled)details.push(`${game.title}: clean view supports Disney+, DAZN, ESPN, and YouTube TV.`);continue;}
        available++;
        if(!api.permissions||!api.scripting||!await api.permissions.contains({permissions:['scripting'],origins:[origin]})){
          details.push(`${game.title}: allow optional page access using Clean player view.`);continue;
        }
        const results=await api.scripting.executeScript({target:{tabId:binding.tabId,frameIds:[0]},world:'ISOLATED',func:setCleanPlayerView,args:[updateOnly?'fit':enabled?'enable':'restore',fit]});
        const result=results[0]?.result;
        binding.playerViewEnabled=!!result?.applied;
        if(enabled&&result?.applied)applied++;
        else if(enabled)details.push(`${game.title}: ${result?.reason||'Start playback first, then try clean view again.'}`);
      }catch(error){details.push(`${game.title}: ${error instanceof Error?error.message:String(error)}`);}
    }
    if(enabled)deck.playerFit=fit;
    runtime.playerViewReport=enabled?`Last applied: ${applied} of ${available} supported players. Pausing or replacing a video restores its page controls.`:'Restored page controls where optional page access is available.';
    if(details.length)runtime.playerViewReport+=' '+details.join(' ');
  }
  return {set};
}
