import type {ScoreBatch,ScoreEvent,ScoreLeague,ScoreProvider,ScoreTeam} from './types';
import {CONFERENCES,mexicoDate,SCORE_LEAGUES,validDate} from './types';
export const ESPN_ACCESS='https://site.api.espn.com/*';
const obj=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const arr=(v:unknown):unknown[]=>Array.isArray(v)?v:[];
const str=(v:unknown)=>typeof v==='string'?v:'';
const id=(v:unknown)=>typeof v==='string'&&/^\d+$/.test(v)?v:typeof v==='number'&&Number.isSafeInteger(v)?String(v):'';
const num=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?v:typeof v==='string'&&/^\d+$/.test(v)?Number(v):undefined;
const https=(v:unknown)=>{try{const u=new URL(str(v));return u.protocol==='https:'?u.href:undefined;}catch{return undefined;}};
export type PollRanks=Record<string,{rank:number;poll:string;date:string}>;
export function normalizeRankings(raw:unknown,day:string):PollRanks{
  const polls=arr(obj(raw).rankings).map(obj);const ap=polls.find(p=>str(p.name)==='AP Top 25');const ranks:PollRanks={};
  if(!ap)return ranks;
  for(const rawRank of arr(ap.ranks)){
    const r=obj(rawRank),team=obj(r.team),rank=num(r.current),date=str(r.date);const age=Date.parse(day+'T23:59:59Z')-Date.parse(date);
    if(id(team.id)&&rank&&Number.isInteger(rank)&&rank<=25&&age>=0&&age<9*86400000)ranks[id(team.id)]={rank,poll:str(ap.name),date};
  }return ranks;
}
export function normalizeScoreboard(raw:unknown,ranks:PollRanks={},league:ScoreLeague='cfb'):ScoreEvent[]{
  const root=obj(raw);if(!Array.isArray(root.events))throw new Error('ESPN response has no valid events array. Cached scores were retained.');
  const result:ScoreEvent[]=[];
  for(const rawEvent of root.events){
    const e=obj(rawEvent),c=obj(arr(e.competitions)[0]),competitors=arr(c.competitors).map(obj),status=obj(c.status||e.status),type=obj(status.type);
    const make=(side:string):ScoreTeam|undefined=>{
      const competitor=competitors.find(t=>t.homeAway===side);if(!competitor)return;
      const team=obj(competitor.team),teamId=id(team.id||competitor.id),name=str(team.displayName)||str(team.location);if(!teamId||!name)return;
      const rank=ranks[teamId],curated=league==='cfb'?num(obj(competitor.curatedRank).current):undefined,s=num(competitor.score);
      return {id:teamId,name,shortName:str(team.shortDisplayName)||str(team.location)||name,abbreviation:str(team.abbreviation)||name,logo:https(team.logo)||https(obj(arr(team.logos)[0]).href),conferenceId:id(team.conferenceId)||undefined,score:s!==undefined&&Number.isInteger(s)&&s>=0?s:null,
        rank:rank?.rank||(curated&&curated<=25?curated:undefined),rankPoll:rank?.poll||(curated&&curated<=25?'ESPN curated · poll not supplied':undefined),rankDate:rank?.date,record:str(obj(arr(competitor.records).find(v=>obj(v).type==='total')).summary)||undefined};
    };
    const home=make('home'),away=make('away'),eventId=id(e.id),date=str(e.date||c.date);if(!home||!away||!eventId||!Number.isFinite(Date.parse(date)))continue;
    const name=str(type.name),state=str(type.state);const eventStatus=type.completed===true||name==='STATUS_FINAL'?'final':name==='STATUS_HALFTIME'?'halftime':state==='in'?'live':state==='pre'?'scheduled':'other';
    if(eventStatus==='scheduled'){home.score=null;away.score=null;}
    const situation=obj(c.situation),possession=id(situation.possession),period=num(status.period);
    const networks=[...new Set(arr(c.broadcasts).flatMap(b=>arr(obj(b).names).map(str)).filter(Boolean))];
    result.push({id:eventId,provider:SCORE_LEAGUES[league].provider,name:str(e.name)||`${away.name} at ${home.name}`,date,home,away,status:eventStatus,statusText:str(type.shortDetail)||str(type.detail)||str(type.description)||'Status unavailable',quarter:period&&period>0?period:undefined,clock:str(status.displayClock)||undefined,possession:[home.id,away.id].includes(possession)?possession:undefined,networks,venue:str(obj(c.venue).fullName)||undefined,detail:str(situation.downDistanceText)||undefined});
  }
  if(root.events.length&&!result.length)throw new Error('ESPN event schema changed. Cached scores were retained.');
  return result;
}
export class ProviderError extends Error{constructor(message:string,public retryAfter=0){super(message);}}
export type RankCacheStore={read:()=>Promise<{at:number;raw:unknown}|undefined>;write:(value:{at:number;raw:unknown})=>Promise<void>};
export class EspnScoreProvider implements ScoreProvider{
  readonly id:string;
  readonly attributionUrl:string;
  private readonly baseUrl:string;
  name='ESPN · unofficial public data';
  permissionOrigin=ESPN_ACCESS;
  private rankCache:{at:number;raw:unknown}|undefined;
  private rankLoaded=false;
  constructor(private fetcher:typeof fetch=fetch,private now=()=>Date.now(),private rankStore?:RankCacheStore,private league:ScoreLeague='cfb'){
    const {path,provider}=SCORE_LEAGUES[league];
    this.id=provider;
    this.baseUrl=`https://site.api.espn.com/apis/site/v2/sports/football/${path}/`;
    this.attributionUrl=`https://www.espn.com/${path}/scoreboard`;
  }
  private async json(url:string){
    // Chrome's worker fetch requires the worker global as its receiver.
    const response=await this.fetcher.call(globalThis,url,{credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(12000)});
    if(!response.ok){const retry=response.headers.get('retry-after');const delay=retry?(/^\d+$/.test(retry)?Number(retry)*1000:Math.max(0,Date.parse(retry)-this.now())):0;throw new ProviderError(`ESPN returned HTTP ${response.status}.`,Number.isFinite(delay)?delay:0);}
    return await response.json() as unknown;
  }
  async fetchScores(date:string):Promise<ScoreBatch>{
    if(!validDate(date))throw new Error('Choose a valid scoreboard date.');
    const next=new Date(Date.parse(date+'T12:00:00Z')+86400000).toISOString().slice(0,10);
    // The verified limit is 100. Values such as 1000 fell back to a 25-game subset.
    const college=this.league==='cfb';
    const group=college?'groups=80&':'';
    const urls=[date,next].map(d=>`${this.baseUrl}scoreboard?${group}limit=100&dates=${d.replaceAll('-','')}`);
    const [first,second]=await Promise.all(urls.map(u=>this.json(u)));
    const supplemental:unknown[]=[];let coverageIssue=false;
    // Only expand to conference queries if the verified daily limit is reached.
    // Normal polling remains two scoreboard calls, plus a six-hour ranking cache.
    if(college)for(const [index,raw]of [first,second].entries())if(arr(obj(raw).events).length>=100){
      for(const group of Object.keys(CONFERENCES)){
        try{const value=await this.json(`${this.baseUrl}scoreboard?groups=${group}&limit=100&dates=${[date,next][index].replaceAll('-','')}`);supplemental.push(value);if(arr(obj(value).events).length>=100)coverageIssue=true;}catch{coverageIssue=true;}
      }
    }
    let rankingWarning='';
    if(college&&!this.rankLoaded){this.rankLoaded=true;try{this.rankCache=await this.rankStore?.read();}catch{/* Ranking persistence must not stop score updates. */}}
    if(college&&(!this.rankCache||this.now()-this.rankCache.at>6*3600000)){try{
      const raw=await this.json(this.baseUrl+'rankings');
      if(!Array.isArray(obj(raw).rankings))throw new Error('Rankings schema unavailable.');
      const ap=arr(obj(raw).rankings).map(obj).find(p=>p.name==='AP Top 25');
      const minimal={rankings:ap?[{name:'AP Top 25',ranks:arr(ap.ranks).map(value=>{const r=obj(value);return {current:r.current,team:{id:obj(r.team).id},date:r.date};})}]:[]};
      this.rankCache={at:this.now(),raw:minimal};await this.rankStore?.write(this.rankCache);
    }catch{rankingWarning='Named ranking poll unavailable; curated ranks are labeled as unspecified.';}}
    const ranks=normalizeRankings(this.rankCache?.raw,date);
    const all=[first,second,...supplemental].flatMap(raw=>normalizeScoreboard(raw,ranks,this.league));
    const events=[...new Map(all.filter(e=>mexicoDate(e.date)===date).map(e=>[e.id,e])).values()].sort((a,b)=>a.date.localeCompare(b.date));
    const rankLabel=college?(Object.keys(ranks).length?'AP Top 25 (dated poll); unspecified curated ranks labeled separately':'ESPN curated ranks · poll not supplied'):'';
    return {events,date,coverageWarning:[coverageIssue?'Some conference fallback data was unavailable or capped; the slate may be incomplete.':'',rankingWarning].filter(Boolean).join(' '),rankLabel};
  }
}
