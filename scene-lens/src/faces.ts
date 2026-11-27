/**
 * Face & emotion stage (eval/03-emotionen.md):
 * person box → head crop (fallback: whole box) → MediaPipe Face Landmarker → alignment on the eye line → tight square
 * face crop → HSEmotion EfficientNet-B0 (AffectNet, 8 classes, Apache-2.0) → probabilities, averaged over the last
 * results of the same person → class. No identification, nothing is stored.
 */
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import type * as Ort from "onnxruntime-web/jspi";
import type { Det } from "./detector";
import { createSession, exclusive, getOrt } from "./ort";

/** Model output order (hsemotion_onnx idx_to_class for 8-class models). */
export const EMOTIONS = ["angry", "contempt", "disgusted", "afraid", "happy", "neutral", "sad", "surprised"] as const;
export type Emotion = (typeof EMOTIONS)[number] | "uncertain";

export let EMOTION_MODEL_URL = `${import.meta.env.BASE_URL}models/enet_b0_8_va_mtl.wf16.onnx`;
let INPUT = 224;
/** Square face crop = landmark extent × (1 + 2 × FACE_MARGIN). */
export let FACE_MARGIN = 0.1;
/** Eval knobs (margin, alignment); the app never calls this. */
export let ALIGN = true;
export function setFaceOptions(margin: number, align: boolean, model?: string, size?: number): void {
  FACE_MARGIN = margin; ALIGN = align;
  if (model) { EMOTION_MODEL_URL = model; INPUT = size ?? 224; face.width = INPUT; face.height = INPUT; input = new Float32Array(3 * INPUT * INPUT); }
}
/** Below this top probability the result is "uncertain" (0 = always the top class). */
export const MIN_PROB = 0.4;
/** Results averaged per person. */
const HISTORY = 5;

let landmarker: FaceLandmarker | undefined;
let session: Ort.InferenceSession | undefined;
let loading: Promise<void> | undefined;

export function loadFaces(): Promise<void> {
  loading ??= (async () => {
    const fileset = await FilesetResolver.forVisionTasks(`${import.meta.env.BASE_URL}wasm`);
    const make = (delegate: "GPU" | "CPU"): Promise<FaceLandmarker> => FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: `${import.meta.env.BASE_URL}models/face_landmarker.task`, delegate },
      runningMode: "IMAGE", numFaces: 1, minFaceDetectionConfidence: 0.3, minFacePresenceConfidence: 0.3,
    });
    landmarker = await make("GPU").catch(() => make("CPU"));
    session = (await createSession(EMOTION_MODEL_URL, { batch_size: 1 })).session;
  })().catch((e) => { loading = undefined; throw e; });
  return loading;
}

const crop = document.createElement("canvas");
const cc = crop.getContext("2d", { willReadFrequently: true })!;
const face = document.createElement("canvas");
face.width = INPUT; face.height = INPUT;
const fc = face.getContext("2d", { willReadFrequently: true })!;
let input = new Float32Array(3 * INPUT * INPUT);

/** Draws a region of the source, upscaled so its short side is >= 224 px, into `crop`. */
function drawRegion(src: HTMLImageElement | HTMLVideoElement, sx: number, sy: number, sw: number, sh: number, clamp = false): boolean {
  // A padded box of a close-up reaches past the frame. Unclamped, that part stays black (helps the face detector on
  // faces that fill the frame); clamped, the crop ends at the frame edge. analyse() tries both (eval/03-emotionen.md).
  if (clamp) {
    const W = src instanceof HTMLVideoElement ? src.videoWidth : src.naturalWidth, H = src instanceof HTMLVideoElement ? src.videoHeight : src.naturalHeight;
    const x0 = Math.max(0, sx), y0 = Math.max(0, sy), x1 = Math.min(W, sx + sw), y1 = Math.min(H, sy + sh);
    sx = x0; sy = y0; sw = x1 - x0; sh = y1 - y0;
  }
  if (!(sw >= 8 && sh >= 8)) return false; // nothing usable left of the region (box at the frame edge)
  cc.clearRect(0, 0, crop.width, crop.height);
  // short side up to 224 px, but the long side never above 2048 px (thin, tall boxes would become huge canvases)
  const scale = Math.min(Math.max(1, INPUT / Math.min(sw, sh)), Math.max(1, 2048 / Math.max(sw, sh)));
  crop.width = Math.round(sw * scale); crop.height = Math.round(sh * scale);
  cc.drawImage(src, sx, sy, sw, sh, 0, 0, crop.width, crop.height);
  return true;
}

