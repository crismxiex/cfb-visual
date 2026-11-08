export type Rect = { left: number; top: number; width: number; height: number };
export type LayoutId = 'single' | 'two-equal' | 'two-main' | 'three-main' | 'three-horizontal' | 'four-grid' | 'four-main' | 'six-grid' | 'custom';
export type Game = { key: string; title: string; url: string; slot: number; teams?: string; score?: string; volume?: number; lastAudibleVolume?: number };
export type PlayerAudio = { available: boolean; volume?: number; muted?: boolean; status: string };
export type Binding = { tabId: number; windowId: number; originalWindowId: number; originalIndex: number; originalBounds: Rect; originalPinned: boolean; originalDiscardable: boolean; originalMuted?: boolean; lastAudioWrite?: boolean; manualAudioOverride?: boolean; playerViewEnabled?: boolean; playerAudio?: PlayerAudio; managed: boolean };
export type Snapshot = { layout: LayoutId; displayId: string; order: string[]; positions: Record<string,number>; custom: { columns: number; rows: number }; gap: number; displayMode?: 'workArea' | 'full' };
export type Preset = Snapshot & { id: string; name: string };
export type Deck = { games: Game[]; layout: LayoutId; displayId: string; gap: number; geometryVersion?: number; displayMode: 'workArea' | 'full'; playerFit: 'contain' | 'cover'; audioEnabled: boolean; audioFollowsMain: boolean; selected: string | null; presets: Preset[]; previous?: Snapshot; custom: { columns: number; rows: number } };
export type OverlayReservation={active:boolean;reserve:boolean;height:number;position:'top'|'bottom'};
export type Runtime = { bindings: Record<string, Binding>; warnings: string[]; arranged: boolean; audio: { mode: 'preserve' | 'solo' | 'silent'; key: string | null }; immersive: boolean; nativeStatus: string; playerViewReport: string; layoutNotice: string; scoreOverlay?:OverlayReservation; overlayStatus?:string };
export type Display = { id: string; name: string; isPrimary: boolean; workArea: Rect; bounds?: Rect };
export type View = { deck: Deck; runtime: Runtime; tabs: chrome.tabs.Tab[]; windows: chrome.windows.Window[]; displays: Display[] };
export type Command = { type: string; [key: string]: unknown };
export const emptyDeck = (): Deck => ({ games: [], layout: 'three-main', displayId: '', gap: 0, displayMode: 'workArea', playerFit: 'contain', audioEnabled: true, audioFollowsMain: true, selected: null, presets: [], custom: { columns: 2, rows: 2 } });
export const emptyRuntime = (): Runtime => ({ bindings: {}, warnings: [], arranged: false, audio: { mode: 'preserve', key: null }, immersive: false, nativeStatus: '', playerViewReport: '', layoutNotice: '' });
export const mainGameKey = (deck: Deck) => deck.games.find(g=>g.slot===0)?.key ?? null;
export function displayArea(display: Display, mode: Deck['displayMode'],overlay?:OverlayReservation): Rect {
  if(mode==='full'&&!display.bounds)throw new Error('Chrome did not report full display bounds. Use Respect taskbar.');
  const area=mode==='full'?display.bounds!:display.workArea;
  if(overlay?.active&&overlay.reserve)return {...area,top:area.top+(overlay.position==='top'?overlay.height:0),height:area.height-overlay.height};
  return area;
}

export function normalizeUrl(raw: string): string {
  const value = raw.trim();
  const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}`);
  if (url.protocol !== 'https:' || !url.hostname.includes('.') || url.username || url.password) throw new Error('Enter a valid HTTPS website URL without embedded credentials.');
  return url.href;
}
// Strip common credentials from disk persistence; runtime browser URLs stay in Chrome.
export function durableUrl(raw: string): string {
  const url = new URL(normalizeUrl(raw));
  for (const key of [...url.searchParams.keys()]) if (/token|auth|signature|credential|password|secret|jwt|policy|key-pair-id|^sig$|^key$/i.test(key)) url.searchParams.delete(key);
  if (/token|auth|password|secret|jwt/i.test(url.hash)) url.hash = '';
  return url.href;
}
export function provider(raw: string): string {
  let host: string; try { host = new URL(raw).hostname.replace(/^www\./, ''); } catch { return 'Website'; }
  return /(^|\.)disneyplus\.com$/.test(host) ? 'Disney+' : /(^|\.)espn\.com$/.test(host) ? 'ESPN' : /(^|\.)dazn\.com$/.test(host) ? 'DAZN' : host;
}
export function reconcile(games: Game[], tabs: chrome.tabs.Tab[], windows: chrome.windows.Window[], bindings: Record<string, Binding>): Record<string, Binding> {
  const result: Record<string, Binding> = {};
  const used = new Set<number>();
  const eligible = tabs.filter(t => t.id != null && !t.incognito && /^https:\/\//.test(t.url || t.pendingUrl || '') && windows.some(w => w.id === t.windowId && ['normal', 'popup'].includes(w.type || '')));
  const reserved = new Set(games.map(g=>bindings[g.key]?.tabId).filter(id=>eligible.some(t=>t.id===id)));
  for (const game of [...games].sort((a,b) => Number(reserved.has(bindings[b.key]?.tabId)) - Number(reserved.has(bindings[a.key]?.tabId)))) {
    const old = bindings[game.key];
    const tab = eligible.find(t => !used.has(t.id!) && t.id === old?.tabId) || eligible.find(t => {
      try { return !used.has(t.id!) && durableUrl(t.url || t.pendingUrl!) === game.url; } catch { return false; }
    });
    if (!tab) continue;
    used.add(tab.id!);
    const win = windows.find(w => w.id === tab.windowId)!;
    result[game.key] = old?.tabId === tab.id ? { ...old, windowId: tab.windowId, managed: old.managed && old.windowId === tab.windowId } : {
      tabId: tab.id!, windowId: tab.windowId, originalWindowId: tab.windowId, originalIndex: tab.index,
      originalBounds: { left: win.left ?? 0, top: win.top ?? 0, width: win.width ?? 800, height: win.height ?? 600 },
      originalPinned: !!tab.pinned, originalDiscardable: tab.autoDiscardable !== false, originalMuted: !!tab.mutedInfo?.muted, managed: win.type==='popup'&&tabs.filter(t=>t.windowId===tab.windowId).length===1,
    };
  }
  return result;
}
