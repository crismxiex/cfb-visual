import {describe,it,expect,vi} from 'vitest';
import {EspnScoreProvider,normalizeRankings,normalizeScoreboard,ProviderError} from '../src/sports/espn';
import {defaults,emptyCache,mexicoDate,selectEvents} from '../src/sports/types';
import {createScoreboardService} from '../src/sports/service';
import {createStreamingLauncher,DEFAULT_SERVICES,customService} from '../src/sports/services';
import {detectChanges} from '../src/sports/alerts';
import {suggestEvents} from '../src/sports/matcher';

// Synthetic protocol fixtures are used only in tests, never as dashboard data.
function event(id='1',homeScore:unknown='14',awayScore:unknown='7'){
  return {id,name:'Oregon Ducks at Ohio State Buckeyes',date:'2026-11-07T20:30:00Z',competitions:[{competitors:[{homeAway:'home',team:{id:'194',displayName:'Ohio State Buckeyes',shortDisplayName:'Ohio State',abbreviation:'OSU',conferenceId:'5'},score:homeScore},{homeAway:'away',team:{id:'2483',displayName:'Oregon Ducks',shortDisplayName:'Oregon',abbreviation:'ORE',conferenceId:'5'},score:awayScore}],status:{period:4,displayClock:'8:00',type:{state:'in',name:'STATUS_IN_PROGRESS',shortDetail:'8:00 - 4th'}},situation:{possession:'2483'},broadcasts:[{names:['Network']}]}]};
}
const batch=()=>({events:normalizeScoreboard({events:[event()]}),date:'2026-11-07',rankLabel:'No ranks'});
describe('ESPN schema validation',()=>{
  it('normalizes real field locations without inventing absent metadata',()=>{const e=normalizeScoreboard({events:[event()]})[0];expect(e.home.score).toBe(14);expect(e.possession).toBe('2483');expect(e.home.rank).toBeUndefined();expect(e.home.conferenceId).toBe('5');expect(e.status).toBe('live');});
  it('rejects invalid root schemas but permits a valid empty slate',()=>{expect(()=>normalizeScoreboard({error:'unavailable'})).toThrow();expect(normalizeScoreboard({events:[]})).toEqual([]);expect(()=>normalizeScoreboard({events:[{}]})).toThrow();});
  it('preserves missing scores rather than manufacturing zero',()=>{expect(normalizeScoreboard({events:[event('1',null,undefined)]})[0].home.score).toBeNull();});
  it('does not show pregame zeroes as an actual score',()=>{const e=event();e.competitions[0].status.type.state='pre';e.competitions[0].status.type.name='STATUS_SCHEDULED';expect(normalizeScoreboard({events:[e]})[0].home.score).toBeNull();});
  it('only labels an AP ranking when the named, dated poll supplies it',()=>{const ranks=normalizeRankings({rankings:[{name:'AP Top 25',ranks:[{current:3,team:{id:'2483'},date:'2026-11-01T07:00Z'}]}]},'2026-11-07');expect(ranks['2483'].poll).toBe('AP Top 25');expect(normalizeRankings({rankings:[{name:'AP Top 25',ranks:[{current:3,team:{id:'2483'},date:'2026-11-01T07:00Z'}]}]},'2026-12-07')).toEqual({});});
  it('requests verified FBS limit=100 and two dates, then deduplicates Mexico-local events',async()=>{const fetcher=vi.fn(async(url:string)=>new Response(JSON.stringify(url.includes('rankings')?{rankings:[]}:{events:[event()]}),{status:200}));const provider=new EspnScoreProvider(fetcher as any);const result=await provider.fetchScores('2026-11-07');expect(result.events).toHaveLength(1);expect(fetcher.mock.calls[0][0]).toContain('groups=80&limit=100&dates=20261107');expect(fetcher.mock.calls[1][0]).toContain('dates=20261108');});
  it('propagates Retry-After for exponential backoff',async()=>{const provider=new EspnScoreProvider(async()=>new Response('{}',{status:429,headers:{'Retry-After':'120'}}));await expect(provider.fetchScores('2026-11-07')).rejects.toMatchObject({retryAfter:120000});});
  it('retains the six-hour named-poll cache across new provider instances',async()=>{
    let saved:any;const store={read:async()=>saved,write:async(v:any)=>{saved=v;}};
    const fetcher=vi.fn(async(url:string)=>new Response(JSON.stringify(url.includes('rankings')?{rankings:[{name:'AP Top 25',ranks:[{current:3,team:{id:'2483'},date:'2026-11-01T07:00Z'}]}]}:{events:[event()]}),{status:200}));const now=()=>Date.parse('2026-11-07T22:00Z');
    await new EspnScoreProvider(fetcher as any,now,store).fetchScores('2026-11-07');const next=await new EspnScoreProvider(fetcher as any,now,store).fetchScores('2026-11-07');expect(fetcher.mock.calls.filter(c=>c[0].includes('rankings'))).toHaveLength(1);expect(next.events[0].away.rankPoll).toBe('AP Top 25');
  });
  it('falls back to conference queries when the daily response reaches its limit',async()=>{
    const fetcher=vi.fn(async(url:string)=>new Response(JSON.stringify(url.includes('rankings')?{rankings:[]}:url.includes('groups=80')&&url.includes('20261107')?{events:Array.from({length:100},(_,i)=>event(String(i+1)))}:{events:[event('101')]}),{status:200}));
    const result=await new EspnScoreProvider(fetcher as any).fetchScores('2026-11-07');expect(result.events).toHaveLength(101);expect(fetcher.mock.calls.some(c=>c[0].includes('groups=5&limit=100'))).toBe(true);
  });
});
describe('background scoreboard scheduling',()=>{
  function fixture(){let saved:any={gamedeckSports:{...defaults(),enabled:true},gamedeckScores:emptyCache()};let now=Date.parse('2026-11-07T22:00Z');const provider={id:'test',name:'test',fetchScores:vi.fn(async()=>batch())};const api:any={storage:{local:{get:async()=>structuredClone(saved),set:async(v:any)=>Object.assign(saved,structuredClone(v))}},permissions:{contains:async()=>true},alarms:{create:vi.fn(async()=>{}),clear:vi.fn(async()=>{})}};const service=createScoreboardService(api,{request:async()=>({}) as any},provider,()=>now);return {api,service,provider,advance:(n:number)=>now+=n,get saved(){return saved;}};}
  it('deduplicates simultaneous refreshes and schedules live polling at thirty seconds',async()=>{const f=fixture();await Promise.all([f.service.refresh(true),f.service.refresh(true)]);expect(f.provider.fetchScores).toHaveBeenCalledTimes(1);const v=await f.service.view();expect(v.cache.nextPollAt-v.cache.updatedAt).toBe(30000);expect(f.api.alarms.create).toHaveBeenCalled();});
  it('retains cached scores and backs off on failures',async()=>{const f=fixture();await f.service.refresh(true);f.provider.fetchScores.mockRejectedValue(new ProviderError('HTTP 429',120000));f.advance(30000);const v=await f.service.refresh(true);expect(v.cache.events).toHaveLength(1);expect(v.cache.error).toContain('429');expect(v.cache.failures).toBe(1);expect(v.cache.nextPollAt).toBeGreaterThanOrEqual(v.cache.attemptAt+120000);});
  it('never produces alerts on an initial snapshot',()=>{const s=defaults();s.favorites=['2483'];expect(detectChanges([],batch().events,s,1)).toEqual([]);});
  it('detects a score change without claiming a touchdown',()=>{const s=defaults();s.favorites=['2483'];const before=batch().events;const next=normalizeScoreboard({events:[event('1','14','13')]});const alerts=detectChanges(before,next,s,2);expect(alerts).toHaveLength(1);expect(alerts[0].message).toContain('score changed');expect(alerts[0].message).not.toMatch(/touchdown/i);});
  it('persists Oregon favorites and filters all Big Ten games locally',()=>{const s=defaults();s.filter='5';expect(selectEvents(batch().events,s)).toHaveLength(1);s.filter='favorites';expect(selectEvents(batch().events,s)).toHaveLength(0);s.favorites=['2483'];expect(selectEvents(batch().events,s)).toHaveLength(1);});
  it('polls slowly without live games and recovers saved preferences after worker restart',async()=>{
    const f=fixture();f.provider.fetchScores.mockResolvedValue({...batch(),events:batch().events.map(e=>({...e,status:'final' as const}))});await f.service.refresh(true);const current=await f.service.view();expect(current.cache.nextPollAt-current.cache.updatedAt).toBe(300000);await f.service.request({type:'SPORTS_FAVORITE',teamId:'2483'});await f.service.request({type:'SPORTS_SETTINGS',patch:{filter:'5',rankedOnly:true}});
    const restored=createScoreboardService(f.api,{request:async()=>({}) as any},f.provider,()=>current.cache.updatedAt);const recovered=await restored.view();expect(recovered.settings.favorites).toContain('2483');expect(recovered.settings.filter).toBe('5');expect(recovered.settings.rankedOnly).toBe(true);expect(recovered.cache.events).toHaveLength(1);
  });
  it('rejects invalid links and persists only stable event/game identities for confirmed ones',async()=>{
    const f=fixture();await f.service.refresh(true);const windows={request:async()=>({deck:{games:[{key:'stream'}]},runtime:{bindings:{stream:{tabId:7,windowId:8}}}}) as any};const service=createScoreboardService(f.api,windows,f.provider);await expect(service.request({type:'SPORTS_LINK',key:'stream',eventId:'missing'})).rejects.toThrow(/current event/);await service.request({type:'SPORTS_LINK',key:'stream',eventId:'1'});const linked=await service.view();expect(linked.settings.links.stream.eventId).toBe('1');expect(JSON.stringify(linked.settings.links)).not.toMatch(/tabId|windowId/);await service.request({type:'SPORTS_UNLINK',key:'stream'});expect((await service.view()).settings.links).toEqual({});
  });
  it('does not duplicate alerts when the same provider snapshot arrives again',async()=>{
    const f=fixture();await f.service.request({type:'SPORTS_FAVORITE',teamId:'2483'});await f.service.refresh(true);f.provider.fetchScores.mockResolvedValue({...batch(),events:normalizeScoreboard({events:[event('1','14','13')]})});await f.service.refresh(true);const first=(await f.service.view()).cache.alerts;await f.service.refresh(true);expect((await f.service.view()).cache.alerts).toEqual(first);expect(first).toHaveLength(1);
  });
});
describe('Mexico streaming launchers and manual matching',()=>{
  it('only provides Disney+ and DAZN defaults and rejects ESPN shortcuts',()=>{expect(DEFAULT_SERVICES.map(s=>s.id)).toEqual(['disney','dazn']);expect(()=>customService('ESPN','https://espn.com/watch')).toThrow();});
  it('focuses an existing stream without navigating it',async()=>{const update=vi.fn(async()=>({}));const create=vi.fn();const api:any={windows:{getAll:async()=>[{id:1,type:'popup',tabs:[{id:7,url:'https://www.dazn.com/watch/game',title:'Game'}]}],update},tabs:{get:async()=>({id:7,windowId:1}),update,create}};await createStreamingLauncher(api).launch(DEFAULT_SERVICES[1]);expect(create).not.toHaveBeenCalled();expect(update.mock.calls.some(c=>'url'in c[1])).toBe(false);});
  it('offers a choice when several game tabs belong to the same service',async()=>{const api:any={windows:{getAll:async()=>[{type:'popup',tabs:[{id:1,url:'https://www.dazn.com/a'},{id:2,url:'https://www.dazn.com/b'}]}]}};const result=await createStreamingLauncher(api).launch(DEFAULT_SERVICES[1]);expect(result.choices).toHaveLength(2);});
  it('requires both teams for a match and always returns suggestions for confirmation',()=>{const events=batch().events;expect(suggestEvents({title:'#3 Oregon @ #2 Ohio State | DAZN',url:'https://dazn.com/a'},events,'2026-11-07')[0].confidence).toBeGreaterThan(.9);expect(suggestEvents({title:'Oregon Ducks',url:'https://dazn.com/a'},events)).toEqual([]);});
});
