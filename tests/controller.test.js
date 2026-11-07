import test from 'node:test';
import assert from 'node:assert/strict';
import { tileBounds, provider, popupBounds, supportedPlayerOrigin } from '../extension/core.js';
import { createController } from '../extension/engine.js';

function fixture(count = 4) {
  let session = {};
  let serial = 10;
  const calls = [];
  const tabs = new Map(Array.from({ length: count }, (_, index) => { const id = index + 1; return [id, { id, index, windowId: 1, title: `Game ${id}`, url: id % 2 ? 'https://www.disneyplus.com/watch/1' : 'https://www.dazn.com/live/1', active: id === 1, mutedInfo: { muted: id === 2 }, autoDiscardable: true, pinned: false }]; }));
  const windows = new Map([[1, { id: 1, type: 'normal', left: 0, top: 0, width: 1200, height: 800 }]]);
  const screens = [{ id: 'a', isPrimary: true, workArea: { left: 0, top: 0, width: 1920, height: 1040 } }, { id: 'b', workArea: { left: -1920, top: 0, width: 1920, height: 1040 } }];
  const move = (id, windowId, index = 0) => {
    const tab = tabs.get(id); const previous = tab.windowId;
    tab.windowId = windowId; tab.index = index;
    if (![...tabs.values()].some(t => t.windowId === previous)) windows.delete(previous);
    return structuredClone(tab);
  };
  const api = {
    storage: { session: { get: async () => structuredClone(session), set: async value => { session = structuredClone(value); calls.push(['save']); } } },
    system: { display: { getInfo: async () => structuredClone(screens) } },
    tabs: {
      get: async id => { if (!tabs.has(id)) throw new Error('No tab'); return structuredClone(tabs.get(id)); },
      query: async query => structuredClone([...tabs.values()].filter(t => (query.windowId === undefined || t.windowId === query.windowId) && (!query.active || t.active))),
      update: async (id, props) => {
        if (!tabs.has(id)) throw new Error('No tab');
        calls.push(['tab', id, props]); const tab = tabs.get(id);
        if (props.active) for (const other of tabs.values()) if (other.windowId === tab.windowId) other.active = false;
        if ('muted' in props) tab.mutedInfo.muted = props.muted;
        Object.assign(tab, Object.fromEntries(Object.entries(props).filter(([key]) => key !== 'muted')));
        return structuredClone(tab);
      },
      move: async (id, props) => {
        if (windows.get(tabs.get(id)?.windowId)?.type !== 'normal' || windows.get(props.windowId)?.type !== 'normal') throw new Error('Chrome only moves tabs between normal windows.');
        calls.push(['move', id, props]); return move(id, props.windowId, props.index);
      }
    },
    windows: {
      get: async id => { if (!windows.has(id)) throw new Error('No window'); return structuredClone(windows.get(id)); },
      create: async props => { const id = serial++; const win = { id, ...props }; windows.set(id, win); calls.push(['create', props]); move(props.tabId, id); tabs.get(props.tabId).active = true; return structuredClone(win); },
      update: async (id, props) => { if (!windows.has(id)) throw new Error('No window'); calls.push(['window', id, props]); if (props.focused) for (const win of windows.values()) win.focused = false; Object.assign(windows.get(id), props); return structuredClone(windows.get(id)); }
    }
  };
  return { api, tabs, windows, calls, screens, controller: createController(api) };
}
const add = (f, id, displayId = 'a') => f.controller.request({ type: 'ADD', id, displayId });
const get = async f => (await f.controller.request({ type: 'GET' })).state;

