import {describe,it,expect,vi} from 'vitest';
import {EspnScoreProvider,normalizeScoreboard} from '../src/sports/espn';
import {defaults,emptyCache,leagueId,periodLabel,selectEvents} from '../src/sports/types';
import {createScoreboardService} from '../src/sports/service';
import {detectChanges} from '../src/sports/alerts';
import {scoreOverlayCommand} from '../src/sports/overlay';

// Synthetic ESPN men's college basketball fixture (Big Ten matchup, 2nd half).
function game(id='401',homeScore='61',awayScore='58',period=2){
  return {id,name:'Michigan State Spartans at Purdue Boilermakers',date:'2026-11-17T01:00:00Z',competitions:[{competitors:[
    {homeAway:'home',team:{id:'2509',displayName:'Purdue Boilermakers',shortDisplayName:'Purdue',abbreviation:'PUR',conferenceId:'7'},score:homeScore,curatedRank:{current:4}},
    {homeAway:'away',team:{id:'127',displayName:'Michigan State Spartans',shortDisplayName:'Michigan St',abbreviation:'MSU',conferenceId:'7'},score:awayScore,curatedRank:{current:99}},
  ],status:{period,displayClock:'4:12',type:{state:'in',name:'STATUS_IN_PROGRESS',shortDetail:'4:12 - 2nd'}},broadcasts:[{names:['FS1']}]}]};
}
const cbb=(...events:unknown[])=>normalizeScoreboard({events},{},'cbb');

describe('NCAA men’s basketball scores',()=>{
  it('requests the full Division I slate and AP rankings from the basketball endpoint',async()=>{
    const fetcher=vi.fn(async(url:string)=>Response.json(url.includes('rankings')
      ?{rankings:[{name:'AP Top 25',ranks:[{current:7,team:{id:'127'},date:'2026-11-16T08:00Z'}]}]}
      :{events:[game()]}));
    const result=await new EspnScoreProvider(fetcher,()=>Date.parse('2026-11-16T22:00Z'),undefined,'cbb').fetchScores('2026-11-16');
    const base='https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/';
    expect(fetcher.mock.calls.map(([url])=>url)).toEqual([
      `${base}scoreboard?groups=50&limit=400&dates=20261116`,
      `${base}scoreboard?groups=50&limit=400&dates=20261117`,
      `${base}rankings`,
    ]);
    const [event]=result.events;
    expect(event.provider).toBe('espn-cbb');
    expect(event.away.rank).toBe(7);
    expect(event.away.rankPoll).toBe('AP Top 25');
    expect(event.home.rank).toBe(4); // ESPN curated rank when the poll omits a team
    expect(result.rankLabel).toContain('AP Top 25');
  });
  it('warns when ESPN caps the slate instead of silently dropping games',async()=>{
    const events=Array.from({length:400},(_,i)=>game(String(1000+i)));
    const fetcher=vi.fn(async(url:string)=>Response.json(url.includes('rankings')?{rankings:[]}:{events}));
    const result=await new EspnScoreProvider(fetcher,()=>Date.parse('2026-11-16T22:00Z'),undefined,'cbb').fetchScores('2026-11-16');
    expect(result.coverageWarning).toContain('capped');
    expect(fetcher.mock.calls.filter(([url])=>url.includes('groups=')&&!url.includes('groups=50'))).toEqual([]);
  });
  it('labels halves and overtime instead of quarters',()=>{
    expect([1,2,3,4].map(p=>periodLabel('cbb',p))).toEqual(['1st half','2nd half','OT','2OT']);
    expect(periodLabel('cfb',4)).toBe('Period 4');
  });
  it('filters by basketball conferences, Top 25 and league-scoped favorites',()=>{
    const events=cbb(game());
    const settings={...defaults(),league:'cbb' as const,filter:'7'};
    expect(selectEvents(events,settings)).toHaveLength(1);
    expect(selectEvents(events,{...settings,filter:'23'})).toHaveLength(0);
    expect(selectEvents(events,{...settings,filter:'ranked'})).toHaveLength(1);
    // A college football favorite with the same ESPN team ID does not carry over.
    expect(selectEvents(events,{...settings,filter:'favorites',favorites:['2509']})).toHaveLength(0);
    expect(selectEvents(events,{...settings,filter:'favorites',favorites:[leagueId('cbb','2509')]})).toHaveLength(1);
  });
  it('alerts on the second half and overtime, never on a fourth quarter',()=>{
    const settings={...defaults(),league:'cbb' as const,favorites:[leagueId('cbb','2509')]};
    const second=detectChanges(cbb(game('401','30','30',1)),cbb(game('401','30','30',2)),settings,1);
    expect(second.map(a=>a.message)).toEqual(['Michigan State Spartans at Purdue Boilermakers · second half']);
    const overtime=detectChanges(cbb(game('401','70','70',2)),cbb(game('401','70','70',3)),settings,2);
    expect(overtime.map(a=>a.message)).toEqual(['Michigan State Spartans at Purdue Boilermakers · overtime']);
  });
  it('keeps native ticker picks separate from football picks with the same event ID',()=>{
    const settings={...defaults(),league:'cbb' as const,enabled:true,date:'2026-11-16'};
    const live=cbb(game('9'))[0],final={...live,id:'1',status:'final' as const};
    const cache={...emptyCache('cbb'),date:settings.date,events:[live,final]};
    settings.overlay.eventIds=['1','nfl:1'];
    expect(scoreOverlayCommand({settings,cache,access:true}).events).toEqual([live]);
    settings.overlay.eventIds.push('cbb:1');
    expect(scoreOverlayCommand({settings,cache,access:true}).events).toEqual([final]);
    expect(scoreOverlayCommand({settings,cache,access:true}).freshness).toMatch(/^CBB · /);
  });
  it('resets a football conference filter when switching to basketball',async()=>{
    const saved:any={gamedeckSports:{...defaults(),filter:'5'}};
    const api:any={storage:{local:{get:async()=>structuredClone(saved),set:async(v:any)=>Object.assign(saved,structuredClone(v))}},permissions:{contains:async()=>true},alarms:{create:vi.fn(async()=>{}),clear:vi.fn(async()=>{})}};
    const service=createScoreboardService(api,{request:async()=>({}) as any});
    const view=await service.request({type:'SPORTS_SETTINGS',patch:{league:'cbb'}}) as Awaited<ReturnType<typeof service.view>>;
    expect(view.settings.league).toBe('cbb');
    expect(view.settings.filter).toBe('all');
    expect(saved.gamedeckCbbScores).toBeDefined();
  });
});
