/**
 * Replays recorded clip detections (eval/.out/record-<clip>.json) through the app's Tracker with and without
 * class voting. Prints totals per class and how often a displayed label changed between consecutive frames
 * for boxes that continue a track (label flips).   node eval/scripts/track_sim.ts steady moving_handheld moving_car
 */
import { readFileSync } from "node:fs";
import { Tracker } from "../../src/tracker.ts";

type D = { name: string; score: number; x: number; y: number; w: number; h: number };
const rateArg = process.argv.indexOf("--rate");
const rate = rateArg > 0 ? Number(process.argv[rateArg + 1]) : 0;
const clips = process.argv.slice(2).filter((a, i, all) => a !== "--rate" && all[i - 1] !== "--rate");
for (const clip of clips) {
  let frames = JSON.parse(readFileSync(`eval/.out/record-${clip}.json`, "utf8")).frames as { t: number; dets: D[] }[];
  if (rate) { let last = -1; frames = frames.filter((f) => (f.t - last >= 1 / rate - 1e-3 ? ((last = f.t), true) : false)); } // keep at most `rate` analyses per second
  for (const vote of rate ? [true] : [false, true]) {
    const tr = new Tracker(vote);
    let flips = 0, prev: { box: D; label: string }[] = [];
    for (const f of frames) {
      const labels = tr.update(f.dets);
      const cur = f.dets.map((d) => ({ box: d, label: labels.get(d) ?? d.name }));
      for (const c of cur) {
        const p = prev.find((q) => { const a = q.box, b = c.box; const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y); return w > 0 && h > 0 && (w * h) / (a.w * a.h + b.w * b.h - w * h) > 0.6; });
        if (p && p.label !== c.label) flips++;
      }
      prev = cur;
    }
    const tot = [...tr.totals].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v} ${k}`).join(", ");
    console.log(`${clip.padEnd(16)} ${vote ? "vote   " : "no vote"} ${rate ? `${rate}/s` : "all"} (${frames.length} frames) totals: ${tot} | label flips: ${flips}`);
  }
}
