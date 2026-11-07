import { initialState, tileBounds, popupBounds, supportedPlayerOrigin } from './core.js';
import { setPlayerView } from './player-view.js';

export function createController(api) {
  let state;
  let arranging = false;
  let tail = Promise.resolve();
  const run = fn => { const task = tail.then(fn); tail = task.catch(() => {}); return task; };
  const load = async () => state ||= { ...initialState(), ...(await api.storage.session.get('saturday')).saturday };
  const save = async () => { await api.storage.session.set({ saturday: structuredClone(state) }); return structuredClone(state); };
  const liveTab = async id => { try { return await api.tabs.get(id); } catch { return null; } };
  async function prune() {
    const live = await Promise.all(state.games.map(g => liveTab(g.id)));
    state.games = state.games.filter((_, i) => live[i]);
    if (!state.games.some(g => g.id === state.listeningId)) state.listeningId = null;
    if (!state.games.some(g => g.id === state.mainId)) state.mainId = state.games[0]?.id ?? null;
    if (!state.games.some(g => g.id === state.fullscreenId)) state.fullscreenId = null;
  }
  async function audio(id) {
    if (id !== null && !state.games.some(g => g.id === id)) throw new Error('That game is no longer selected.');
    // Finish muting every other source before enabling the new one.
    await Promise.all(state.games.filter(g => g.id !== id).map(async g => {
      if (await liveTab(g.id)) await api.tabs.update(g.id, { muted: true });
    }));
    state.listeningId = null;
    if (id !== null) { await api.tabs.update(id, { muted: false }); state.listeningId = id; }
  }
  async function displays() {
    const result = await api.system.display.getInfo();
    return result.filter(d => d.isEnabled !== false && d.activeState !== 'inactive').sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
  }
  async function playerView(game, enabled, fit = state.playerFit) {
    const tab = await liveTab(game.id);
    const origin = supportedPlayerOrigin(tab?.url);
    if (!origin || !api.permissions || !api.scripting || !await api.permissions.contains({ origins: [origin] })) {
      game.playerViewStatus = enabled ? 'Player view needs optional access to this Disney+/DAZN page.' : '';
      return false;
    }
    try {
      const results = await api.scripting.executeScript({ target: { tabId: game.id, frameIds: [0] }, func: setPlayerView, args: [enabled ? 'enable' : 'restore', fit] });
      const applied = enabled && results.some(frame => frame.result?.applied);
      game.playerViewEnabled = applied;
      game.playerViewStatus = applied ? 'Player-only view applied' : enabled ? 'Start playback first, then choose Clean player view.' : '';
      const inset = results.find(frame => frame.frameId === 0)?.result?.frameInset;
      if (Number.isInteger(inset) && inset >= 0 && inset <= 16) game.frameInset = inset;
      return applied;
    } catch {
      game.playerViewStatus = enabled ? 'Could not adjust this player. Use its theater view or try again after playback starts.' : '';
      return false;
    }
  }
  async function restoreGame(game, replacements) {
    const tab = await liveTab(game.id);
    if (!tab) return;
    if (game.playerViewEnabled) await playerView(game, false);
    if (game.managedWindowId) {
      let target = replacements.get(game.original.windowId) || game.original.windowId;
      try { if ((await api.windows.get(target)).type === 'popup') throw new Error('Restore into a normal window.'); }
      catch {
        const originalId = game.original.windowId;
        const bounds = game.original.bounds;
        const win = await api.windows.create({ tabId: game.id, type: 'normal', focused: false, ...bounds });
        target = win.id;
        replacements.set(originalId, target);
        for (const other of state.games) if (other.original.windowId === originalId) other.original.windowId = target;
      }
      const now = await api.tabs.get(game.id);
      if (now.windowId !== target) {
        // tabs.move is restricted to normal windows. Leave the compact popup first.
        const currentWindow = await api.windows.get(now.windowId);
        if (currentWindow.type === 'popup') await api.windows.create({ tabId: game.id, type: 'normal', focused: false });
        await api.tabs.move(game.id, { windowId: target, index: game.original.index });
      }
    }
    await api.tabs.update(game.id, { muted: game.original.muted, autoDiscardable: game.original.autoDiscardable, pinned: game.original.pinned });
  }
  async function raiseGames(controllerWindowId) {
    for (const game of state.games) {
      const tab = await liveTab(game.id);
      if (tab && game.managedWindowId === tab.windowId) await api.windows.update(tab.windowId, { focused: true });
    }
    if (controllerWindowId != null) {
      try { await api.windows.update(controllerWindowId, { focused: true }); } catch { }
    }
  }
  async function tile(unified, controllerWindowId, raise = false) {
    if (!state.games.length) throw new Error('Add game tabs first.');
    const screens = await displays();
    const screen = screens.find(d => d.id === state.wallDisplayId) || (!state.wallDisplayId ? screens[1] || screens[0] : null);
    if (unified && !screen) throw new Error('Your viewing monitor disconnected. Choose another monitor.');
    const plan = [];
    for (const display of unified ? [screen] : screens) {
      const games = unified ? [...state.games] : state.games.filter(g => g.displayId === display.id);
      if (!games.length) continue;
      const layout = unified ? (state.wallLayout === 'main' ? 'focus' : 'grid') : state.layouts[display.id];
      if (layout === 'focus') games.sort((a, b) => Number(b.id === state.mainId) - Number(a.id === state.mainId));
      const bounds = tileBounds(display.workArea, games.length, layout, unified && state.tightWindows ? 0 : 8);
      games.forEach((game, i) => plan.push({ game, bounds: bounds[i], displayId: display.id }));
    }
    if (plan.length !== state.games.length) throw new Error('A monitor disconnected. Reassign its games before arranging.');
    const wasArranging = arranging; arranging = true;
    state.layoutWarning = '';
    try {
      for (const { game, bounds: plannedBounds, displayId } of plan) {
        const bounds = popupBounds(plannedBounds, unified && state.tightWindows ? game.frameInset : 0);
        const tab = await api.tabs.get(game.id);
        let win;
        if (game.managedWindowId === tab.windowId) {
          await api.windows.update(tab.windowId, { state: 'normal' });
          win = await api.windows.update(tab.windowId, bounds);
        } else {
          win = await api.windows.create({ tabId: game.id, type: 'popup', focused: false, ...bounds });
          game.managedWindowId = win.id;
        }
        game.displayId = displayId;
        game.bounds = Object.fromEntries(Object.keys(bounds).map(key => [key, typeof win[key] === 'number' ? win[key] : bounds[key]]));
        if (Object.keys(bounds).some(key => Math.abs(game.bounds[key] - bounds[key]) > 12)) state.layoutWarning = 'Chrome adjusted some window sizes. Use fewer games or a larger display if the players overlap.';
        await save();
      }
      if (unified) { state.wallDisplayId = screen.id; state.wallArranged = true; }
      state.fullscreenId = null;
      await audio(state.listeningId);
      if (raise) await raiseGames(controllerWindowId);
    } finally { arranging = wasArranging; }
  }
  async function fullscreen(id, controllerWindowId) {
    const game = state.games.find(g => g.id === id);
    if (!game) throw new Error('Choose a main game first.');
    const tab = await api.tabs.get(id);
    if (tab.windowId !== game.managedWindowId) throw new Error('Arrange the games before using fullscreen.');
    const wasArranging = arranging; arranging = true;
    try {
      await api.windows.update(tab.windowId, { state: 'fullscreen', focused: true }); state.fullscreenId = id;
      if (controllerWindowId != null) { try { await api.windows.update(controllerWindowId, { focused: true }); } catch { } }
    }
    finally { arranging = wasArranging; }
  }
  async function dispatch(message) {
    await load();
    await prune();
    const { type } = message;
    if (type === 'GET') {
      const tabs = (await api.tabs.query({})).filter(t => /^https?:/.test(t.url || '') && !t.incognito);
      const screens = await displays();
      const result = structuredClone(state);
      result.wallDisplayId ||= (screens[1] || screens[0])?.id;
      return { state: result, tabs, displays: screens };
    }
    if (type === 'ADD_ACTIVE') {
      const tab = await liveTab(state.sourceTabId);
      if (!tab || !/^https?:/.test(tab.url || '')) throw new Error('Open a game tab and click Saturday’s extension icon there, or choose it from Add game tabs.');
      return dispatch({ ...message, type: 'ADD', id: tab.id });
    }
    if (type === 'ADD') {
      if (state.games.some(g => g.id === message.id)) return save();
      if (state.games.length >= 9) throw new Error('This multibox supports up to 9 game tabs.');
      const tab = await api.tabs.get(message.id);
      if (!/^https?:/.test(tab.url || '') || tab.incognito) throw new Error('Choose a regular website tab.');
      const win = await api.windows.get(tab.windowId);
      const screens = await displays();
      const displayId = screens.some(d => d.id === message.displayId) ? message.displayId : screens.find(d => d.id === state.wallDisplayId)?.id || (screens[1] || screens[0])?.id;
      const firstGame = state.games.length === 0;
      state.games.push({ id: tab.id, title: tab.title || 'Untitled game', label: '', displayId, original: {
        windowId: tab.windowId, index: tab.index, muted: tab.mutedInfo?.muted || false,
        autoDiscardable: tab.autoDiscardable !== false, pinned: !!tab.pinned,
        bounds: { left: win.left, top: win.top, width: win.width, height: win.height }
      } });
      await api.tabs.update(tab.id, { autoDiscardable: false });
      state.mainId ??= tab.id;
      state.wallDisplayId ??= displayId;
      await audio(firstGame ? tab.id : state.listeningId);
      await save();
      if (state.wallArranged) await tile(true, message.controllerWindowId, true);
    } else if (type === 'LISTEN') {
      await audio(message.id);
    } else if (type === 'NEXT') {
      if (state.games.length) {
        const index = state.games.findIndex(g => g.id === state.listeningId);
        await audio(state.games[(index + 1) % state.games.length].id);
      }
    } else if (type === 'FOLLOW') {
      state.followFocus = !!message.value;
    } else if (type === 'TIGHT_WINDOWS') {
      state.tightWindows = !!message.value;
      if (state.wallArranged) await tile(true, message.controllerWindowId, true);
    } else if (type === 'PLAYER_FIT') {
      if (!['contain', 'cover'].includes(message.fit)) throw new Error('Choose Fit or Fill.');
      state.playerFit = message.fit;
    } else if (type === 'PLAYER_VIEW') {
      if (!state.games.length) throw new Error('Add your game tabs first.');
      if (!['contain', 'cover'].includes(message.fit || state.playerFit)) throw new Error('Choose Fit or Fill.');
      state.playerFit = message.fit || state.playerFit;
      let applied = 0;
      for (const game of state.games) if (await playerView(game, !!message.enabled)) applied++;
      state.playerViewReport = message.enabled ? `${applied} of ${state.games.length} players adjusted. Pausing a player restores its page controls.` : 'Original page controls restored where access is available.';
      if (state.wallArranged) await tile(true, message.controllerWindowId, true);
    } else if (type === 'MAIN') {
      if (!state.games.some(g => g.id === message.id)) throw new Error('That game is no longer selected.');
      const wasFullscreen = state.fullscreenId !== null;
      state.mainId = message.id;
      if (state.wallArranged) await tile(true, message.controllerWindowId, true);
      if (wasFullscreen) await fullscreen(message.id, message.controllerWindowId);
    } else if (type === 'WALL_DISPLAY') {
      if (!(await displays()).some(d => d.id === message.displayId)) throw new Error('That monitor is disconnected.');
      state.wallDisplayId = message.displayId;
      if (state.wallArranged) await tile(true, message.controllerWindowId, true);
    } else if (type === 'WALL_LAYOUT') {
      if (!['main', 'grid'].includes(message.layout)) throw new Error('Unknown layout.');
      state.wallLayout = message.layout;
      if (state.wallArranged) await tile(true, message.controllerWindowId, true);
    } else if (type === 'ARRANGE') {
      await tile(true, message.controllerWindowId, true);
    } else if (type === 'RAISE_WALL') {
      const wasArranging = arranging; arranging = true;
      try { if (!state.wallArranged) await tile(true, message.controllerWindowId); await raiseGames(message.controllerWindowId); }
      finally { arranging = wasArranging; }
    } else if (type === 'FULLSCREEN') {
      if (state.fullscreenId !== null) await tile(true, message.controllerWindowId, true);
      else { if (!state.wallArranged) await tile(true, message.controllerWindowId); await fullscreen(state.mainId, message.controllerWindowId); }
    } else if (type === 'ASSIGN') {
      const game = state.games.find(g => g.id === message.id);
      if (!game) throw new Error('That game has closed.');
      if (!(await displays()).some(d => d.id === message.displayId)) throw new Error('That monitor is disconnected.');
      game.displayId = message.displayId;
    } else if (type === 'RENAME') {
      const game = state.games.find(g => g.id === message.id);
      if (game) game.label = String(message.label || '').trim().slice(0, 80);
    } else if (type === 'LAYOUT') {
      if (!['grid', 'focus'].includes(message.layout)) throw new Error('Unknown layout.');
      state.layouts[message.displayId] = message.layout;
    } else if (type === 'FOCUS') {
      if (!state.games.some(g => g.id === message.id)) throw new Error('That game is no longer selected.');
      const tab = await api.tabs.update(message.id, { active: true });
      await audio(tab.id);
      await api.windows.update(tab.windowId, { focused: true });
    } else if (type === 'TILE') {
      await tile(false);
    } else if (type === 'REMOVE' || type === 'RESTORE') {
      arranging = true;
      try {
        const games = state.games.filter(g => type === 'RESTORE' || g.id === message.id).sort((a, b) => a.original.index - b.original.index);
        const replacements = new Map();
        for (const game of games) {
          await restoreGame(game, replacements);
          state.games = state.games.filter(g => g.id !== game.id);
          if (state.listeningId === game.id) state.listeningId = null;
          await save();
        }
        if (!state.games.some(g => g.id === state.mainId)) state.mainId = state.games[0]?.id ?? null;
        if (state.games.length && state.wallArranged) await tile(true, message.controllerWindowId, true);
        if (!state.games.length) { state.wallArranged = false; state.fullscreenId = null; state.layoutWarning = ''; }
      } finally { arranging = false; }
    } else throw new Error('Unknown action.');
    return save();
  }
  return {
    request: message => run(() => dispatch(message)),
    rememberSource: id => run(async () => {
      await load(); const tab = await liveTab(id);
      if (tab && /^https?:/.test(tab.url || '') && !tab.incognito && state.sourceTabId !== id) { state.sourceTabId = id; await save(); }
    }),
    focus: windowId => {
      if (arranging || windowId < 0) return Promise.resolve();
      return run(async () => {
        await load();
        // Activating a tab in an unfocused window must not steal the audio.
        let window;
        try { window = await api.windows.get(windowId); } catch { return; }
        if (!window.focused) return;
        const [tab] = await api.tabs.query({ windowId, active: true });
        let changed = false;
        if (tab && /^https?:/.test(tab.url || '') && !tab.incognito && state.sourceTabId !== tab.id) { state.sourceTabId = tab.id; changed = true; }
        if (tab && state.followFocus && state.games.some(g => g.id === tab.id) && state.listeningId !== tab.id) { await audio(tab.id); changed = true; }
        if (changed) await save();
      });
    },
    closed: id => run(async () => {
      await load();
      const selected = state.games.some(g => g.id === id);
      if (!selected && state.sourceTabId !== id) return;
      state.games = state.games.filter(g => g.id !== id);
      if (state.listeningId === id) state.listeningId = null;
      if (state.sourceTabId === id) state.sourceTabId = null;
      if (state.mainId === id) state.mainId = state.games[0]?.id ?? null;
      if (selected && state.wallArranged && state.games.length) await tile(true);
      if (!state.games.length) { state.wallArranged = false; state.fullscreenId = null; state.layoutWarning = ''; }
      await save();
    })
  };
}
