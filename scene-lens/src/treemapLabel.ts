/**
 * Chooses how a cell title is set so that it is never cut off: the largest step of the type scale
 * (tokens in style.css) that suits the box size and fits. Order: name over count (name may wrap at
 * spaces), then one line, then one line turned by 90°. Returns null if not even the smallest step fits.
 */
export interface Fit { size: number; line: number; pad: number; lines: string[]; count: string | null; vertical: boolean }

const STEPS = ["3xl", "2xl", "xl", "l", "m", "s", "xs"];
const ctx = document.createElement("canvas").getContext("2d")!;

const token = (name: string): number => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));

function width(text: string, size: number): number {
  ctx.font = `800 ${size}px ${getComputedStyle(document.body).fontFamily}`;
  return ctx.measureText(text).width;
}

/** Greedy wrap at spaces; null if a single word is wider than the line. */
function wrap(text: string, size: number, max: number): string[] | null {
  const lines: string[] = [];
  for (const word of text.split(" ")) {
    if (width(word, size) > max) return null;
    const joined = lines.length ? `${lines[lines.length - 1]} ${word}` : word;
    if (lines.length && width(joined, size) <= max) lines[lines.length - 1] = joined;
    else lines.push(word);
  }
  return lines;
}

export function fitLabel(name: string, count: number, w: number, h: number): Fit | null {
  const all = STEPS.map((s) => ({ size: token(`--fs-${s}`), line: token(`--lh-${s}`) }));
  const target = Math.sqrt(w * h) * 0.14; // bigger box, bigger type
  const smallest = all[all.length - 1];
  const steps = all.filter((s) => s.size <= target || s === smallest);
  const padOf = (size: number): number => token(size >= 20 ? "--s-2" : size >= 16 ? "--s-1" : "--s-half");
  const one = `${name} ${count}`;
  for (const { size, line } of steps) {
    const pad = padOf(size), aw = w - 2 * pad, ah = h - 2 * pad;
    const lines = wrap(name, size, aw);
    if (lines && (lines.length + 1) * line <= ah && width(String(count), size) <= aw) return { size, line, pad, lines, count: String(count), vertical: false };
    if (width(one, size) <= aw && line <= ah) return { size, line, pad, lines: [one], count: null, vertical: false };
  }
  for (const { size, line } of steps) {
    const pad = padOf(size);
    if (width(one, size) <= h - 2 * pad && line <= w - 2 * pad) return { size, line, pad, lines: [one], count: null, vertical: true };
  }
  return null;
}
