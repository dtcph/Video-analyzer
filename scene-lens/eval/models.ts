/**
 * Candidate-model runner (dev only, /eval-models.html). One interface for YOLO (Ultralytics ONNX), DETR-style
 * (D-FINE / RF-DETR ONNX from onnx-community) and MediaPipe TFLite detectors, so they run through the same
 * scoring as the app. Returns every detection >= 0.05 as [name, score, x, y, w, h] in source pixels.
 */
import { FilesetResolver, ObjectDetector } from "@mediapipe/tasks-vision";
import * as ort from "onnxruntime-web/webgpu";
import asyncifyWasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url";

ort.env.wasm.wasmPaths = { wasm: new URL(asyncifyWasmUrl, location.href).href };
ort.env.logLevel = "error";

type Raw = [string, number, number, number, number, number];
export interface Cand { kind: "yolo" | "detr" | "mediapipe"; url: string; size?: number; normalize?: boolean; labels?: Record<string, string>; ep?: "webgpu" | "wasm"; delegate?: "GPU" | "CPU"; border?: number }

/** HF / COCO-91 name variants → the 80 COCO names the app uses. */
const ALIAS: Record<string, string> = { motorbike: "motorcycle", aeroplane: "airplane", sofa: "couch", tvmonitor: "tv", diningtable: "dining table", pottedplant: "potted plant", "hair dryer": "hair drier", "cellphone": "cell phone" };
const canon = (n: string): string => ALIAS[n] ?? n;

const COCO80 = ["person","bicycle","car","motorcycle","airplane","bus","train","truck","boat","traffic light","fire hydrant","stop sign","parking meter","bench","bird","cat","dog","horse","sheep","cow","elephant","bear","zebra","giraffe","backpack","umbrella","handbag","tie","suitcase","frisbee","skis","snowboard","sports ball","kite","baseball bat","baseball glove","skateboard","surfboard","tennis racket","bottle","wine glass","cup","fork","knife","spoon","bowl","banana","apple","sandwich","orange","broccoli","carrot","hot dog","pizza","donut","cake","chair","couch","potted plant","bed","dining table","toilet","tv","laptop","mouse","remote","keyboard","cell phone","microwave","oven","toaster","sink","refrigerator","book","clock","vase","scissors","teddy bear","hair drier","toothbrush"];

let cand: Cand | undefined;
let session: ort.InferenceSession | undefined;
let mp: ObjectDetector | undefined;
let inputIsF16 = false;
const canvas = document.createElement("canvas");
const cx = canvas.getContext("2d", { willReadFrequently: true })!;

function toTensorData(rgba: Uint8ClampedArray, n: number, normalize: boolean): Float32Array {
  const out = new Float32Array(n * 3);
  const mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
  for (let i = 0, p = 0; i < n; i++, p += 4) for (let c = 0; c < 3; c++) {
    const v = rgba[p + c] / 255;
    out[c * n + i] = normalize ? (v - mean[c]) / std[c] : v;
  }
  return out;
}
const tensor = (data: Float32Array, dims: number[]): ort.Tensor =>
  inputIsF16 ? new ort.Tensor("float16", Float16Array.from(data) as unknown as Uint16Array, dims) : new ort.Tensor("float32", data, dims);

function iou(a: Raw, b: Raw): number {
  const w = Math.min(a[2] + a[4], b[2] + b[4]) - Math.max(a[2], b[2]), h = Math.min(a[3] + a[5], b[3] + b[5]) - Math.max(a[3], b[3]);
  return w <= 0 || h <= 0 ? 0 : (w * h) / (a[4] * a[5] + b[4] * b[5] - w * h);
}
/** Greedy NMS; classAware keeps overlapping boxes of different classes. */
export function nms(ds: Raw[], thr: number, classAware: boolean, max = 300): Raw[] {
  const out: Raw[] = [];
  for (const d of [...ds].sort((a, b) => b[1] - a[1])) {
    if (out.every((o) => (classAware && o[0] !== d[0]) || iou(o, d) <= thr)) out.push(d);
    if (out.length >= max) break;
  }
  return out;
}

export async function load(c: Cand): Promise<{ ms: number; info: string }> {
  const t0 = performance.now();
  cand = c; session = undefined; mp?.close(); mp = undefined;
  if (c.kind === "mediapipe") {
    const fs = await FilesetResolver.forVisionTasks(`${import.meta.env.BASE_URL}wasm`);
    mp = await ObjectDetector.createFromOptions(fs, { baseOptions: { modelAssetPath: c.url, delegate: c.delegate ?? "GPU" }, runningMode: "IMAGE", scoreThreshold: 0.05, maxResults: 100 });
    return { ms: performance.now() - t0, info: `mediapipe ${c.delegate ?? "GPU"}` };
  }
  session = await ort.InferenceSession.create(c.url, { executionProviders: [c.ep ?? "webgpu"], graphOptimizationLevel: "all" });
  const meta = (session as unknown as { inputMetadata?: { type?: string }[] }).inputMetadata?.[0];
  inputIsF16 = meta?.type === "float16";
  return { ms: performance.now() - t0, info: `${c.ep ?? "webgpu"} in:${session.inputNames.join(",")}:${meta?.type ?? "?"} out:${session.outputNames.join(",")}` };
}

