import {EspnScoreProvider,ESPN_ACCESS,ProviderError} from './espn';
import {detectChanges} from './alerts';
import {customService,createStreamingLauncher,DEFAULT_SERVICES} from './services';
import {defaults,emptyCache,live,mexicoDate,validDate} from './types';
import type {ScoreProvider,SportsSettings,ScoreCache,SportsView} from './types';
import type {Command,View} from '../model';
export const SCORE_ALARM='gamedeck-cfb-refresh';
type WindowController={request:(command:Command)=>Promise<View>};
export function createScoreboardService(api:typeof chrome,windows:WindowController,provider:ScoreProvider|undefined=undefined,now=()=>Date.now()){
  let settings:SportsSettings,cache:ScoreCache,loading:Promise<void>|undefined;
  const flights=new Map<string,Promise<SportsView>>();
  const launcher=createStreamingLauncher(api);
  const scoreProvider=provider||new EspnScoreProvider(fetch,now,{read:async()=>(await api.storage.local.get('gamedeckScoreRanks')).gamedeckScoreRanks as {at:number;raw:unknown}|undefined,write:async value=>{await api.storage.local.set({gamedeckScoreRanks:value});}});
  let notify:((view:SportsView)=>Promise<string|void>)|undefined;
  let tail=Promise.resolve<unknown>(undefined);
  const selectedDate=()=>settings.date||mexicoDate(now());
  async function access(){return !!api.permissions&&await api.permissions.contains({origins:[scoreProvider.permissionOrigin||ESPN_ACCESS]});}
  async function save(){await api.storage.local.set({gamedeckSports:structuredClone(settings),gamedeckScores:structuredClone(cache)});}
  async function schedule(){if(settings.enabled)await api.alarms.create(SCORE_ALARM,{when:Math.max(now()+1000,cache.nextPollAt||now()+1000)});else await api.alarms.clear(SCORE_ALARM);}
  async function load(){if(loading)return loading;loading=(async()=>{
    const data=await api.storage.local.get(['gamedeckSports','gamedeckScores']);
    settings={...defaults(),...data.gamedeckSports as Partial<SportsSettings>};settings.overlay={...defaults().overlay,...settings.overlay};
    cache={...emptyCache(),...data.gamedeckScores as Partial<ScoreCache>};await schedule();
  })();return loading;}
  async function view():Promise<SportsView>{await load();return {settings:structuredClone(settings),cache:structuredClone(cache),access:await access(),accessOrigin:scoreProvider.permissionOrigin||ESPN_ACCESS};}
  async function publish(){
    if(notify){try{const status=await notify(await view());if(status)cache.overlayStatus=status;}catch(error){cache.overlayStatus=error instanceof Error?error.message:String(error);}await api.storage.local.set({gamedeckScores:structuredClone(cache)});}
    return view();
  }
  async function refresh(force=false):Promise<SportsView>{
    await load();const date=selectedDate();if(flights.has(date))return flights.get(date)!;
    if(!settings.enabled||!force&&now()<cache.nextPollAt)return view();
    const task=(async()=>{
      if(!await access()){cache.error='Enable score access to site.api.espn.com to fetch the CFB scoreboard.';cache.nextPollAt=now()+300000;await save();await schedule();return view();}
      cache.attemptAt=now();
      try{
        const result=await scoreProvider.fetchScores(date);if(selectedDate()!==date)return view();
        const changes=cache.date===date?detectChanges(cache.events,result.events,settings,now()):[];
        const ids=new Set(cache.alerts.map(a=>a.id));cache.alerts=[...changes.filter(a=>!ids.has(a.id)),...cache.alerts].slice(0,30);
        cache.events=result.events;cache.date=date;cache.updatedAt=now();cache.error='';cache.failures=0;cache.coverageWarning=result.coverageWarning||'';cache.rankLabel=result.rankLabel;
        cache.providerName=scoreProvider.name;cache.attributionUrl=scoreProvider.attributionUrl||'';
        cache.nextPollAt=now()+(date===mexicoDate(now())&&result.events.some(live)?30000:300000);
      }catch(error){if(selectedDate()!==date)return view();cache.failures++;cache.error=error instanceof Error?error.message:String(error);const retry=error instanceof ProviderError?error.retryAfter:0;cache.nextPollAt=now()+Math.max(retry,Math.min(30*60000,30000*2**Math.min(cache.failures,6)));}
      await save();await schedule();return publish();
    })();flights.set(date,task);try{return await task;}finally{flights.delete(date);}
  }
  async function dispatch(message:Command):Promise<unknown>{
    await load();
    if(message.type==='SPORTS_GET')return view();
    if(message.type==='SPORTS_REFRESH')return refresh(true);
    if(message.type==='SPORTS_SETTINGS'){
      const p=message.patch as Partial<SportsSettings>||{};
      if(p.date!==undefined&&p.date!==''&&!validDate(p.date))throw new Error('Choose a valid date.');
      const oldDate=selectedDate();
      for(const key of ['enabled','alertsEnabled','rankedOnly'] as const)if(typeof p[key]==='boolean')settings[key]=p[key]!;
      for(const key of ['date','filter','status','query'] as const)if(typeof p[key]==='string')settings[key]=p[key]!.slice(0,100);
      if(p.mode==='compact'||p.mode==='expanded')settings.mode=p.mode;
      if(p.overlay){settings.overlay={...settings.overlay,...p.overlay,height:Math.max(40,Math.min(160,Number(p.overlay.height??settings.overlay.height))),opacity:Math.max(.2,Math.min(1,Number(p.overlay.opacity??settings.overlay.opacity)))};}
      if(oldDate!==selectedDate()||p.enabled===true)cache.nextPollAt=now();
      await save();await schedule();
      if(settings.enabled&&(oldDate!==selectedDate()||p.enabled===true))void refresh(true).catch(console.error);
    }else if(message.type==='SPORTS_FAVORITE'){
      const id=String(message.teamId);if(!/^\d+$/.test(id))throw new Error('Invalid team ID.');settings.favorites=settings.favorites.includes(id)?settings.favorites.filter(t=>t!==id):[...settings.favorites,id];await save();
    }else if(message.type==='SPORTS_LINK'){
      const gameKey=String(message.key),eventId=String(message.eventId);const deck=await windows.request({type:'GET'});
      const event=cache.events.find(e=>e.id===eventId);
      if(!event||!deck.deck.games.some(g=>g.key===gameKey)||!deck.runtime.bindings[gameKey])throw new Error('Choose a current event and an available managed game.');
      // One confirmed event maps to at most one managed game.
      for(const [key,link]of Object.entries(settings.links))if(link.provider===event.provider&&link.eventId===eventId)delete settings.links[key];
      settings.links[gameKey]={provider:event.provider,eventId,confirmedAt:now()};await save();
    }else if(message.type==='SPORTS_UNLINK'){delete settings.links[String(message.key)];await save();
    }else if(message.type==='SPORTS_MUTE_EVENT'){
      const id=String(message.eventId);settings.mutedEvents=settings.mutedEvents.includes(id)?settings.mutedEvents.filter(e=>e!==id):[...settings.mutedEvents,id];await save();
    }else if(message.type==='SPORTS_CLEAR_ALERTS'){cache.alerts=[];await save();
    }else if(message.type==='SPORTS_SAVE_SERVICE'){settings.services.push(customService(String(message.name||''),String(message.url||'')));await save();
    }else if(message.type==='SPORTS_REMOVE_SERVICE'){settings.services=settings.services.filter(s=>s.id!==message.id);await save();
    }else if(message.type==='SPORTS_LAUNCH_SERVICE'){
      const service=[...DEFAULT_SERVICES,...settings.services].find(s=>s.id===message.id);if(!service)throw new Error('Streaming service not found.');return launcher.launch(service,!!message.openHome);
    }else if(message.type==='SPORTS_FOCUS_TAB'){await launcher.focus(Number(message.tabId));
    }else if(message.type==='SPORTS_OVERLAY_STATUS'){cache.overlayStatus=String(message.status||'');await save();
    }else throw new Error('Unknown Sports Hub command.');
    return publish();
  }
  return {request(message:Command){if(message.type==='SPORTS_GET'||message.type==='SPORTS_REFRESH')return dispatch(message);const task=tail.then(()=>dispatch(message));tail=task.catch(()=>{});return task;},refresh,view,onChange(callback:(view:SportsView)=>Promise<string|void>){notify=callback;},async startup(){await load();await schedule();if(settings.enabled&&cache.nextPollAt<=now())await refresh();}};
}
