/**
 * Object detector: D-FINE-M (Objects365 → COCO, Apache-2.0) in ONNX Runtime Web, WebGPU with WASM fallback.
 * Model file: weights stored as float16, computed in float32 (eval/02-objektmodell.md explains why and how
 * every constant below was chosen; each one is backed by a measurement there).
 */
import type * as Ort from "onnxruntime-web/jspi";
import { COCO80 } from "./coco";
import { createSession, getOrt, type OrtModule, exclusive } from "./ort";

export interface Det { name: string; score: number; x: number; y: number; w: number; h: number }
export type Mode = "IMAGE" | "VIDEO";

export const MODEL_URL = `${import.meta.env.BASE_URL}models/dfine_m_obj2coco.wf16.onnx`;
const SIZE = 640;

/** Per-class minimum scores on top of the user threshold (teddy bear: true ones score >= 0.93, false ones <= 0.67). */
export const CLASS_MIN: Partial<Record<string, number>> = { "teddy bear": 0.8 };
/** Adaptive second pass: when a box (score >= 0.3) covers >= ADAPTIVE_AREA of the frame, the frame is re-run with a
 *  gray margin of BORDER × size on each side, and that result is used (objects filling the frame were misread). */
export const ADAPTIVE_AREA = 0.6;
export const BORDER = 0.25;
/** Per-stage timing of the last frame (ms), read by eval/04-runtime.md measurements. */
export const stats = { pre: 0, run: 0, post: 0, passes: 0 };
const FLOOR = 0.05; // nothing below this is ever returned (eval uses it to see the raw distribution)

let ort: OrtModule | undefined;
let session: Ort.InferenceSession | undefined;
let threshold = 0.65;
const canvas = document.createElement("canvas");
canvas.width = SIZE; canvas.height = SIZE;
const cx = canvas.getContext("2d", { willReadFrequently: true })!;
const input = new Float32Array(3 * SIZE * SIZE);

/** Loads the model; returns the backend in use ("WebGPU" or "WASM"). */
export async function loadDetector(t: number): Promise<string> {
  threshold = t;
  ort = await getOrt();
  const r = await createSession(MODEL_URL, { batch_size: 1, height: SIZE, width: SIZE });
  session = r.session;
  return r.backend === "webgpu" ? "WebGPU" : "WASM";
}

export async function setThreshold(t: number): Promise<void> { threshold = t; }
/** Kept for the app's API; the ONNX model has no image/video mode. */
export async function setMode(_m: Mode): Promise<void> { /* no-op */ }

/** One model pass; every detection >= FLOOR in source pixels. `border` shrinks the frame into the input. */
async function infer(src: HTMLImageElement | HTMLVideoElement, W: number, H: number, border: number): Promise<Det[]> {
  const t0 = performance.now();
  const inner = SIZE / (1 + 2 * border), off = (SIZE - inner) / 2, sx = inner / W, sy = inner / H;
  if (border) { cx.fillStyle = "rgb(114,114,114)"; cx.fillRect(0, 0, SIZE, SIZE); }
  cx.drawImage(src, off, off, inner, inner); // stretched to a square like the model's training (RTDetrImageProcessor)
  const rgba = cx.getImageData(0, 0, SIZE, SIZE).data, n = SIZE * SIZE;
  for (let i = 0, p = 0; i < n; i++, p += 4) { input[i] = rgba[p] / 255; input[n + i] = rgba[p + 1] / 255; input[2 * n + i] = rgba[p + 2] / 255; }
  const t1 = performance.now();
  const res = await exclusive(() => session!.run({ [session!.inputNames[0]]: new ort!.Tensor("float32", input, [1, 3, SIZE, SIZE]) }));
  const t2 = performance.now();
  const L = res.logits.data as Float32Array, B = res.pred_boxes.data as Float32Array;
  const [, q, nc] = res.logits.dims as number[];
  const minLogit = Math.log(FLOOR / (1 - FLOOR));
  const out: Det[] = [];
  for (let i = 0; i < q; i++) for (let j = 0; j < nc; j++) {
    const l = L[i * nc + j];
    if (l < minLogit) continue;
    const bw = B[i * 4 + 2] * SIZE, bh = B[i * 4 + 3] * SIZE;
    out.push({ name: COCO80[j], score: 1 / (1 + Math.exp(-l)), x: (B[i * 4] * SIZE - bw / 2 - off) / sx, y: (B[i * 4 + 1] * SIZE - bh / 2 - off) / sy, w: bw / sx, h: bh / sy });
  }
  stats.pre += t1 - t0; stats.run += t2 - t1; stats.post += performance.now() - t2; stats.passes++;
  return out;
}

/** Detections of one frame, best first, filtered by the threshold and CLASS_MIN. */
export async function detect(src: HTMLImageElement | HTMLVideoElement): Promise<Det[]> {
  if (!session || !ort) return [];
  const W = src instanceof HTMLVideoElement ? src.videoWidth : src.naturalWidth;
  const H = src instanceof HTMLVideoElement ? src.videoHeight : src.naturalHeight;
  if (!W || !H) return [];
  stats.pre = stats.run = stats.post = stats.passes = 0;
  let all = await infer(src, W, H, 0);
  if (all.some((d) => d.score >= 0.3 && d.w * d.h >= ADAPTIVE_AREA * W * H)) all = await infer(src, W, H, BORDER);
  const t = Math.max(FLOOR, threshold);
  return all.filter((d) => d.score >= t && d.score >= (CLASS_MIN[d.name] ?? 0)).sort((a, b) => b.score - a.score).slice(0, 100);
}
