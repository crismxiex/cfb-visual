import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { initialState } from '../extension/core.js';

test('controller buttons send existing-tab, main, layout and fullscreen commands to Chrome', async () => {
  class Element {
    constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.style = {}; this.events = {}; this.value = ''; this.classList = { toggle() {} }; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; }
    addEventListener(name, action) { this.events[name] = action; }
    setAttribute() {}
    focus() {}
    showModal() { this.open = true; }
    close() { this.open = false; }
  }
  const html = await readFile(new URL('../extension/dashboard.html', import.meta.url), 'utf8');
  const nodes = new Map([...html.matchAll(/id="([^"]+)"/g)].map(match => [match[1], new Element('div')]));
  const calls = [];
  const grants = [];
  const data = { state: { ...initialState(), games: [{ id: 11, title: 'Game one', label: '' }, { id: 12, title: 'Game two', label: '' }], mainId: 11, listeningId: 11, wallDisplayId: 'view', sourceTabId: 12 }, tabs: [{ id: 11, title: 'Game one', url: 'https://disneyplus.com/' }, { id: 12, title: 'Game two', url: 'https://dazn.com/' }], displays: [{ id: 'view', workArea: { left: 0, top: 0, width: 1920, height: 1080 } }] };
  const globals = { document: globalThis.document, chrome: globalThis.chrome, setTimeout: globalThis.setTimeout };
  const event = { addListener() {} };
  globalThis.setTimeout = () => 0;
  globalThis.document = { createElement: tag => new Element(tag), getElementById: id => nodes.get(id), addEventListener() {}, querySelector: () => null };
  globalThis.chrome = { runtime: { id: 'test', sendMessage: async message => { calls.push(message); return { ok: true, data }; } }, permissions: { request: async options => { grants.push(options); return true; } }, tabs: { onUpdated: event, onRemoved: event }, storage: { onChanged: event }, system: { display: { onDisplayChanged: event } } };
  const flush = () => new Promise(resolve => setImmediate(resolve));
  try {
    await import('../extension/dashboard.js'); await flush();
    nodes.get('add-active').events.click(); await flush(); assert.ok(calls.some(c => c.type === 'ADD_ACTIVE'));
    nodes.get('arrange').events.click(); await flush(); assert.ok(calls.some(c => c.type === 'ARRANGE'));
    nodes.get('games').children[1].children[2].events.click(); await flush(); assert.ok(calls.some(c => c.type === 'MAIN' && c.id === 12));
    nodes.get('games').children[1].children[3].events.click(); await flush(); assert.ok(calls.some(c => c.type === 'LISTEN' && c.id === 12));
    nodes.get('layout').value = 'grid'; nodes.get('layout').events.change(); await flush(); assert.ok(calls.some(c => c.type === 'WALL_LAYOUT' && c.layout === 'grid'));
    nodes.get('fullscreen').events.click(); await flush(); assert.ok(calls.some(c => c.type === 'FULLSCREEN'));
    nodes.get('clean-view').events.click(); await flush();
    assert.deepEqual(grants[0].origins, ['https://disneyplus.com/*', 'https://dazn.com/*']);
    assert.ok(calls.some(c => c.type === 'PLAYER_VIEW' && c.enabled === true));
    const previousCount = calls.filter(c => c.type === 'PLAYER_VIEW').length;
    chrome.permissions.request = async () => false;
    nodes.get('clean-view').events.click(); await flush();
    assert.equal(calls.filter(c => c.type === 'PLAYER_VIEW').length, previousCount);
    nodes.get('restore-page').events.click(); await flush(); assert.ok(calls.some(c => c.type === 'PLAYER_VIEW' && c.enabled === false));
    nodes.get('restore').events.click(); await flush(); assert.ok(calls.some(c => c.type === 'RESTORE'));
  } finally { Object.assign(globalThis, globals); }
});

test('the shipped extension contains no video capture, iframe viewer or cookie-import path', async () => {
  const root = new URL('../extension/', import.meta.url);
  for (const file of await readdir(root)) {
    if (!/\.(js|html|json)$/.test(file)) continue;
    const code = await readFile(new URL(file, root), 'utf8');
    assert.doesNotMatch(code, /getDisplayMedia|tabCapture|captureVisibleTab|MediaStream|<iframe|chrome\.cookies|document\.cookie/, file);
  }
});
