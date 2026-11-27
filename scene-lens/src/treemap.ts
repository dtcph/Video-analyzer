export interface Item { key: string; label: string; value: number }
export interface Rect extends Item { x: number; y: number; w: number; h: number }

/** Squarified treemap (Bruls et al.) in a 0..w × 0..h box. */
export function squarify(items: Item[], w: number, h: number): Rect[] {
  const list = items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
  const total = list.reduce((s, i) => s + i.value, 0);
  if (!total) return [];
  const scale = (w * h) / total;
  const out: Rect[] = [];
  let x = 0, y = 0, W = w, H = h, row: Item[] = [];
  const worst = (r: Item[], side: number): number => {
    const s = r.reduce((a, i) => a + i.value * scale, 0);
    const mx = Math.max(...r.map((i) => i.value * scale)), mn = Math.min(...r.map((i) => i.value * scale));
    return Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn));
  };
  const flush = (): void => {
    const s = row.reduce((a, i) => a + i.value * scale, 0);
    if (W >= H) { // lay out a column on the left
      const cw = s / H; let cy = y;
      for (const i of row) { const ch = (i.value * scale) / cw; out.push({ ...i, x, y: cy, w: cw, h: ch }); cy += ch; }
      x += cw; W -= cw;
    } else {
      const rh = s / W; let cx = x;
      for (const i of row) { const rw = (i.value * scale) / rh; out.push({ ...i, x: cx, y, w: rw, h: rh }); cx += rw; }
      y += rh; H -= rh;
    }
    row = [];
  };
  for (const item of list) {
    const side = Math.min(W, H);
    if (row.length && worst([...row, item], side) > worst(row, side)) flush();
    row.push(item);
  }
  if (row.length) flush();
  return out;
}

/**
 * Splits a w × h box into n parts of exactly equal area that fill it without gaps: rows of nearly square
 * parts, where a row with k parts gets the height k / n. Result in percent of the box.
 */
export function unitGrid(n: number, w: number, h: number): { x: number; y: number; w: number; h: number }[] {
  const rows = Math.min(n, Math.max(1, Math.round(Math.sqrt((n * h) / Math.max(1, w)))));
  const out: { x: number; y: number; w: number; h: number }[] = [];
  let y = 0;
  for (let r = 0; r < rows; r++) {
    const k = Math.floor(n / rows) + (r < n % rows ? 1 : 0), height = (k / n) * 100;
    for (let i = 0; i < k; i++) out.push({ x: (i / k) * 100, y, w: 100 / k, h: height });
    y += height;
  }
  return out;
}
