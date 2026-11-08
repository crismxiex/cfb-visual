import { useEffect, useRef, useState } from 'react';
import { Headphones, Volume2, VolumeX } from 'lucide-react';
import { playerOrigin } from './player-view-controller';
import { useDeck } from './store';

function GameVolume({gameKey,title,volume,available,busy}:{gameKey:string;title:string;volume?:number;available:boolean;busy:boolean}) {
  const send=useDeck(s=>s.send);
  const [value,setValue]=useState(Math.round((volume??1)*100));
  const draft=useRef(value),dirty=useRef(false),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  useEffect(()=>{if(!dirty.current){const next=Math.round((volume??1)*100);draft.current=next;setValue(next);}},[volume]);
  useEffect(()=>()=>clearTimeout(timer.current),[]);
  function commit(){
    clearTimeout(timer.current);if(!dirty.current)return;dirty.current=false;
    void send({type:'SET_VOLUME',key:gameKey,volume:draft.current/100}).then(ok=>{
      if(!ok&&!dirty.current){const actual=useDeck.getState().view?.runtime.bindings[gameKey]?.playerAudio?.volume;draft.current=Math.round((actual??volume??1)*100);setValue(draft.current);}
    });
  }
  return <label className="game-volume" title={available?'Player volume':'Enable volume controls, start playback, then refresh audio'}>
    <input type="range" min="0" max="100" step="1" aria-label={`Volume for ${title}`} aria-valuetext={available?`${value}%`:'Unavailable'} disabled={!available||busy} value={value}
      onChange={e=>{draft.current=Number(e.target.value);setValue(draft.current);dirty.current=true;clearTimeout(timer.current);timer.current=setTimeout(commit,150);}}
      onPointerUp={commit} onKeyUp={commit} onBlur={commit}/>
    <output>{available?`${value}%`:'—'}</output>
  </label>;
}

export function GameAudio({gameKey}:{gameKey:string}) {
  const {view,busy,send}=useDeck();
  const binding=view?.runtime.bindings[gameKey];
  const tab=view?.tabs.find(t=>t.id===binding?.tabId);
  const game=view?.deck.games.find(g=>g.key===gameKey);
  const player=binding?.playerAudio;
  const muted=!!tab?.mutedInfo?.muted||!!player?.muted||player?.volume===0;
  const solo=!!tab&&!muted&&view?.runtime.audio?.mode==='solo'&&view.runtime.audio.key===gameKey&&Object.entries(view.runtime.bindings).every(([key,b])=>key===gameKey||view.tabs.find(t=>t.id===b.tabId)?.mutedInfo?.muted);
  return <div className="game-audio" onClick={e=>e.stopPropagation()} onKeyDown={e=>e.stopPropagation()}>
    <button className={`button secondary small listen-button ${solo?'listening':''}`} disabled={!tab||!view?.deck.audioEnabled} title="Hear only this game; mute the other managed games" aria-label={`Listen only to ${game?.title||'this game'}`} aria-pressed={solo} onClick={()=>void send({type:'LISTEN',key:gameKey})}><Headphones size={13}/>{solo?'Listening':'Listen'}</button>
    <button className={`icon-button ${muted?'audio-muted':''}`} disabled={!tab||!view?.deck.audioEnabled} title={muted?'Listen only to this tab':'Mute all managed tabs'} aria-label={`${muted?'Unmute':'Mute'} ${game?.title||'this game'}`} aria-pressed={muted} onClick={()=>void send({type:'TOGGLE_MUTE',key:gameKey})}>{muted?<VolumeX size={16}/>:<Volume2 size={16}/>}</button>
    <GameVolume gameKey={gameKey} title={game?.title||'this game'} volume={player?.volume} available={!!tab&&!!view?.deck.audioEnabled&&!!player?.available} busy={busy}/>
    {player&&!player.available&&<span className="player-audio-status" title={player.status}>Player volume unavailable</span>}
  </div>;
}