test('grid fits negative-origin monitors and leaves room between windows', () => {
  const area = { left: -1920, top: -200, width: 1920, height: 1040 };
  const bounds = tileBounds(area, 4);
  assert.equal(bounds.length, 4);
  for (const b of bounds) { assert.ok(b.left >= area.left); assert.ok(b.top >= area.top); assert.ok(b.left + b.width <= area.left + area.width + 1); assert.ok(b.top + b.height <= area.top + area.height + 1); }
  assert.ok(bounds[0].left + bounds[0].width < bounds[1].left);
});
test('focus layout makes the first game larger and rejects unusable layouts', () => {
  const bounds = tileBounds({ left: 0, top: 0, width: 1920, height: 1080 }, 4, 'focus');
  assert.ok(bounds[0].width > bounds[1].width * 1.8);
  assert.throws(() => tileBounds({ left: 0, top: 0, width: 800, height: 600 }, 9), /Too many/);
  assert.throws(() => tileBounds({ width: 1920, height: 1080 }, 0));
});
test('provider matching cannot mistake lookalike domains for providers', () => {
  assert.equal(provider('https://www.disneyplus.com/a'), 'Disney+');
  assert.equal(provider('https://dazn.com/a'), 'DAZN');
  assert.equal(provider('https://dazn.com.example.org'), 'dazn.com.example.org');
});
test('adding tabs preserves original mute state and only one source remains enabled', async () => {
  const f = fixture(); await add(f, 1); await add(f, 2);
  assert.equal(f.tabs.get(1).mutedInfo.muted, false); assert.equal(f.tabs.get(2).mutedInfo.muted, true);
  assert.equal(f.tabs.get(1).autoDiscardable, false);
  assert.equal((await get(f)).games[1].original.muted, true);
  assert.equal(f.tabs.get(3).mutedInfo.muted, false); // Unselected tabs are untouched.
});
test('audio switches mute the previous game before enabling the next', async () => {
  const f = fixture(); await add(f, 1); await add(f, 2); f.calls.length = 0;
  await f.controller.request({ type: 'LISTEN', id: 2 });
  const updates = f.calls.filter(c => c[0] === 'tab');
  assert.deepEqual(updates, [['tab', 1, { muted: true }], ['tab', 2, { muted: false }]]);
  assert.equal((await get(f)).listeningId, 2);
});
test('rapid competing audio commands serialize and the final click wins', async () => {
  const f = fixture(); await add(f, 1); await add(f, 2);
  await Promise.all([2, 1, 2, 1].map(id => f.controller.request({ type: 'LISTEN', id })));
  assert.equal((await get(f)).listeningId, 1);
  assert.equal(f.tabs.get(2).mutedInfo.muted, true);
});
test('mute-all survives adding another game and next-game cycles through selection', async () => {
  const f = fixture(); await add(f, 1); await add(f, 2);
  await f.controller.request({ type: 'LISTEN', id: null });
  assert.ok([1, 2].every(id => f.tabs.get(id).mutedInfo.muted));
  await add(f, 3);
  assert.equal((await get(f)).listeningId, null);
  assert.ok([1, 2, 3].every(id => f.tabs.get(id).mutedInfo.muted));
  await f.controller.request({ type: 'NEXT' }); assert.equal((await get(f)).listeningId, 1);
  await f.controller.request({ type: 'NEXT' }); assert.equal((await get(f)).listeningId, 2);
  await f.controller.request({ type: 'NEXT' }); assert.equal((await get(f)).listeningId, 3);
  await f.controller.request({ type: 'NEXT' }); assert.equal((await get(f)).listeningId, 1);
});
test('GET does not write storage or cause a dashboard refresh loop', async () => {
  const f = fixture(); await add(f, 1); f.calls.length = 0;
  await get(f); await get(f); assert.deepEqual(f.calls, []);
});
test('invalid targets do not mute selected games and do not poison the action queue', async () => {
  const f = fixture(); await add(f, 1);
  await assert.rejects(f.controller.request({ type: 'LISTEN', id: 999 }));
  assert.equal(f.tabs.get(1).mutedInfo.muted, false);
  assert.equal((await get(f)).listeningId, 1);
});
test('tile uses original tab IDs on assigned monitors and repeat tiling reuses windows', async () => {
  const f = fixture(); await add(f, 1, 'a'); await add(f, 2, 'b');
  await f.controller.request({ type: 'TILE' });
  const created = f.calls.filter(c => c[0] === 'create');
  assert.equal(created.length, 2); assert.equal(created[1][1].left, -1920);
  assert.notEqual(f.tabs.get(1).windowId, f.tabs.get(2).windowId);
  await f.controller.request({ type: 'TILE' });
  assert.equal(f.calls.filter(c => c[0] === 'create').length, 2);
});
test('disconnected monitor fails before any tabs move', async () => {
  const f = fixture(); await add(f, 1, 'a'); await add(f, 2, 'b'); f.screens.pop();
  await assert.rejects(f.controller.request({ type: 'TILE' }), /disconnected/);
  assert.equal(f.calls.filter(c => c[0] === 'create').length, 0);
});
test('restoring returns tabs and original mute and discard settings', async () => {
  const f = fixture(); await add(f, 1); await add(f, 2); await f.controller.request({ type: 'TILE' });
  await f.controller.request({ type: 'RESTORE' });
  assert.equal(f.tabs.get(1).windowId, 1); assert.equal(f.tabs.get(2).windowId, 1);
  assert.equal(f.tabs.get(1).mutedInfo.muted, false); assert.equal(f.tabs.get(2).mutedInfo.muted, true);
  assert.equal(f.tabs.get(1).autoDiscardable, true); assert.equal((await get(f)).games.length, 0);
});
test('restore recreates a closed original window and regroups its tabs', async () => {
  const f = fixture(); for (const id of [1, 2, 3, 4]) await add(f, id);
  await f.controller.request({ type: 'TILE' }); assert.equal(f.windows.has(1), false);
  await f.controller.request({ type: 'REMOVE', id: 1 });
  const restoredWindow = f.tabs.get(1).windowId;
  await f.controller.request({ type: 'RESTORE' });
  assert.ok([...f.tabs.values()].every(t => t.windowId === restoredWindow));
});
test('clicking a selected native window switches audio unless follow focus is off', async () => {
  const f = fixture(); await add(f, 1); await add(f, 2); await f.controller.request({ type: 'TILE' });
  f.windows.get(f.tabs.get(2).windowId).focused = true;
  await f.controller.focus(f.tabs.get(2).windowId); assert.equal((await get(f)).listeningId, 2);
  await f.controller.request({ type: 'FOLLOW', value: false });
  f.windows.get(f.tabs.get(1).windowId).focused = true;
  await f.controller.focus(f.tabs.get(1).windowId); assert.equal((await get(f)).listeningId, 2);
});
test('background-window activation does not steal audio', async () => {
  const f = fixture(); await add(f, 1); await add(f, 2); await f.controller.request({ type: 'TILE' });
  await f.controller.focus(f.tabs.get(2).windowId);
  assert.equal((await get(f)).listeningId, 1);
});
test('closing a selected tab clears stale audio and session state survives worker restarts', async () => {
  const f = fixture(); await add(f, 1); await add(f, 2);
  f.controller = createController(f.api); assert.equal((await get(f)).games.length, 2);
  f.tabs.delete(1); await f.controller.closed(1);
  assert.equal((await get(f)).listeningId, null); assert.equal((await get(f)).games.length, 1);
});

