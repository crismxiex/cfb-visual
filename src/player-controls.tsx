import { useState } from 'react';
import { Maximize2, Undo2 } from 'lucide-react';
import { playerOrigin } from './player-view-controller';
import { useDeck } from './store';

export function PlayerTools(){
  const {view,busy,connected,send}=useDeck();
  const [notice,setNotice]=useState('');
  const fit=view?.deck.playerFit||'contain';
  const count=Object.keys(view?.runtime.bindings||{}).length;
  async function clean(nextFit:'contain'|'cover',keys?:string[]){
    const current=useDeck.getState().view;
    const targets=Object.entries(current?.runtime.bindings||{}).filter(([key])=>!keys||keys.includes(key));
    const origins=[...new Set(targets.map(([,b])=>playerOrigin(current?.tabs.find(t=>t.id===b.tabId)?.url||'')).filter((origin):origin is string=>!!origin))];
    if(!origins.length){setNotice('Clean player view currently supports Disney+, DAZN and ESPN tabs.');return;}
    try{
      // Invoked directly by a user gesture; request only selected provider origins.
      const granted=await chrome.permissions.request({permissions:['scripting'],origins});
      if(!granted){setNotice('Optional page access was not granted. Your players are unchanged.');return;}
      setNotice('');await send({type:'PLAYER_VIEW',enabled:true,fit:nextFit,...(keys?{keys}:{})});
    }catch(error){setNotice(error instanceof Error?error.message:String(error));}
  }
  return <section className="player-tools" aria-label="Player presentation">
    <div className="player-tools-actions">
      <button className="button secondary" disabled={busy||!connected||!count} onClick={()=>void clean(fit)}><Maximize2 size={15}/>Clean player view</button>
      <label>Video framing <select aria-label="Video framing" value={fit} disabled={busy||!connected} onChange={e=>{
        const value=e.target.value as 'contain'|'cover';
        void send({type:'PLAYER_FIT',fit:value});
      }}><option value="contain">Fit · whole picture</option><option value="cover">Fill · crop edges</option></select></label>
      <button className="button secondary" disabled={busy||!connected||!count} onClick={()=>{setNotice('');void send({type:'PLAYER_VIEW',enabled:false,fit});}}><Undo2 size={14}/>Restore page controls</button>
    </div>
    <p>Expand the original playing video over the website controls. Fit keeps the whole picture; Fill crops proportionally. Chrome title bars remain. Escape restores controls.</p>
    {(notice||view?.runtime.playerViewReport)&&<p role="status">{notice||view?.runtime.playerViewReport}</p>}
  </section>;
}
