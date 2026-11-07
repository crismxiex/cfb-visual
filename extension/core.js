export const initialState = () => ({ games: [], listeningId: null, mainId: null, followFocus: true, layouts: {}, wallDisplayId: null, wallLayout: 'main', wallArranged: false, fullscreenId: null, sourceTabId: null, layoutWarning: '', tightWindows: true, playerFit: 'contain', playerViewReport: '' });

export function tileBounds(area, count, layout = 'grid', gap = 8) {
  if (!Number.isInteger(count) || count < 1 || count > 9) throw new Error('Choose between 1 and 9 games per monitor.');
  if (!area || area.width < 320 || area.height < 240) throw new Error('This monitor has no usable workspace.');
  gap = Math.max(0, Math.min(16, Number(gap) || 0));
  const rect = (x, y, w, h) => ({ left: Math.round(area.left + x), top: Math.round(area.top + y), width: Math.round(w), height: Math.round(h) });
  if (layout === 'focus' && count > 1) {
    const remaining = count - 1;
    const columns = remaining <= 3 ? remaining : remaining <= 6 ? 3 : 4;
    const rows = Math.ceil(remaining / columns);
    const mainHeight = (area.height - gap) / 2;
    const width = (area.width - gap * (columns - 1)) / columns;
    const height = (area.height - mainHeight - gap * rows) / rows;
    if (width < 280 || height < 180) throw new Error('These games do not fit in the main-game layout. Try Equal grid or use a larger monitor.');
    return [rect(0, 0, area.width, mainHeight), ...Array.from({ length: remaining }, (_, i) => rect((i % columns) * (width + gap), mainHeight + gap + Math.floor(i / columns) * (height + gap), width, height))];
  }
  const cols = count === 1 ? 1 : count <= 4 ? 2 : 3;
  const rows = Math.ceil(count / cols);
  const w = (area.width - gap * (cols - 1)) / cols;
  const h = (area.height - gap * (rows - 1)) / rows;
  if (w < 280 || h < 180) throw new Error('Too many games for this monitor. Move some to your other screen.');
  return Array.from({ length: count }, (_, i) => rect((i % cols) * (w + gap), Math.floor(i / cols) * (h + gap), w, h));
}

export function popupBounds(bounds, inset = 0) {
  const border = Math.max(0, Math.min(16, Math.round(Number(inset) || 0)));
  return { ...bounds, left: bounds.left - border, width: bounds.width + border * 2, height: bounds.height + border };
}

export function supportedPlayerOrigin(url) {
  try { const parsed = new URL(url); return parsed.protocol === 'https:' && ['Disney+', 'DAZN'].includes(provider(url)) ? `${parsed.origin}/*` : null; }
  catch { return null; }
}

export function hostname(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

export function provider(url) {
  const host = hostname(url);
  return /(^|\.)disneyplus\.com$/.test(host) ? 'Disney+' : /(^|\.)dazn\.com$/.test(host) ? 'DAZN' : host;
}
