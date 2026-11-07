// Executed in an isolated extension world in the selected provider document.
// This styles the existing video element; it does not replace playback or its source.
export function setPlayerView(action, fit = 'contain') {
  const key = '__saturdayPlayerViewV1';
  const existing = window[key];
  const frameInset = window === window.top && outerWidth - innerWidth >= 0 && outerWidth - innerWidth <= 32 ? Math.round((outerWidth - innerWidth) / 2) : null;
  if (action === 'restore') {
    existing?.restore();
    return { applied: false, restored: !!existing, frameInset };
  }
  if (existing && existing.video.isConnected) {
    existing.setFit(fit);
    return { applied: true, frameInset };
  }
  existing?.restore();
  function collect(root) {
    const found = [...root.querySelectorAll('video')];
    for (const node of root.querySelectorAll('*')) {
      if (node.shadowRoot) found.push(...collect(node.shadowRoot));
      // Same-origin embedded players can be styled without granting other sites access.
      if (node.tagName === 'IFRAME') { try { if (node.contentDocument) found.push(...collect(node.contentDocument)); } catch { } }
    }
    return found;
  }
  function parentOf(node) { return node.parentElement || node.getRootNode?.().host || node.ownerDocument?.defaultView?.frameElement || null; }
  function visible(video) {
    const rect = video.getBoundingClientRect();
    if (rect.width < 40 || rect.height < 30 || video.paused || video.ended || video.readyState < 2) return false;
    for (let node = video; node; node = parentOf(node)) {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    }
    return true;
  }
  const candidates = collect(document).filter(visible).sort((a, b) => {
    const first = a.getBoundingClientRect(); const second = b.getBoundingClientRect();
    return second.width * second.height - first.width * first.height;
  });
  const video = candidates[0];
  if (!video) return { applied: false, reason: 'Start playback first, then choose Clean player view.', frameInset };
  const saved = new Map();
  function style(node, values) {
    if (!saved.has(node)) saved.set(node, new Map());
    for (const [property, value] of Object.entries(values)) {
      if (!saved.get(node).has(property)) saved.get(node).set(property, [node.style.getPropertyValue(property), node.style.getPropertyPriority(property)]);
      node.style.setProperty(property, value, 'important');
    }
  }
  for (let node = parentOf(video); node; node = parentOf(node)) {
    style(node, { transform: 'none', filter: 'none', perspective: 'none', contain: 'none', 'will-change': 'auto', overflow: 'visible', position: 'static', isolation: 'auto', 'z-index': 'auto', 'clip-path': 'none' });
    if (node.tagName === 'IFRAME') style(node, { position: 'fixed', top: '0', left: '0', width: '100vw', height: '100vh', border: '0', 'z-index': '2147483645' });
  }
  style(document.documentElement, { overflow: 'hidden', background: '#000' });
  if (document.body) style(document.body, { overflow: 'hidden', background: '#000', margin: '0' });
  style(video, { position: 'fixed', top: '0', left: '0', width: '100vw', height: '100vh', 'max-width': 'none', 'max-height': 'none', margin: '0', transform: 'none', 'z-index': '2147483646', background: '#000', 'object-fit': fit === 'cover' ? 'cover' : 'contain' });
  const exit = document.createElement('button');
  exit.textContent = 'Restore page controls';
  exit.setAttribute('aria-label', 'Exit Saturday player-only view');
  exit.style.cssText = 'position:fixed!important;top:8px!important;right:8px!important;z-index:2147483647!important;background:#172110dd!important;color:#d4edb5!important;border:1px solid #9abd6c!important;border-radius:5px!important;padding:7px 10px!important;font:11px Arial,sans-serif!important;cursor:pointer!important';
  (document.body || document.documentElement).append(exit);
  let observer;
  function restore() {
    observer?.disconnect();
    for (const [node, properties] of saved) for (const [property, [value, priority]] of properties) {
      if (value) node.style.setProperty(property, value, priority); else node.style.removeProperty(property);
    }
    exit.remove();
    for (const event of ['pause', 'ended', 'emptied', 'error']) video.removeEventListener(event, restore);
    window.removeEventListener('pagehide', restore);
    delete window[key];
  }
  for (const event of ['pause', 'ended', 'emptied', 'error']) video.addEventListener(event, restore);
  window.addEventListener('pagehide', restore, { once: true });
  exit.addEventListener('click', event => { event.stopPropagation(); restore(); });
  observer = new MutationObserver(() => { if (!video.isConnected || [...saved.keys()].some(node => node.tagName === 'IFRAME' && !node.isConnected)) restore(); });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  const videoRoot = video.getRootNode();
  if (videoRoot !== document) observer.observe(videoRoot, { childList: true, subtree: true });
  window[key] = { video, restore, setFit(value) { style(video, { 'object-fit': value === 'cover' ? 'cover' : 'contain' }); } };
  return { applied: true, frameInset };
}
