// Self-contained because Chrome serializes this function into its isolated world.
// Only presentation of the existing element changes: no playback/source calls.
export function setCleanPlayerView(action: 'enable' | 'restore' | 'fit', fit: 'contain' | 'cover' = 'contain') {
  type Session = { video: HTMLVideoElement; restore: () => void; setFit: (fit: string) => void };
  const page = window as Window & { __gamedeckPlayerViewV1?: Session };
  const existing = page.__gamedeckPlayerViewV1;
  if (action === 'restore') { existing?.restore(); return { applied: false, restored: !!existing }; }
  if (existing?.video.isConnected && !existing.video.paused && !existing.video.ended) {
    existing.setFit(fit); return { applied: true };
  }
  existing?.restore();
  if(action==='fit')return {applied:false,reason:'Clean player view is not active. Choose Clean player view after playback starts.'};
  function collect(root: Document | ShadowRoot): HTMLVideoElement[] {
    const videos = [...root.querySelectorAll('video')];
    for (const node of root.querySelectorAll('*')) {
      if (node.shadowRoot) videos.push(...collect(node.shadowRoot));
      if (node.tagName === 'IFRAME') {
        try { const inner = (node as HTMLIFrameElement).contentDocument; if (inner) videos.push(...collect(inner)); } catch { /* Cross-origin player: leave it alone. */ }
      }
    }
    return videos;
  }
  function parentOf(node: HTMLElement): HTMLElement | null {
    return node.parentElement || (node.getRootNode() as ShadowRoot).host as HTMLElement || node.ownerDocument.defaultView?.frameElement as HTMLElement || null;
  }
  function visible(video: HTMLVideoElement) {
    const rect = video.getBoundingClientRect();
    if (rect.width < 40 || rect.height < 30 || video.paused || video.ended || video.readyState < 2) return false;
    for (let node: HTMLElement | null = video; node; node = parentOf(node)) {
      const css = getComputedStyle(node);
      if (css.display === 'none' || css.visibility === 'hidden' || Number(css.opacity) === 0) return false;
    }
    return true;
  }
  const video = collect(document).filter(visible).sort((a,b) => {
    const ar=a.getBoundingClientRect(),br=b.getBoundingClientRect();return br.width*br.height-ar.width*ar.height;
  })[0];
  if (!video) return { applied: false, reason: 'Start playback first, then choose Clean player view. Embedded players on other origins may need the provider’s theater mode.' };
  const saved = new Map<HTMLElement, Map<string, [string,string]>>();
  const originalControls = video.controls;
  function style(node: HTMLElement, values: Record<string,string>) {
    if (!saved.has(node)) saved.set(node,new Map());
    for (const [property,value] of Object.entries(values)) {
      if (!saved.get(node)!.has(property)) saved.get(node)!.set(property,[node.style.getPropertyValue(property),node.style.getPropertyPriority(property)]);
      node.style.setProperty(property,value,'important');
    }
  }
  for (let node=parentOf(video);node;node=parentOf(node)) {
    style(node,{transform:'none',filter:'none',perspective:'none',contain:'none','will-change':'auto',overflow:'visible',position:'static',isolation:'auto','z-index':'auto','clip-path':'none'});
    if (node.tagName === 'IFRAME') style(node,{position:'fixed',top:'0',left:'0',width:'100vw',height:'100vh',border:'0','z-index':'2147483645'});
  }
  style(document.documentElement,{overflow:'hidden',background:'#000'});
  if (document.body) style(document.body,{overflow:'hidden',background:'#000',margin:'0'});
  style(video,{position:'fixed',top:'0',left:'0',width:'100vw',height:'100vh','max-width':'none','max-height':'none',margin:'0',transform:'none','z-index':'2147483646',background:'#000','object-fit':fit==='cover'?'cover':'contain'});
  video.controls=false;
  const exit=document.createElement('button');
  exit.type='button';exit.textContent='Restore page controls';exit.setAttribute('aria-label','Exit GameDeck clean player view');
  exit.style.cssText='position:fixed!important;top:8px!important;right:8px!important;z-index:2147483647!important;background:#111d30ed!important;color:#c6dbff!important;border:1px solid #81a9ee!important;border-radius:5px!important;padding:7px 10px!important;font:11px "Segoe UI",sans-serif!important;cursor:pointer!important';
  (document.body||document.documentElement).append(exit);
  let observer: MutationObserver;
  const escape=(event: KeyboardEvent)=>{if(event.key==='Escape')restore();};
  function restore() {
    observer?.disconnect();
    for (const [node,properties] of saved) for (const [property,[value,priority]] of properties) {
      if(value)node.style.setProperty(property,value,priority);else node.style.removeProperty(property);
    }
    video.controls=originalControls;exit.remove();
    for (const event of ['pause','ended','emptied','error'])video.removeEventListener(event,restore);
    window.removeEventListener('pagehide',restore);window.removeEventListener('keydown',escape,true);
    delete page.__gamedeckPlayerViewV1;
  }
  for (const event of ['pause','ended','emptied','error'])video.addEventListener(event,restore);
  window.addEventListener('pagehide',restore,{once:true});window.addEventListener('keydown',escape,true);
  exit.addEventListener('click',event=>{event.stopPropagation();restore();});
  observer=new MutationObserver(()=>{if(!video.isConnected||[...saved.keys()].some(node=>node.tagName==='IFRAME'&&!node.isConnected))restore();});
  observer.observe(document.documentElement,{childList:true,subtree:true});
  const videoRoot=video.getRootNode();if(videoRoot!==document)observer.observe(videoRoot,{childList:true,subtree:true});
  page.__gamedeckPlayerViewV1={video,restore,setFit(value){style(video,{'object-fit':value==='cover'?'cover':'contain'});}};
  return {applied:true};
}