export async function detect(src: HTMLImageElement | HTMLVideoElement): Promise<Raw[]> {
  const c = cand!;
  const W = src instanceof HTMLVideoElement ? src.videoWidth : src.naturalWidth, H = src instanceof HTMLVideoElement ? src.videoHeight : src.naturalHeight;
  if (c.kind === "mediapipe") {
    return mp!.detect(src as HTMLImageElement).detections.flatMap((d) => {
      const k = d.categories[0], b = d.boundingBox; return k && b ? [[canon(k.categoryName), k.score, b.originX, b.originY, b.width, b.height] as Raw] : [];
    });
  }
  const S = c.size ?? 640;
  canvas.width = S; canvas.height = S;
  let scale = 1, ox = 0, oy = 0;
  if (c.kind === "yolo") { // letterbox, gray 114, like Ultralytics
    scale = Math.min(S / W, S / H); const dw = Math.round(W * scale), dh = Math.round(H * scale);
    ox = Math.floor((S - dw) / 2); oy = Math.floor((S - dh) / 2);
    cx.fillStyle = "rgb(114,114,114)"; cx.fillRect(0, 0, S, S); cx.drawImage(src, ox, oy, dw, dh);
  } else if (c.border) { // shrink the image into the input, gray margin of `border` × size on every side
    const f = c.border, inner = S / (1 + 2 * f); scale = inner / W; ox = S * f / (1 + 2 * f); oy = ox;
    cx.fillStyle = "rgb(114,114,114)"; cx.fillRect(0, 0, S, S); cx.drawImage(src, ox, oy, inner, inner);
  } else cx.drawImage(src, 0, 0, S, S); // plain resize (RTDetrImageProcessor, do_pad false)
  const rgba = cx.getImageData(0, 0, S, S).data;
  const feeds = { [session!.inputNames[0]]: tensor(toTensorData(rgba, S * S, !!c.normalize), [1, 3, S, S]) };
  const res = await session!.run(feeds);
  const out: Raw[] = [];
  const f32 = (t: ort.Tensor): Float32Array => (t.type === "float16" ? Float32Array.from(t.data as unknown as Float16Array) : (t.data as Float32Array));
  if (c.kind === "yolo") {
    const t = res[session!.outputNames[0]]; const d = f32(t); const [, ch, n] = t.dims as number[]; const nc = ch - 4;
    for (let i = 0; i < n; i++) {
      let best = 0, k = 0;
      for (let j = 0; j < nc; j++) { const s = d[(4 + j) * n + i]; if (s > best) { best = s; k = j; } }
      if (best < 0.05) continue;
      const bx = d[i], by = d[n + i], bw = d[2 * n + i], bh = d[3 * n + i];
      out.push([COCO80[k], best, (bx - bw / 2 - ox) / scale, (by - bh / 2 - oy) / scale, bw / scale, bh / scale]);
    }
    return nms(out, 0.7, true); // Ultralytics predict defaults: iou 0.7, class-aware
  }
  // DETR: sigmoid scores, top 300 over queries × classes, boxes cx cy w h normalised
  const logits = res.logits ?? res[session!.outputNames[0]], boxes = res.pred_boxes ?? res[session!.outputNames[1]];
  const L = f32(logits), B = f32(boxes); const [, q, nc] = logits.dims as number[];
  const cands: [number, number, number][] = [];
  for (let i = 0; i < q; i++) for (let j = 0; j < nc; j++) { const s = 1 / (1 + Math.exp(-L[i * nc + j])); if (s >= 0.05) cands.push([s, i, j]); }
  cands.sort((a, b) => b[0] - a[0]);
  for (const [s, i, j] of cands.slice(0, 300)) {
    const name = c.labels?.[String(j)]; if (!name) continue;
    let bcx = B[i * 4] * W, bcy = B[i * 4 + 1] * H, bw = B[i * 4 + 2] * W, bh = B[i * 4 + 3] * H;
    if (c.border) { // input-normalised → source pixels (x and y scale differ: the image is stretched into a square)
      const inner = S / (1 + 2 * c.border), sxx = inner / W, syy = inner / H;
      bcx = (B[i * 4] * S - ox) / sxx; bcy = (B[i * 4 + 1] * S - oy) / syy; bw = (B[i * 4 + 2] * S) / sxx; bh = (B[i * 4 + 3] * S) / syy;
    }
    out.push([canon(name), s, bcx - bw / 2, bcy - bh / 2, bw, bh]);
  }
  return out;
}

const img = document.createElement("img");
const api = {
  load,
  async detectUrl(url: string): Promise<{ ms: number; w: number; h: number; dets: Raw[] }> {
    img.src = url; await img.decode();
    const t0 = performance.now(); const dets = await detect(img);
    return { ms: performance.now() - t0, w: img.naturalWidth, h: img.naturalHeight, dets: dets.sort((a, b) => b[1] - a[1]).slice(0, 100) };
  },
  /** n timed runs on one still (after 3 warm-up runs), full pipeline incl. preprocessing and readback. */
  async speed(url: string, n: number): Promise<{ meanMs: number; p95Ms: number }> {
    img.src = url; await img.decode();
    for (let i = 0; i < 3; i++) await detect(img);
    const ts: number[] = [];
    for (let i = 0; i < n; i++) { const t0 = performance.now(); await detect(img); ts.push(performance.now() - t0); }
    ts.sort((a, b) => a - b);
    return { meanMs: +(ts.reduce((s, x) => s + x, 0) / n).toFixed(1), p95Ms: +ts[Math.floor(n * 0.95)].toFixed(1) };
  },
};
(window as unknown as { modelsApi: typeof api }).modelsApi = api;
document.title = "models ready";
