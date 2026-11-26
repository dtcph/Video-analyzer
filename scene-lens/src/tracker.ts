import type { Det } from "./detector";

interface Track { id: number; name: string; box: Det; hits: number; missed: number; counted: boolean }

const iou = (a: Det, b: Det): number => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  const i = w * h;
  return i / (a.w * a.h + b.w * b.h - i);
};

/** Small greedy IoU tracker: an object counts once it was seen in 3 frames. */
export class Tracker {
  private tracks: Track[] = [];
  private nextId = 1;
  readonly totals = new Map<string, number>();

  update(dets: Det[]): void {
    const free = new Set(dets);
    const pairs: [number, Track, Det][] = [];
    for (const t of this.tracks) for (const d of dets) if (d.name === t.name) {
      const v = iou(t.box, d);
      if (v > 0.3) pairs.push([v, t, d]);
    }
    pairs.sort((a, b) => b[0] - a[0]);
    const seen = new Set<Track>();
    for (const [, t, d] of pairs) {
      if (seen.has(t) || !free.has(d)) continue;
      seen.add(t); free.delete(d);
      t.box = d; t.hits++; t.missed = 0;
      if (!t.counted && t.hits >= 3) { t.counted = true; this.totals.set(t.name, (this.totals.get(t.name) ?? 0) + 1); }
    }
    for (const t of this.tracks) if (!seen.has(t)) t.missed++;
    this.tracks = this.tracks.filter((t) => t.missed <= 45);
    for (const d of free) this.tracks.push({ id: this.nextId++, name: d.name, box: d, hits: 1, missed: 0, counted: false });
  }

  reset(clearTotals = true): void { this.tracks = []; if (clearTotals) this.totals.clear(); }
}