export function AudioBar() {
  const {view,busy,connected,send}=useDeck();
  const [notice,setNotice]=useState('');
  const games=view?.deck.games.filter(g=>view.runtime.bindings[g.key])||[];
  const enabled=games.filter(g=>{const b=view!.runtime.bindings[g.key];return !view?.tabs.find(t=>t.id===b.tabId)?.mutedInfo?.muted&&!b.playerAudio?.muted&&b.playerAudio?.volume!==0;});
  const value=enabled.length===1?enabled[0].key:enabled.length?'__multiple':'__silent';
  useEffect(()=>{
    if(!connected||!games.length)return;
    const timer=setInterval(()=>{const state=useDeck.getState();if(!document.hidden&&!state.busy&&state.view?.deck.audioEnabled)void state.send({type:'AUDIO_STATUS'});},5000);
    return()=>clearInterval(timer);
  },[connected,games.length]);
  async function enableVolume(){
    const current=useDeck.getState().view;
    const origins=[...new Set(Object.values(current?.runtime.bindings||{}).map(b=>playerOrigin(current?.tabs.find(t=>t.id===b.tabId)?.url||'')).filter((o):o is string=>!!o))];
    if(!origins.length){setNotice('Player volume supports Disney+, DAZN and ESPN. Other tabs still have Chrome mute controls.');return;}
    try {
      const granted=await chrome.permissions.request({permissions:['scripting'],origins});
      if(!granted){setNotice('Page access was not granted. Chrome tab mute controls are still available.');return;}
      setNotice('');await send({type:'AUDIO_STATUS'});
    }catch(error){setNotice(error instanceof Error?error.message:String(error));}
  }
  return <div className="audio-bar">
    <div className="audio-bar-title"><Headphones size={17}/><strong>Game audio</strong></div>
    <select aria-label="Choose game audio" disabled={!connected||!games.length||!view?.deck.audioEnabled} value={value} onChange={e=>void send(e.target.value==='__silent'?{type:'MUTE_ALL'}:{type:'LISTEN',key:e.target.value})}>
      <option value="__silent">All managed games muted</option>
      {enabled.length>1&&<option value="__multiple" disabled>Multiple games enabled</option>}
      {games.map(g=><option key={g.key} value={g.key}>{g.title}</option>)}
    </select>
    <button className="button secondary small" disabled={!games.length||!view?.deck.audioEnabled} onClick={()=>void send({type:'MUTE_ALL'})}><VolumeX size={14}/>Mute all</button>
    <button className="button secondary small" disabled={busy||!connected||!games.length||!view?.deck.audioEnabled} onClick={()=>void enableVolume()}>Enable volume controls</button>
    <button className="button secondary small" disabled={busy||!connected||!games.length||!view?.deck.audioEnabled} onClick={()=>void send({type:'AUDIO_STATUS'})}>Refresh audio</button>
    <label className="audio-toggle"><input type="checkbox" checked={view?.deck.audioFollowsMain??true} disabled={busy} onChange={e=>void send({type:'AUDIO_FOLLOWS_MAIN',enabled:e.target.checked})}/>Follow main game</label>
    <label className="audio-toggle"><input type="checkbox" checked={view?.deck.audioEnabled??true} disabled={busy} onChange={e=>void send({type:'AUDIO_ENABLED',enabled:e.target.checked})}/>Manage audio</label>
    <p>Adjust each game’s volume below. With page access enabled, Listen also unmutes the player and restores its volume.</p>
    {notice&&<p role="status">{notice}</p>}
  </div>;
}

export function TileAudioStatus({gameKey}:{gameKey:string}) {
  const {view}=useDeck();
  const binding=view?.runtime.bindings[gameKey];
  const tab=view?.tabs.find(t=>t.id===binding?.tabId);
  if(!tab)return null;
  const enabled=!tab.mutedInfo?.muted&&!binding?.playerAudio?.muted&&binding?.playerAudio?.volume!==0;
  return <span className={`tile-audio ${enabled?'enabled':''}`} aria-label={enabled?'Tab audio enabled':'Tab muted'} title={enabled?'Audio enabled':'Tab or player muted'}>{enabled?<Volume2 size={13}/>:<VolumeX size={13}/>}</span>;
}
