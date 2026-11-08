import type {ScoreEvent,ScoreAlert,SportsSettings} from './types';
export function detectChanges(previous:ScoreEvent[],current:ScoreEvent[],settings:SportsSettings,at:number):ScoreAlert[]{
  if(!settings.alertsEnabled)return [];
  const identity=(e:{provider:string;id:string})=>`${e.provider}:${e.id}`;
  const old=new Map(previous.map(e=>[identity(e),e])),linked=new Set(Object.values(settings.links).map(l=>`${l.provider}:${l.eventId}`));
  const alerts:ScoreAlert[]=[];
  for(const event of current){const before=old.get(identity(event));if(!before||settings.mutedEvents.includes(event.id))continue;
    const favorite=[event.home,event.away].some(t=>settings.favorites.includes(t.id));if(!favorite&&!linked.has(identity(event)))continue;
    const add=(kind:string,message:string)=>alerts.push({id:`${identity(event)}:${kind}:${event.home.score}:${event.away.score}:${event.status}:${event.quarter}`,eventId:event.id,message,at});
    if(favorite&&((event.home.score!==null&&before.home.score!==null&&event.home.score!==before.home.score)||(event.away.score!==null&&before.away.score!==null&&event.away.score!==before.away.score)))add('score',`${event.away.abbreviation} ${event.away.score??'—'} — ${event.home.abbreviation} ${event.home.score??'—'} · score changed`);
    if(linked.has(identity(event))&&[before.home.score,before.away.score,event.home.score,event.away.score].every(s=>s!==null)){const a=Math.sign(before.home.score!-before.away.score!),b=Math.sign(event.home.score!-event.away.score!);if(a!==b&&b!==0)add('lead',`${event.name} · lead changed`);}
    if(event.quarter===4&&before.quarter!==undefined&&before.quarter<4)add('q4',`${event.name} · fourth quarter`);
    if(event.status==='final'&&before.status!=='final')add('final',`${event.name} · final`);
  }return alerts;
}
