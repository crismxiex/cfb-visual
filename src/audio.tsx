import { Headphones, Volume2, VolumeX } from 'lucide-react';
import { useDeck } from './store';

export function GameAudio({gameKey}:{gameKey:string}) {
  const {view,busy,send}=useDeck();
  const binding=view?.runtime.bindings[gameKey];
  const tab=view?.tabs.find(t=>t.id===binding?.tabId);
  const game=view?.deck.games.find(g=>g.key===gameKey);
  const muted=!!tab?.mutedInfo?.muted;
  const solo=!!tab&&!muted&&view?.runtime.audio?.mode==='solo'&&view.runtime.audio.key===gameKey&&Object.entries(view.runtime.bindings).every(([key,b])=>key===gameKey||view.tabs.find(t=>t.id===b.tabId)?.mutedInfo?.muted);
  return <div className="game-audio" onClick={e=>e.stopPropagation()}>
    <button className={`button secondary small listen-button ${solo?'listening':''}`} disabled={!tab||!view?.deck.audioEnabled} title="Hear only this game; mute the other managed games" aria-label={`Listen only to ${game?.title||'this game'}`} aria-pressed={solo} onClick={()=>void send({type:'LISTEN',key:gameKey})}><Headphones size={13}/>{solo?'Listening':'Listen'}</button>
    <button className={`icon-button ${muted?'audio-muted':''}`} disabled={!tab||!view?.deck.audioEnabled} title={muted?'Listen only to this tab':'Mute all managed tabs'} aria-label={`${muted?'Unmute':'Mute'} ${game?.title||'this game'}`} aria-pressed={muted} onClick={()=>void send({type:'TOGGLE_MUTE',key:gameKey})}>{muted?<VolumeX size={16}/>:<Volume2 size={16}/>}</button>
  </div>;
}

export function AudioBar() {
  const {view,busy,connected,send}=useDeck();
  const games=view?.deck.games.filter(g=>view.runtime.bindings[g.key])||[];
  const enabled=games.filter(g=>!view?.tabs.find(t=>t.id===view.runtime.bindings[g.key].tabId)?.mutedInfo?.muted);
  const value=enabled.length===1?enabled[0].key:enabled.length?'__multiple':'__silent';
  return <div className="audio-bar">
    <div className="audio-bar-title"><Headphones size={17}/><strong>Game audio</strong></div>
    <select aria-label="Choose game audio" disabled={!connected||!games.length||!view?.deck.audioEnabled} value={value} onChange={e=>void send(e.target.value==='__silent'?{type:'MUTE_ALL'}:{type:'LISTEN',key:e.target.value})}>
      <option value="__silent">All managed games muted</option>
      {enabled.length>1&&<option value="__multiple" disabled>Multiple games enabled</option>}
      {games.map(g=><option key={g.key} value={g.key}>{g.title}</option>)}
    </select>
    <button className="button secondary small" disabled={!games.length||!view?.deck.audioEnabled} onClick={()=>void send({type:'MUTE_ALL'})}><VolumeX size={14}/>Mute all</button>
    <label className="audio-toggle"><input type="checkbox" checked={view?.deck.audioFollowsMain??true} disabled={busy} onChange={e=>void send({type:'AUDIO_FOLLOWS_MAIN',enabled:e.target.checked})}/>Follow main game</label>
    <label className="audio-toggle"><input type="checkbox" checked={view?.deck.audioEnabled??true} disabled={busy} onChange={e=>void send({type:'AUDIO_ENABLED',enabled:e.target.checked})}/>Manage audio</label>
    <p>Enable sound in the provider’s player first. Volume stays in the original player.</p>
  </div>;
}

export function TileAudioStatus({gameKey}:{gameKey:string}) {
  const {view}=useDeck();
  const tab=view?.tabs.find(t=>t.id===view.runtime.bindings[gameKey]?.tabId);
  if(!tab)return null;
  const enabled=!tab.mutedInfo?.muted;
  return <span className={`tile-audio ${enabled?'enabled':''}`} aria-label={enabled?'Tab audio enabled':'Tab muted'} title={enabled?'Active audio · provider player must also be unmuted':'Tab muted'}>{enabled?<Volume2 size={13}/>:<VolumeX size={13}/>}</span>;
}
