import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import type { Det } from "./detector";

/** Emotion estimate from face blendshapes. No identification, nothing is stored. */
export type Emotion = "happy" | "neutral" | "surprised" | "sad" | "angry" | "thoughtful";
export const EMOTIONS: Record<Emotion, string> = {
  happy: "Happy", neutral: "Neutral", thoughtful: "Thoughtful", surprised: "Surprised", sad: "Sad", angry: "Angry",
};
export const NO_FACE = "No visible face";

type Shapes = Record<string, number>;
const avg = (s: Shapes, a: string, b: string): number => ((s[a] ?? 0) + (s[b] ?? 0)) / 2;

/** Rule-based mapping, thresholds are hand-tuned estimates (not a trained emotion model). */
export function classify(s: Shapes): Emotion {
  const smile = avg(s, "mouthSmileLeft", "mouthSmileRight");
  const frown = avg(s, "mouthFrownLeft", "mouthFrownRight");
  const browDown = avg(s, "browDownLeft", "browDownRight");
  const browUp = Math.max(s.browInnerUp ?? 0, avg(s, "browOuterUpLeft", "browOuterUpRight"));
  const jaw = s.jawOpen ?? 0, wide = avg(s, "eyeWideLeft", "eyeWideRight");
  const press = avg(s, "mouthPressLeft", "mouthPressRight");
  const lookDown = avg(s, "eyeLookDownLeft", "eyeLookDownRight");
  const lookSide = Math.max(avg(s, "eyeLookOutLeft", "eyeLookInRight"), avg(s, "eyeLookInLeft", "eyeLookOutRight"));
  const pucker = Math.max(s.mouthPucker ?? 0, s.mouthShrugLower ?? 0, s.mouthRollLower ?? 0);
  if (smile > 0.45) return "happy";
  if ((jaw > 0.3 && (wide > 0.25 || browUp > 0.4)) || (browUp > 0.6 && wide > 0.3)) return "surprised";
  if (browDown > 0.45 && (frown > 0.1 || press > 0.2)) return "angry";
  if (frown > 0.25 || (s.browInnerUp ?? 0) > 0.45) return "sad";
  if (smile < 0.15 && (lookDown > 0.35 || lookSide > 0.4 || (browDown > 0.25 && (press > 0.1 || pucker > 0.2)) || pucker > 0.35)) return "thoughtful";
  return "neutral";
}

let landmarker: FaceLandmarker | undefined;
let loading: Promise<void> | undefined;

export function loadFaces(): Promise<void> {
  loading ??= (async () => {
    const fileset = await FilesetResolver.forVisionTasks(`${import.meta.env.BASE_URL}wasm`);
    const make = (delegate: "GPU" | "CPU"): Promise<FaceLandmarker> => FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: `${import.meta.env.BASE_URL}models/face_landmarker.task`, delegate },
      runningMode: "IMAGE", numFaces: 1, outputFaceBlendshapes: true,
      minFaceDetectionConfidence: 0.3, minFacePresenceConfidence: 0.3,
    });
    landmarker = await make("GPU").catch(() => make("CPU"));
  })().catch((e) => { loading = undefined; throw e; });
  return loading;
}

interface Entry { box: Det; hist: (Emotion | null)[]; }
let entries: Entry[] = [];
let lastRun = 0;
const crop = document.createElement("canvas");
const cx = crop.getContext("2d", { willReadFrequently: true })!;

const iou = (a: Det, b: Det): number => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / (a.w * a.h + b.w * b.h - w * h);
};

function analyse(src: CanvasImageSource, p: Det): Emotion | null {
  // Standing people: only the head region; otherwise the whole box.
  const hh = p.h > p.w * 1.4 ? p.h * 0.4 : p.h;
  const pad = p.w * 0.1;
  const sx = Math.max(0, p.x - pad), sy = Math.max(0, p.y - pad), sw = p.w + 2 * pad, sh = hh + pad;
  const scale = Math.max(1, 224 / Math.min(sw, sh));
  crop.width = Math.round(sw * scale); crop.height = Math.round(sh * scale);
  cx.drawImage(src, sx, sy, sw, sh, 0, 0, crop.width, crop.height);
  const r = landmarker!.detect(crop);
  const cats = r.faceBlendshapes[0]?.categories;
  if (!cats) return null;
  return classify(Object.fromEntries(cats.map((c) => [c.categoryName, c.score])));
}

/** Majority of the last 5 results per person; null (no face) only when nothing was seen. */
function stable(hist: (Emotion | null)[]): Emotion | null {
  const n = new Map<Emotion, number>();
  for (const e of hist) if (e) n.set(e, (n.get(e) ?? 0) + 1);
  const top = [...n].sort((a, b) => b[1] - a[1])[0];
  return top && top[1] >= 2 || (top && hist.length === 1) ? top[0] : (top?.[0] ?? null);
}

/** Runs the face stage on up to 12 persons (largest first), at most every 250 ms unless forced. */
export function refresh(src: HTMLImageElement | HTMLVideoElement, dets: Det[], force: boolean): void {
  if (!landmarker) return;
  const persons = dets.filter((d) => d.name === "person");
  const now = performance.now();
  if (!persons.length) { entries = []; return; }
  if (!force && now - lastRun < 250) return;
  lastRun = now;
  const next: Entry[] = [], used = new Set<Entry>();
  for (const p of persons.sort((a, b) => b.w * b.h - a.w * a.h).slice(0, 12)) {
    let best: Entry | undefined, bv = 0.3;
    for (const e of entries) if (!used.has(e)) { const v = iou(e.box, p); if (v > bv) { bv = v; best = e; } }
    if (best) used.add(best);
    const hist = [...(best?.hist ?? []), analyse(src, p)].slice(-5);
    next.push({ box: p, hist });
  }
  entries = next;
}

/** Emotion for each person detection of this frame (null: no readable face). */
export function annotate(dets: Det[]): Map<Det, Emotion | null> {
  const out = new Map<Det, Emotion | null>(), used = new Set<Entry>();
  for (const p of dets) {
    if (p.name !== "person") continue;
    let best: Entry | undefined, bv = 0.3;
    for (const e of entries) if (!used.has(e)) { const v = iou(e.box, p); if (v > bv) { bv = v; best = e; } }
    if (best) used.add(best);
    out.set(p, best ? stable(best.hist) : null);
  }
  return out;
}

export function clearFaces(): void { entries = []; lastRun = 0; }
