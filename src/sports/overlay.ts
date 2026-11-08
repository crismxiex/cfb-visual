import type {SportsView} from './types';
import {live,mexicoDate,stale} from './types';

export function scoreOverlayCommand({settings,cache}:SportsView,now=Date.now()) {
  const selected=settings.date||mexicoDate(now),matches=cache.date===selected;
  const events=matches?cache.events.filter(e=>settings.overlay.eventIds.length?settings.overlay.eventIds.includes(e.id):live(e)):[];
  const freshness=!matches?`${selected} · awaiting scores`:cache.updatedAt?`${cache.providerName.split(' · ')[0]} · ${stale(cache,now)?'cached · ':''}${new Intl.DateTimeFormat('en-US',{timeZone:'America/Mexico_City',hour:'numeric',minute:'2-digit'}).format(new Date(cache.updatedAt))} MX`:'no data';
  return {type:'SCORE_OVERLAY',enabled:settings.enabled&&settings.overlay.enabled,settings:settings.overlay,events,freshness};
}
