import type {Game} from '../model';
import type {ScoreEvent,ScoreTeam} from './types';
import {mexicoDate} from './types';
const aliases:Record<string,string[]>={'2483':['oregon','oregon ducks'],'194':['ohio state','ohio st','osu'],'213':['penn state','penn st','psu'],'252':['byu','brigham young'],'254':['utah','utah utes'],'333':['alabama','bama'],'99':['lsu','louisiana state'],'251':['texas','texas longhorns'],'245':['texas a&m','texas am'],'61':['georgia','uga'],'145':['ole miss','mississippi'],'96':['kentucky'],'2633':['tennessee'],'26':['ucla'],'264':['washington','washington huskies']};
export const normalizeName=(text:string)=>text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/#\s*\d+/g,'').replace(/\b(vs\.?|versus|at)\b|@/g,' ').replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
function teamMatch(title:string,team:ScoreTeam){
  const names=[team.name,team.shortName,...(aliases[team.id]||[])].map(normalizeName).filter(n=>n.length>=3);
  if(names.some(n=>` ${title} `.includes(` ${n} `)))return 1;
  const abbr=normalizeName(team.abbreviation);return abbr.length>=3&&` ${title} `.includes(` ${abbr} `) ? .8 : 0;
}
export function suggestEvents(game:Pick<Game,'title'|'url'>,events:ScoreEvent[],day=mexicoDate()){
  const title=normalizeName(game.title);
  return events.map(event=>{
    const home=teamMatch(title,event.home),away=teamMatch(title,event.away);
    let confidence=home&&away ? .4*home+.4*away : 0;
    if(confidence&&mexicoDate(event.date)===day)confidence+=.15;
    try{const u=new URL(game.url);if(confidence&&u.searchParams.get('espnEventId')===event.id)confidence+=.05;}catch{}
    return {event,confidence:Math.min(1,confidence),reason:'Both team names/aliases and event date; confirm this association.'};
  }).filter(s=>s.confidence>=.6).sort((a,b)=>b.confidence-a.confidence);
}