/** Landmarks of the face in `crop` (pixels), or undefined. */
function findFace(): { x: number; y: number }[] | undefined {
  const lm = landmarker!.detect(crop).faceLandmarks[0];
  return lm?.map((p) => ({ x: p.x * crop.width, y: p.y * crop.height }));
}

/** Rotates the face upright (eye line horizontal) into the 224 × 224 input; returns the class probabilities. */
async function classifyFace(pts: { x: number; y: number }[]): Promise<Float32Array> {
  const l = pts[33], r = pts[263]; // outer eye corners (MediaPipe face mesh indices)
  const angle = ALIGN ? Math.atan2(r.y - l.y, r.x - l.x) : 0;
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length, cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  // extent of the landmarks in the rotated frame
  const cos = Math.cos(-angle), sin = Math.sin(-angle);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of pts) {
    const x = (p.x - cx) * cos - (p.y - cy) * sin, y = (p.x - cx) * sin + (p.y - cy) * cos;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const side = Math.max(maxX - minX, maxY - minY) * (1 + 2 * FACE_MARGIN);
  const mx = (minX + maxX) / 2, my = (minY + maxY) / 2;
  fc.setTransform(1, 0, 0, 1, 0, 0); fc.fillStyle = "#000"; fc.fillRect(0, 0, INPUT, INPUT);
  const k = INPUT / side;
  fc.setTransform(k, 0, 0, k, INPUT / 2, INPUT / 2);
  fc.translate(-mx, -my); fc.rotate(-angle); fc.translate(-cx, -cy);
  fc.drawImage(crop, 0, 0);
  fc.setTransform(1, 0, 0, 1, 0, 0);
  const d = fc.getImageData(0, 0, INPUT, INPUT).data, n = INPUT * INPUT;
  const mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
  for (let i = 0, p = 0; i < n; i++, p += 4) for (let c = 0; c < 3; c++) input[c * n + i] = (d[p + c] / 255 - mean[c]) / std[c];
  const ort = await getOrt();
  const out = (await exclusive(() => session!.run({ [session!.inputNames[0]]: new ort.Tensor("float32", input, [1, 3, INPUT, INPUT]) })))[session!.outputNames[0]];
  const logits = out.data as Float32Array, m = Math.max(...logits);
  const e = logits.slice(0, EMOTIONS.length).map((v) => Math.exp(v - m)), sum = e.reduce((s, v) => s + v, 0);
  return e.map((v) => v / sum);
}

/** Probabilities for one person box, or null when no face is readable. */
async function analyse(src: HTMLImageElement | HTMLVideoElement, p: Det): Promise<Float32Array | null> {
  // Standing people: head region first; when no face is found there, the whole box (close-ups, seated people).
  const pad = p.w * 0.1;
  const regions: [number, number, number, number][] = [];
  if (p.h > p.w * 1.4) regions.push([p.x - pad, p.y - pad, p.w + 2 * pad, p.h * 0.4 + pad]);
  regions.push([p.x - pad, p.y - pad, p.w + 2 * pad, p.h + 2 * pad]);
  for (const clamp of [false, true]) for (const [sx, sy, sw, sh] of regions) {
    if (!drawRegion(src, sx, sy, sw, sh, clamp)) continue;
    const pts = findFace();
    if (pts) return classifyFace(pts);
  }
  return null;
}

