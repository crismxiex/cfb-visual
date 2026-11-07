import { tileBounds, provider, supportedPlayerOrigin } from './core.js';
const $ = id => document.getElementById(id);
const installed = !!globalThis.chrome?.runtime?.id;
let data = { state: { games: [], layouts: {}, wallLayout: 'main', followFocus: true }, tabs: [], displays: [] };
let generation = 0;
let refreshTimer;
let toastTimer;
let working = false;

function element(tag, className = '', text) { const node = document.createElement(tag); node.className = className; if (text !== undefined) node.textContent = text; return node; }
function safely(action) { return (...args) => { try { Promise.resolve(action(...args)).catch(error => toast(error.message, true)); } catch (error) { toast(error.message, true); } }; }
function button(text, className, action) { const node = element('button', className, text); node.addEventListener('click', safely(action)); return node; }
function toast(message, error = false) { $('toast').textContent = message; $('toast').hidden = false; $('toast').classList.toggle('error', error); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, error ? 10000 : 5000); }
async function request(message) {
  if (!installed) throw new Error('Open Saturday through its installed Chrome extension icon.');
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || 'Extension disconnected. Reopen Saturday after reloading the extension.');
  return response.data;
}
async function refresh() { const version = ++generation; const result = await request({ type: 'GET' }); if (version !== generation) return; data = result; render(); }
function scheduleRefresh() { clearTimeout(refreshTimer); refreshTimer = setTimeout(() => refresh().catch(error => toast(error.message, true)), 150); }
async function act(message, notice) { await request(message); await refresh(); if (notice) toast(notice); }
async function changeWindows(message, notice) { if (working) return; working = true; render(); try { await act(message, notice); } finally { working = false; render(); } }
const gameName = game => game.label || data.tabs.find(t => t.id === game.id)?.title || game.title;

