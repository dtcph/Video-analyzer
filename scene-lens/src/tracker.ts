import type { Det } from "./detector";

interface Track { id: number; name: string; votes: Map<string, number>; box: Det; hits: number; missed: number; counted: string | null }

const iou = (a: Det, b: Det): number => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  const i = w * h;
  return i / (a.w * a.h + b.w * b.h - i);
};

/**
 * Small greedy IoU tracker: an object counts once it was seen in 3 frames.
 * With `vote` (the app default) a box may continue a track of another class when it overlaps strongly
 * (IoU > CROSS_IOU, same class still preferred); the track's class is the score-weighted majority of everything
 * it was detected as, and its count follows that majority. Without `vote` only boxes of the same class are joined.
 */
export class Tracker {
  static readonly CROSS_IOU = 0.6;
  private tracks: Track[] = [];
  private nextId = 1;
  readonly totals = new Map<string, number>();
  private readonly vote: boolean;
  constructor(vote = true) { this.vote = vote; }

  /** Updates the tracks; returns the smoothed class of every detection that joined or started a track. */
  update(dets: Det[]): Map<Det, string> {
    const free = new Set(dets);
    const pairs: [number, Track, Det][] = [];
    for (const t of this.tracks) for (const d of dets) {
      const same = d.name === t.name, v = iou(t.box, d);
      if (same ? v > 0.3 : this.vote && v > Tracker.CROSS_IOU) pairs.push([v + (same ? 1 : 0), t, d]);
    }
    pairs.sort((a, b) => b[0] - a[0]);
    const seen = new Set<Track>(), label = new Map<Det, string>();
    for (const [, t, d] of pairs) {
      if (seen.has(t) || !free.has(d)) continue;
      seen.add(t); free.delete(d);
      t.box = d; t.hits++; t.missed = 0;
      t.votes.set(d.name, (t.votes.get(d.name) ?? 0) + d.score);
      if (this.vote) t.name = [...t.votes].sort((a, b) => b[1] - a[1])[0][0];
      if (!t.counted && t.hits >= 3) { t.counted = t.name; this.add(t.name, 1); }
      else if (t.counted && t.counted !== t.name) { this.add(t.counted, -1); this.add(t.name, 1); t.counted = t.name; }
      label.set(d, t.name);
    }
    for (const t of this.tracks) if (!seen.has(t)) t.missed++;
    this.tracks = this.tracks.filter((t) => t.missed <= 45);
    for (const d of free) {
      this.tracks.push({ id: this.nextId++, name: d.name, votes: new Map([[d.name, d.score]]), box: d, hits: 1, missed: 0, counted: null });
      label.set(d, d.name);
    }
    return label;
  }

  private add(name: string, n: number): void {
    const v = (this.totals.get(name) ?? 0) + n;
    if (v > 0) this.totals.set(name, v); else this.totals.delete(name);
  }

  reset(clearTotals = true): void { this.tracks = []; if (clearTotals) this.totals.clear(); }
}