/** Class of averaged probabilities (MIN_PROB → "uncertain"). */
export function decide(probs: Float32Array): { emotion: Emotion; p: number } {
  let k = 0;
  for (let i = 1; i < probs.length; i++) if (probs[i] > probs[k]) k = i;
  return { emotion: probs[k] < MIN_PROB ? "uncertain" : EMOTIONS[k], p: probs[k] };
}

interface Entry { box: Det; hist: (Float32Array | null)[] }
let entries: Entry[] = [];
let lastRun = 0, busy = false;

const iou = (a: Det, b: Det): number => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / (a.w * a.h + b.w * b.h - w * h);
};

/** Average of the person's recent probabilities; null when no face was ever read. */
function stable(hist: (Float32Array | null)[]): { emotion: Emotion; p: number; probs: Float32Array } | null {
  const seen = hist.filter((h): h is Float32Array => !!h);
  if (!seen.length) return null;
  const avg = new Float32Array(EMOTIONS.length);
  for (const h of seen) for (let i = 0; i < avg.length; i++) avg[i] += h[i] / seen.length;
  return { ...decide(avg), probs: avg };
}

/** Runs the face stage on up to 12 persons (largest first), at most every 250 ms unless forced. */
export async function refresh(src: HTMLImageElement | HTMLVideoElement, dets: Det[], force: boolean): Promise<void> {
  if (!landmarker || !session || busy) return;
  const persons = dets.filter((d) => d.name === "person");
  const now = performance.now();
  if (!persons.length) { entries = []; return; }
  if (!force && now - lastRun < 250) return;
  lastRun = now; busy = true;
  try {
    const next: Entry[] = [], used = new Set<Entry>();
    for (const p of persons.sort((a, b) => b.w * b.h - a.w * a.h).slice(0, 12)) {
      let best: Entry | undefined, bv = 0.3;
      for (const e of entries) if (!used.has(e)) { const v = iou(e.box, p); if (v > bv) { bv = v; best = e; } }
      if (best) used.add(best);
      next.push({ box: p, hist: [...(best?.hist ?? []), await analyse(src, p)].slice(-HISTORY) });
    }
    entries = next;
  } finally { busy = false; }
}

/** Emotion for each person detection of this frame (null: no readable face). */
export function annotate(dets: Det[]): Map<Det, Emotion | null> {
  return new Map([...annotateFull(dets)].map(([d, r]) => [d, r ? r.emotion : null]));
}

/** Like annotate, with the averaged probabilities (eval uses them). */
export function annotateFull(dets: Det[]): Map<Det, ReturnType<typeof stable>> {
  const out = new Map<Det, ReturnType<typeof stable>>(), used = new Set<Entry>();
  for (const p of dets) {
    if (p.name !== "person") continue;
    let best: Entry | undefined, bv = 0.3;
    for (const e of entries) if (!used.has(e)) { const v = iou(e.box, p); if (v > bv) { bv = v; best = e; } }
    if (best) used.add(best);
    out.set(p, best ? stable(best.hist) : null);
  }
  return out;
}

/** Classifier on the whole image as the face, without landmarks or alignment; eval only. */
export async function classifyWhole(src: HTMLImageElement): Promise<Float32Array> {
  crop.width = src.naturalWidth; crop.height = src.naturalHeight; cc.drawImage(src, 0, 0);
  const w = crop.width, h = crop.height;
  return classifyFace(Array.from({ length: 478 }, (_, i) => (i === 33 ? { x: 0, y: h / 2 } : i === 263 ? { x: w, y: h / 2 } : i % 2 ? { x: 0, y: 0 } : { x: w, y: h })));
}

/** Stage on a ready face crop (whole image = face); eval only. */
export async function classifyImage(src: HTMLImageElement): Promise<Float32Array | null> {
  if (!drawRegion(src, 0, 0, src.naturalWidth, src.naturalHeight)) return null;
  const pts = findFace();
  return pts ? classifyFace(pts) : null;
}

export function clearFaces(): void { entries = []; lastRun = 0; }
