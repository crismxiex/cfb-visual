import type { LayoutId, Rect } from './model';
export const layouts: { id: LayoutId; name: string; capacity: number; description: string }[] = [
  { id: 'single', name: 'Single game', capacity: 1, description: 'One game. All the space.' },
  { id: 'two-equal', name: 'Side by side', capacity: 2, description: 'Two equal windows' },
  { id: 'two-main', name: 'Main + secondary', capacity: 2, description: '70 / 30 split' },
  { id: 'three-main', name: 'Main + two', capacity: 3, description: 'A front-row seat, twice over' },
  { id: 'three-horizontal', name: 'One above two', capacity: 3, description: 'Main game across the top' },
  { id: 'four-grid', name: 'Four-game grid', capacity: 4, description: 'Every game, equal billing' },
  { id: 'four-main', name: 'Main + three', capacity: 4, description: 'One big game. Three on the side.' },
  { id: 'six-grid', name: 'Six-game grid', capacity: 6, description: 'The full game-day lineup' },
  { id: 'custom', name: 'Custom grid', capacity: 9, description: 'Choose your rows and columns' },
];
export function calculateLayout(area: Rect, id: LayoutId, gap = 8, custom = { columns: 2, rows: 2 }): Rect[] {
  if (![area.left,area.top,area.width,area.height,gap].every(Number.isFinite) || area.width < 320 || area.height < 240) throw new Error('The selected monitor has no usable work area.');
  gap = Math.round(Math.max(0, Math.min(32, gap)));
  const x = Math.round(area.left), y = Math.round(area.top), w = Math.floor(area.width), h = Math.floor(area.height);
  const rect = (l: number,t: number,width: number,height: number): Rect => ({ left: x+l,top:y+t,width,height });
  const grid = (columns: number, rows: number, left=0, top=0, width=w, height=h) => {
    if (![columns,rows].every(n => Number.isInteger(n) && n >= 1 && n <= 3)) throw new Error('Custom grids support 1–3 rows and columns.');
    const cw = (width-gap*(columns-1))/columns, ch = (height-gap*(rows-1))/rows;
    return Array.from({ length: columns*rows },(_,i) => { const c=i%columns, r=Math.floor(i/columns); const l=Math.round(c*(cw+gap)), t=Math.round(r*(ch+gap)); return rect(left+l,top+t,Math.round((c+1)*cw+c*gap)-l,Math.round((r+1)*ch+r*gap)-t); });
  };
  let result: Rect[];
  if (id === 'single') result=[rect(0,0,w,h)];
  else if (id === 'two-equal') result=grid(2,1);
  else if (['two-main','three-main','four-main'].includes(id)) {
    const main=Math.round((w-gap)*(id === 'two-main' ? .7 : .65));
    result=[rect(0,0,main,h),...grid(1,id === 'two-main' ? 1 : id === 'three-main' ? 2 : 3,main+gap,0,w-main-gap,h)];
  } else if (id === 'three-horizontal') {
    const main=Math.round((h-gap)*.6); result=[rect(0,0,w,main),...grid(2,1,0,main+gap,w,h-main-gap)];
  } else if (id === 'four-grid') result=grid(2,2);
  else if (id === 'six-grid') result=w>=h ? grid(3,2) : grid(2,3);
  else if (id === 'custom') result=grid(custom.columns,custom.rows);
  else throw new Error('Unknown layout preset.');
  if (result.some(r=>r.width<240 || r.height<160)) throw new Error('This layout makes windows too small. Choose a larger monitor or fewer slots. Chrome may enforce additional minimum sizes.');
  return result;
}
