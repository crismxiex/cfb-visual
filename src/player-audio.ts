// Chrome serializes this function into the existing provider page.
// It only reads/changes the original media element's volume and muted flag.
export function controlPlayerAudio(action: 'read' | 'listen' | 'volume', volume?: number) {
  function collect(root: Document | ShadowRoot): HTMLVideoElement[] {
    const videos = [...root.querySelectorAll('video')];
    for (const node of root.querySelectorAll('*')) {
      if (node.shadowRoot) videos.push(...collect(node.shadowRoot));
      if (node.tagName === 'IFRAME') {
        try { const inner = (node as HTMLIFrameElement).contentDocument; if (inner) videos.push(...collect(inner)); } catch { /* Inaccessible frame. */ }
      }
    }
    return videos;
  }
  function visible(video: HTMLVideoElement) {
    const rect = video.getBoundingClientRect();
    if (rect.width < 40 || rect.height < 30 || video.ended || video.readyState < 2) return false;
    for (let node: HTMLElement | null = video; node;) {
      const css = node.ownerDocument.defaultView!.getComputedStyle(node);
      if (css.display === 'none' || css.visibility === 'hidden' || Number(css.opacity) === 0) return false;
      node = node.parentElement || (node.getRootNode() as ShadowRoot).host as HTMLElement || node.ownerDocument.defaultView?.frameElement as HTMLElement || null;
    }
    return true;
  }
  const video = collect(document).filter(visible).sort((a, b) => {
    if (a.paused !== b.paused) return Number(a.paused) - Number(b.paused);
    const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
    return br.width * br.height - ar.width * ar.height;
  })[0];
  if (!video) return { available: false as const, status: 'Start the player, then refresh audio. Embedded players on other origins may need their own controls.' };
  if (action === 'volume' && (typeof volume !== 'number' || !Number.isFinite(volume) || volume < 0 || volume > 1)) throw new Error('Choose a volume from 0 to 100%.');
  if (action === 'listen') {
    video.volume = volume !== undefined && Number.isFinite(volume) && volume > 0 && volume <= 1 ? volume : video.volume || 0.5;
    video.muted = false;
  } else if (action === 'volume') {
    video.volume = volume!;
    video.muted = volume === 0;
  }
  return { available: true as const, volume: video.volume, muted: video.muted, status: video.paused ? 'Player paused' : '' };
}
