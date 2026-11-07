import test from 'node:test';
import assert from 'node:assert/strict';
import { setPlayerView } from '../extension/player-view.js';

function fixture() {
  class Style {
    constructor() { this.properties = new Map(); }
    setProperty(key, value, priority = '') { this.properties.set(key, [value, priority]); }
    getPropertyValue(key) { return this.properties.get(key)?.[0] || ''; }
    getPropertyPriority(key) { return this.properties.get(key)?.[1] || ''; }
    removeProperty(key) { this.properties.delete(key); }
  }
  class Node {
    constructor() { this.style = new Style(); this.events = new Map(); this.isConnected = true; this.children = []; }
    addEventListener(name, fn) { this.events.set(name, fn); }
    removeEventListener(name) { this.events.delete(name); }
    append(node) { this.children.push(node); node.parentElement = this; }
    remove() { this.isConnected = false; if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(node => node !== this); }
    setAttribute() {}
    getRootNode() { return {}; }
    getBoundingClientRect() { return { width: 960, height: 540 }; }
  }
  const html = new Node(); const body = new Node(); html.append(body);
  const video = new Node(); body.append(video); Object.assign(video, { paused: false, ended: false, readyState: 4, controls: false, currentSrc: 'unchanged-provider-playback' });
  video.style.setProperty('position', 'relative'); video.style.setProperty('object-fit', 'scale-down', 'important');
  let observer;
  const document = { documentElement: html, body, querySelectorAll: selector => selector === 'video' ? [video] : [], createElement: () => new Node() };
  const window = new Node(); window.top = window;
  const replacements = { window, document, outerWidth: 1016, innerWidth: 1000, getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }), MutationObserver: class { constructor(fn) { this.callback = fn; observer = this; } observe() {} disconnect() { this.disconnected = true; } } };
  const savedGlobals = Object.fromEntries(Object.keys(replacements).map(key => [key, globalThis[key]]));
  Object.assign(globalThis, replacements);
  return { video, body, html, document, window, Node, get observer() { return observer; }, cleanup() { window.__saturdayPlayerViewV1?.restore(); Object.assign(globalThis, savedGlobals); } };
}
test('player view styles the original video in place and restores existing CSS exactly', () => {
  const f = fixture();
  try {
    const result = setPlayerView('enable', 'contain');
    assert.equal(result.applied, true); assert.equal(result.frameInset, 8);
    assert.equal(f.video.parentElement, f.body); assert.equal(f.video.currentSrc, 'unchanged-provider-playback'); assert.equal(f.video.controls, false);
    assert.equal(f.video.style.getPropertyValue('position'), 'fixed'); assert.equal(f.video.style.getPropertyValue('object-fit'), 'contain');
    const children = f.body.children.length; setPlayerView('enable', 'cover');
    assert.equal(f.video.style.getPropertyValue('object-fit'), 'cover'); assert.equal(f.body.children.length, children);
    setPlayerView('restore');
    assert.equal(f.video.style.getPropertyValue('position'), 'relative'); assert.equal(f.video.style.getPropertyValue('object-fit'), 'scale-down');
    assert.equal(f.video.style.getPropertyPriority('object-fit'), 'important'); assert.equal(f.video.style.getPropertyValue('width'), ''); assert.equal(f.body.children.length, 1);
  } finally { f.cleanup(); }
});
test('paused or unloaded video leaves login and provider pages unchanged', () => {
  const f = fixture();
  try {
    f.video.paused = true; f.video.readyState = 0;
    const result = setPlayerView('enable'); assert.equal(result.applied, false);
    assert.equal(f.video.style.getPropertyValue('position'), 'relative'); assert.equal(f.body.children.length, 1); assert.equal(f.window.__saturdayPlayerViewV1, undefined);
  } finally { f.cleanup(); }
});
test('pausing or replacing the video restores provider controls and removes listeners', () => {
  const f = fixture();
  try {
    setPlayerView('enable'); f.video.events.get('pause')();
    assert.equal(f.window.__saturdayPlayerViewV1, undefined); assert.equal(f.video.style.getPropertyValue('position'), 'relative'); assert.equal(f.video.events.size, 0);
    setPlayerView('enable'); f.video.isConnected = false; f.observer.callback();
    assert.equal(f.window.__saturdayPlayerViewV1, undefined); assert.equal(f.observer.disconnected, true);
  } finally { f.cleanup(); }
});
test('same-origin embedded video expands its existing frame and restores it afterward', () => {
  const f = fixture();
  try {
    const frame = new f.Node(); frame.tagName = 'IFRAME';
    const innerHtml = new f.Node(); const innerBody = new f.Node(); innerHtml.append(innerBody);
    const innerDocument = { defaultView: { frameElement: frame }, querySelectorAll: selector => selector === 'video' ? [f.video] : [] };
    frame.contentDocument = innerDocument;
    innerHtml.ownerDocument = innerDocument; innerBody.ownerDocument = innerDocument; f.video.ownerDocument = innerDocument;
    f.video.getRootNode = () => innerDocument;
    f.body.children = []; f.body.append(frame); innerBody.append(f.video);
    f.document.querySelectorAll = selector => selector === '*' ? [frame] : [];
    assert.equal(setPlayerView('enable').applied, true);
    assert.equal(frame.style.getPropertyValue('position'), 'fixed'); assert.equal(frame.style.getPropertyValue('width'), '100vw');
    assert.equal(f.video.parentElement, innerBody);
    setPlayerView('restore'); assert.equal(frame.style.getPropertyValue('position'), ''); assert.equal(frame.style.getPropertyValue('width'), '');
  } finally { f.cleanup(); }
});