test('active-tab attachment uses the existing ID and never opens a URL or copies a session', async () => {
  const f = fixture(); await f.controller.rememberSource(3);
  await f.controller.request({ type: 'ADD_ACTIVE' });
  assert.deepEqual((await get(f)).games.map(g => g.id), [3]);
  assert.equal(f.calls.filter(c => c[0] === 'create').length, 0);
  assert.equal(f.tabs.get(3).url, 'https://www.disneyplus.com/watch/1');
});
test('adding the active tab reports a useful error when no website tab is remembered', async () => {
  const f = fixture(); await assert.rejects(f.controller.request({ type: 'ADD_ACTIVE' }), /extension icon/);
  assert.equal((await get(f)).games.length, 0);
});
test('seven original tabs arrange on one viewing monitor with a full-width main game', async () => {
  const f = fixture(7); const originalUrls = [...f.tabs.values()].map(t => t.url);
  for (let id = 1; id <= 7; id++) await add(f, id, 'b');
  await f.controller.request({ type: 'ARRANGE' });
  const state = await get(f); assert.equal(state.wallArranged, true); assert.equal(state.wallDisplayId, 'b');
  assert.equal(state.games[0].bounds.width, 1920); assert.equal(state.games[0].bounds.left, -1920);
  assert.ok(state.games.slice(1).every(g => g.bounds.top >= state.games[0].bounds.top + state.games[0].bounds.height));
  assert.equal(new Set([...f.tabs.values()].map(t => t.windowId)).size, 7);
  assert.deepEqual([...f.tabs.values()].map(t => t.url), originalUrls);
  assert.ok(f.calls.filter(c => c[0] === 'create').every(c => 'tabId' in c[1] && !('url' in c[1])));
});
test('promoting a game resizes existing windows and preserves independent audio', async () => {
  const f = fixture(7); for (let id = 1; id <= 7; id++) await add(f, id, 'b');
  await f.controller.request({ type: 'ARRANGE' });
  await f.controller.request({ type: 'LISTEN', id: 2 });
  const ids = [...f.tabs.values()].map(t => t.windowId); const creates = f.calls.filter(c => c[0] === 'create').length;
  await f.controller.request({ type: 'MAIN', id: 7 });
  const state = await get(f); assert.equal(state.mainId, 7); assert.equal(state.listeningId, 2);
  assert.equal(state.games.find(g => g.id === 7).bounds.width, 1920);
  assert.deepEqual([...f.tabs.values()].map(t => t.windowId), ids);
  assert.equal(f.calls.filter(c => c[0] === 'create').length, creates);
});
test('layout and monitor changes reflow the same selected game tabs', async () => {
  const f = fixture(5); for (let id = 1; id <= 5; id++) await add(f, id, 'b');
  await f.controller.request({ type: 'ARRANGE' });
  await f.controller.request({ type: 'WALL_LAYOUT', layout: 'grid' });
  assert.ok((await get(f)).games.every(g => g.bounds.width < 1000));
  await f.controller.request({ type: 'WALL_DISPLAY', displayId: 'a' });
  assert.ok((await get(f)).games.every(g => g.displayId === 'a' && g.bounds.left >= 0));
  assert.equal(f.calls.filter(c => c[0] === 'create').length, 5);
});
test('controller fullscreen toggles the main game and returns to the multibox', async () => {
  const f = fixture(); await add(f, 1, 'b'); await add(f, 2, 'b'); await f.controller.request({ type: 'ARRANGE' });
  await f.controller.request({ type: 'LISTEN', id: 2 });
  await f.controller.request({ type: 'FULLSCREEN' });
  assert.equal((await get(f)).fullscreenId, 1); assert.equal(f.windows.get(f.tabs.get(1).windowId).state, 'fullscreen');
  assert.equal((await get(f)).listeningId, 2);
  await f.controller.request({ type: 'MAIN', id: 2 });
  assert.equal((await get(f)).fullscreenId, 2); assert.equal(f.windows.get(f.tabs.get(2).windowId).state, 'fullscreen');
  await f.controller.request({ type: 'FULLSCREEN' });
  assert.equal((await get(f)).fullscreenId, null);
  assert.ok([1, 2].every(id => f.windows.get(f.tabs.get(id).windowId).state === 'normal'));
});
test('game changes after arranging add, resize and remove actual tabs without restarting others', async () => {
  const f = fixture(); await add(f, 1, 'b'); await add(f, 2, 'b'); await f.controller.request({ type: 'ARRANGE' });
  const firstWindow = f.tabs.get(1).windowId;
  await add(f, 3, 'b'); assert.equal(f.tabs.get(1).windowId, firstWindow); assert.equal((await get(f)).games.length, 3);
  await f.controller.request({ type: 'MAIN', id: 3 }); await f.controller.request({ type: 'REMOVE', id: 3 });
  assert.equal((await get(f)).mainId, 1); assert.equal(f.tabs.get(3).windowId, 1);
  assert.equal(f.tabs.get(1).windowId, firstWindow);
});
test('compact popup players restore through a normal-window bridge', async () => {
  const f = fixture(); await add(f, 1, 'b'); await f.controller.request({ type: 'ARRANGE' });
  assert.equal(f.windows.get(f.tabs.get(1).windowId).type, 'popup');
  await f.controller.request({ type: 'RESTORE' });
  assert.equal(f.tabs.get(1).windowId, 1); assert.equal(f.tabs.get(1).mutedInfo.muted, false);
});
test('focus changes remember the current website even with follow-audio disabled', async () => {
  const f = fixture(); await f.controller.request({ type: 'FOLLOW', value: false });
  f.windows.get(1).focused = true; await f.controller.focus(1);
  assert.equal((await get(f)).sourceTabId, 1);
});
test('bringing the wall forward returns focus to the controller without changing audio', async () => {
  const f = fixture(); f.windows.set(99, { id: 99, type: 'popup', focused: true });
  await add(f, 1, 'b'); await add(f, 2, 'b'); await f.controller.request({ type: 'ARRANGE', controllerWindowId: 99 });
  await f.controller.request({ type: 'LISTEN', id: 1 });
  await f.controller.request({ type: 'RAISE_WALL', controllerWindowId: 99 });
  assert.equal(f.windows.get(99).focused, true); assert.equal((await get(f)).listeningId, 1);
});
test('closing the main Chrome player automatically reflows the remaining windows', async () => {
  const f = fixture(7); for (let id = 1; id <= 7; id++) await add(f, id, 'b');
  await f.controller.request({ type: 'ARRANGE' });
  f.windows.delete(f.tabs.get(1).windowId); f.tabs.delete(1); await f.controller.closed(1);
  const state = await get(f); assert.equal(state.games.length, 6); assert.equal(state.mainId, 2);
  assert.equal(state.games.find(g => g.id === 2).bounds.width, 1920);
  assert.equal(state.listeningId, null);
});
test('tight layout removes requested gaps and safely compensates reported popup borders', () => {
  const bounds = tileBounds({ left: 0, top: 0, width: 1920, height: 1040 }, 3, 'focus', 0);
  assert.equal(bounds[1].top, bounds[0].height);
  assert.equal(bounds[1].left + bounds[1].width, bounds[2].left);
  assert.deepEqual(popupBounds({ left: 0, top: 520, width: 960, height: 520 }, 8), { left: -8, top: 520, width: 976, height: 528 });
  assert.equal(popupBounds({ left: 0, top: 0, width: 960, height: 520 }, 999).left, -16);
  assert.equal(supportedPlayerOrigin('https://dazn.com.evil.example/'), null);
  assert.equal(supportedPlayerOrigin('https://www.dazn.com/'), 'https://www.dazn.com/*');
});
test('player view only executes after selected-site permission and never changes the source tab', async () => {
  const f = fixture(); await add(f, 1, 'b'); await f.controller.request({ type: 'ARRANGE' });
  const originalWindow = f.tabs.get(1).windowId;
  const calls = [];
  f.api.permissions = { contains: async () => false };
  f.api.scripting = { executeScript: async options => { calls.push(options); return [{ frameId: 0, result: { applied: options.args[0] === 'enable', frameInset: 8 } }]; } };
  await f.controller.request({ type: 'PLAYER_VIEW', enabled: true, fit: 'contain' }); assert.equal(calls.length, 0);
  f.api.permissions.contains = async request => request.origins[0] === 'https://www.disneyplus.com/*';
  await f.controller.request({ type: 'PLAYER_VIEW', enabled: true, fit: 'contain' });
  assert.equal(calls.length, 1); assert.equal(calls[0].target.tabId, 1); assert.equal(calls[0].func.name, 'setPlayerView');
  const game = (await get(f)).games[0]; assert.equal(game.playerViewEnabled, true); assert.equal(game.frameInset, 8);
  assert.equal(game.bounds.left, -1928); assert.equal(f.tabs.get(1).windowId, originalWindow);
  assert.equal(f.tabs.get(1).url, 'https://www.disneyplus.com/watch/1');
  await f.controller.request({ type: 'TIGHT_WINDOWS', value: false }); assert.equal((await get(f)).games[0].bounds.left, -1920);
  await f.controller.request({ type: 'RESTORE' }); assert.equal(calls.at(-1).args[0], 'restore'); assert.equal(f.tabs.get(1).windowId, 1);
});
