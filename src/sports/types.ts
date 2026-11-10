export const SCORE_LEAGUES={
  cfb:{title:'CFB Live',label:'College Football · FBS',provider:'espn',path:'college-football'},
  nfl:{title:'NFL Live',label:'National Football League',provider:'espn-nfl',path:'nfl'},
} as const;
export const SCORE_CACHE_KEYS={cfb:'gamedeckScores',nfl:'gamedeckNflScores'} as const;
export type ScoreLeague=keyof typeof SCORE_LEAGUES;
export const leagueId=(league:ScoreLeague,id:string)=>league==='nfl'?`nfl:${id}`:id;
export const isLeague=(value:unknown):value is ScoreLeague=>value==='cfb'||value==='nfl';
export type ScoreStatus='scheduled'|'live'|'halftime'|'final'|'other';
export type ScoreTeam={id:string;name:string;shortName:string;abbreviation:string;logo?:string;conferenceId?:string;rank?:number;rankPoll?:string;rankDate?:string;score:number|null;record?:string};
export type ScoreEvent={id:string;provider:string;name:string;date:string;home:ScoreTeam;away:ScoreTeam;status:ScoreStatus;statusText:string;quarter?:number;clock?:string;possession?:string;networks:string[];venue?:string;detail?:string};
export type ScoreBatch={events:ScoreEvent[];date:string;coverageWarning?:string;rankLabel:string};
export interface ScoreProvider{id:string;name:string;permissionOrigin?:string;attributionUrl?:string;fetchScores(date:string):Promise<ScoreBatch>}
export type EventLink={provider:string;eventId:string;confirmedAt:number};
export type StreamShortcut={id:string;name:string;url:string;domain:string};
export type OverlaySettings={enabled:boolean;position:'top'|'bottom';height:number;opacity:number;clickThrough:boolean;reserve:boolean;eventIds:string[]};
export type SportsSettings={enabled:boolean;league:ScoreLeague;date:string;filter:string;status:string;query:string;rankedOnly?:boolean;mode:'expanded'|'compact';favorites:string[];links:Record<string,EventLink>;alertsEnabled:boolean;mutedEvents:string[];services:StreamShortcut[];overlay:OverlaySettings};
export type SportsPatch=Omit<Partial<SportsSettings>,'overlay'>&{overlay?:Partial<OverlaySettings>};
export type ScoreAlert={id:string;eventId:string;message:string;at:number};
export type ScoreCache={events:ScoreEvent[];date:string;updatedAt:number;attemptAt:number;nextPollAt:number;failures:number;error:string;coverageWarning:string;rankLabel:string;providerName:string;attributionUrl:string;alerts:ScoreAlert[];overlayStatus:string};
export type SportsView={settings:SportsSettings;cache:ScoreCache;access:boolean;accessOrigin?:string};
export const defaults=():SportsSettings=>({enabled:false,league:'cfb',date:'',filter:'all',status:'all',query:'',mode:'expanded',favorites:[],links:{},alertsEnabled:true,mutedEvents:[],services:[],overlay:{enabled:false,position:'bottom',height:64,opacity:.94,clickThrough:false,reserve:false,eventIds:[]}});
export const emptyCache=(league:ScoreLeague='cfb'):ScoreCache=>({events:[],date:'',updatedAt:0,attemptAt:0,nextPollAt:0,failures:0,error:'',coverageWarning:'',rankLabel:'',providerName:'ESPN · unofficial feed',attributionUrl:`https://www.espn.com/${SCORE_LEAGUES[league].path}/scoreboard`,alerts:[],overlayStatus:''});
export const CONFERENCES:Record<string,string>={'1':'ACC','4':'Big 12','5':'Big Ten','8':'SEC','9':'Pac-12','12':'Conference USA','17':'Mountain West','18':'FBS Independents','37':'Sun Belt','151':'American'};
export const MEXICO_TZ='America/Mexico_City';
export const mexicoTime=(date:Date|number|string)=>new Intl.DateTimeFormat('en-US',{timeZone:MEXICO_TZ,hour:'numeric',minute:'2-digit'}).format(new Date(date));
export const mexicoDate=(date:Date|number|string=Date.now())=>new Intl.DateTimeFormat('en-CA',{timeZone:MEXICO_TZ,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(date));
export function validDate(value:string){return /^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;}
export const scoreText=(team:ScoreTeam)=>team.score===null?'—':String(team.score);
export const live=(event:ScoreEvent)=>event.status==='live'||event.status==='halftime';
export function selectEvents(events:ScoreEvent[],settings:SportsSettings){return events.filter(e=>{
  const teams=[e.home,e.away];
  if(settings.filter==='live'&&!live(e))return false;
  if(settings.league==='cfb'){
    if((settings.filter==='ranked'||settings.rankedOnly)&&!teams.some(t=>t.rank!==undefined&&t.rank<=25))return false;
    if(CONFERENCES[settings.filter]&&!teams.some(t=>t.conferenceId===settings.filter))return false;
  }
  if(settings.filter==='favorites'&&!teams.some(t=>settings.favorites.includes(leagueId(settings.league,t.id))))return false;
  if(settings.status!=='all'&&!(settings.status==='live'?live(e):e.status===settings.status))return false;
  return !settings.query||`${e.name} ${teams.map(t=>t.abbreviation+' '+t.name).join(' ')}`.toLowerCase().includes(settings.query.toLowerCase());
});}
export function stale(cache:ScoreCache,now=Date.now()){return !!cache.events.length&&(!!cache.error||now-cache.updatedAt>(cache.events.some(live)?90000:600000));}