function renderPicker() {
  const query = $('search').value.trim().toLowerCase();
  const tabs = data.tabs.filter(tab => `${tab.title} ${tab.url}`.toLowerCase().includes(query));
  $('available-tabs').replaceChildren(...tabs.map(tab => {
    const row = element('div', 'tab-row'); const details = element('div', 'tab-details');
    details.append(element('strong', '', tab.title || 'Untitled tab'), element('small', '', `${provider(tab.url)}${tab.audible ? ' · PLAYING AUDIO' : ''}`));
    const added = data.state.games.some(game => game.id === tab.id);
    const add = button(added ? 'Added ✓' : '+ Add', added ? 'quiet' : 'primary small-button', async () => {
      add.disabled = true;
      try { await changeWindows({ type: 'ADD', id: tab.id, displayId: data.state.wallDisplayId }); }
      finally { add.disabled = added; }
    });
    add.disabled = added || working || data.state.games.length >= 9;
    row.append(element('span', 'tab-initial', provider(tab.url).slice(0, 2).toUpperCase()), details, add); return row;
  }));
  if (!tabs.length) $('available-tabs').append(element('p', 'intro', data.tabs.length ? 'No tabs match your search.' : 'Open your games in Chrome, then refresh this list.'));
}
function renderGame(game, index) {
  const row = element('article', `game-row${game.id === data.state.listeningId ? ' listening' : ''}`);
  const details = element('div', 'game-details'); const title = element('input'); title.value = gameName(game); title.maxLength = 80; title.setAttribute('aria-label', `Game ${index + 1} name`);
  title.addEventListener('change', safely(() => act({ type: 'RENAME', id: game.id, label: title.value })));
  const source = data.tabs.find(tab => tab.id === game.id);
  details.append(title, element('span', 'game-status', `${provider(source?.url) || 'Chrome tab'} · ${data.state.listeningId === game.id ? 'AUDIO SELECTED' : 'MUTED'}${data.state.mainId === game.id ? ' · MAIN GAME' : ''}${game.playerViewStatus ? ' · ' + game.playerViewStatus : ''}`));
  const main = button(data.state.mainId === game.id ? '★ Main game' : 'Make main', data.state.mainId === game.id ? 'quiet selected' : 'quiet', () => changeWindows({ type: 'MAIN', id: game.id }));
  const listen = button(data.state.listeningId === game.id ? '♫ Listening' : 'Listen', 'quiet', () => act({ type: 'LISTEN', id: game.id }));
  const go = button('Go to game ↗', 'quiet', () => act({ type: 'FOCUS', id: game.id }));
  const remove = button('×', 'quiet remove', () => changeWindows({ type: 'REMOVE', id: game.id })); remove.setAttribute('aria-label', `Remove ${gameName(game)} and restore its tab`);
  for (const node of [main, go, remove]) node.disabled = working;
  row.append(element('span', 'game-number', String(index + 1).padStart(2, '0')), details, main, listen, go, remove); return row;
}
function renderOverview() {
  const { state, displays } = data;
  const display = displays.find(item => item.id === state.wallDisplayId);
  $('overview').replaceChildren();
  if (!display || !state.games.length) { $('overview').hidden = true; return; }
  $('overview').hidden = false;
  const games = [...state.games];
  if (state.wallLayout === 'main') games.sort((a, b) => Number(b.id === state.mainId) - Number(a.id === state.mainId));
  try {
    const area = display.workArea;
    const bounds = tileBounds(area, games.length, state.wallLayout === 'main' ? 'focus' : 'grid', state.tightWindows ? 0 : 8);
    $('overview').style.aspectRatio = `${area.width} / ${area.height}`;
    games.forEach((game, i) => {
      const box = button('', `overview-box${state.listeningId === game.id ? ' listening' : ''}`, () => act({ type: 'LISTEN', id: game.id }));
      const b = bounds[i];
      box.style.left = `${100 * (b.left - area.left) / area.width}%`; box.style.top = `${100 * (b.top - area.top) / area.height}%`; box.style.width = `${100 * b.width / area.width}%`; box.style.height = `${100 * b.height / area.height}%`;
      box.append(element('strong', '', `${game.id === state.mainId ? '★ ' : ''}${gameName(game)}`), element('span', '', state.listeningId === game.id ? '♫ AUDIO SELECTED' : 'CHROME PLAYER'));
      box.addEventListener('dblclick', safely(() => changeWindows({ type: 'MAIN', id: game.id }))); $('overview').append(box);
    });
  } catch (error) { $('overview').append(element('p', 'intro', error.message)); }
}
function render() {
  const { state, tabs, displays } = data;
  $('monitor').replaceChildren(...displays.map((display, i) => { const option = element('option', '', `Monitor ${i + 1} · ${display.workArea.width} × ${display.workArea.height}${display.isPrimary ? ' · primary' : ''}`); option.value = display.id; return option; }));
  if (state.wallDisplayId && !displays.some(display => display.id === state.wallDisplayId)) { const missing = element('option', '', 'Viewing monitor disconnected'); missing.value = state.wallDisplayId; $('monitor').append(missing); }
  $('monitor').value = state.wallDisplayId || '';
  $('layout').value = state.wallLayout; $('follow').checked = state.followFocus;
  $('player-fit').value = state.playerFit || 'contain'; $('tight-windows').checked = state.tightWindows !== false;
  $('games').replaceChildren(...state.games.map(renderGame)); $('empty').hidden = !!state.games.length;
  $('game-count').textContent = `${state.games.length} / 9`;
  $('listening').textContent = state.games.some(game => game.id === state.listeningId) ? gameName(state.games.find(game => game.id === state.listeningId)) : 'All games muted';
  const source = tabs.find(tab => tab.id === state.sourceTabId);
  $('source-hint').textContent = source ? `Most recent Chrome tab: ${source.title || provider(source.url)}` : 'To add your active game directly, click Saturday’s extension icon while that game tab is open.';
  $('add-active').disabled = !source || state.games.length >= 9 || working;
  $('add').disabled = state.games.length >= 9 || working;
  $('arrange').disabled = !state.games.length || working; $('arrange').textContent = working ? 'Arranging…' : '▦ Arrange games';
  for (const id of ['raise', 'fullscreen', 'restore', 'mute', 'next', 'clean-view', 'restore-page', 'player-fit']) $(id).disabled = !state.games.length || working;
  $('tight-windows').disabled = working;
  $('monitor').disabled = working; $('layout').disabled = working;
  $('fullscreen').textContent = state.fullscreenId != null ? 'Return to multibox ▦' : 'Fullscreen main game ⛶';
  $('arrangement-status').textContent = state.fullscreenId != null ? 'Main game is fullscreen. Return to multibox to show every game.' : state.wallArranged ? `${state.games.length} real Chrome player windows arranged.` : 'Ready to arrange your selected Chrome tabs.';
  $('layout-warning').hidden = !state.layoutWarning; $('layout-warning').textContent = state.layoutWarning;
  renderOverview(); if ($('picker').open) renderPicker();
}
async function openPicker() { await refresh(); renderPicker(); if (!$('picker').open) $('picker').showModal(); $('search').focus(); }
async function cleanPlayers() {
  const fit = $('player-fit').value || 'contain';
  const origins = [...new Set(data.state.games.map(game => supportedPlayerOrigin(data.tabs.find(tab => tab.id === game.id)?.url)).filter(Boolean))];
  if (!origins.length) throw new Error('Player-only view currently supports Disney+ and DAZN tabs.');
  // Request only the selected provider origins, directly within this button click.
  const allowed = await chrome.permissions.request({ origins });
  if (!allowed) { toast('Page access was not granted. Your current players and logins are unchanged.'); return; }
  await changeWindows({ type: 'PLAYER_VIEW', enabled: true, fit });
  toast(data.state.playerViewReport, !data.state.games.some(game => game.playerViewEnabled));
}
function bind(id, fn) { $(id).addEventListener('click', safely(fn)); }
bind('add', openPicker); bind('add-empty', openPicker); bind('add-active', () => changeWindows({ type: 'ADD_ACTIVE', displayId: data.state.wallDisplayId }));
bind('arrange', () => changeWindows({ type: 'ARRANGE' }, 'Your existing Chrome players are arranged. Click a game window to hear it.'));
bind('raise', () => changeWindows({ type: 'RAISE_WALL' })); bind('fullscreen', () => changeWindows({ type: 'FULLSCREEN' }));
bind('restore', () => changeWindows({ type: 'RESTORE' }, 'Session ended. Your tabs and previous mute settings are restored.'));
bind('clean-view', cleanPlayers);
bind('restore-page', () => changeWindows({ type: 'PLAYER_VIEW', enabled: false }, 'Original page controls restored where access is available.'));
bind('mute', () => act({ type: 'LISTEN', id: null })); bind('next', () => act({ type: 'NEXT' }));
bind('help', () => $('help-dialog').showModal()); bind('close-help', () => $('help-dialog').close()); bind('close-picker', () => $('picker').close()); bind('refresh-tabs', refresh);
$('search').addEventListener('input', renderPicker);
$('monitor').addEventListener('change', safely(() => changeWindows({ type: 'WALL_DISPLAY', displayId: $('monitor').value })));
$('layout').addEventListener('change', safely(() => changeWindows({ type: 'WALL_LAYOUT', layout: $('layout').value })));
$('follow').addEventListener('change', safely(() => act({ type: 'FOLLOW', value: $('follow').checked })));
$('tight-windows').addEventListener('change', safely(() => changeWindows({ type: 'TIGHT_WINDOWS', value: $('tight-windows').checked })));
$('player-fit').addEventListener('change', safely(() => data.state.games.some(game => game.playerViewEnabled) ? cleanPlayers() : act({ type: 'PLAYER_FIT', fit: $('player-fit').value })));
document.addEventListener('keydown', safely(event => {
  if (event.repeat || event.ctrlKey || event.altKey || event.metaKey || /INPUT|SELECT|TEXTAREA/.test(event.target.tagName) || document.querySelector('dialog[open]')) return;
  if (event.key.toLowerCase() === 'm') return act({ type: 'LISTEN', id: null });
  const game = /^[1-9]$/.test(event.key) ? data.state.games[Number(event.key) - 1] : null;
  if (game) return act({ type: 'LISTEN', id: game.id });
}));
if (installed) {
  chrome.storage.onChanged.addListener((changes, area) => { if (area === 'session' && changes.saturday) scheduleRefresh(); });
  chrome.tabs.onUpdated.addListener((_id, change) => { if ('title' in change || 'url' in change || change.status === 'complete') scheduleRefresh(); });
  chrome.tabs.onRemoved.addListener(scheduleRefresh); chrome.system.display.onDisplayChanged.addListener(scheduleRefresh);
  refresh().catch(error => toast(error.message, true));
} else { $('preview-notice').hidden = false; render(); }
