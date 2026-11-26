import { FilesetResolver, ObjectDetector } from "@mediapipe/tasks-vision";

export interface Det { name: string; score: number; x: number; y: number; w: number; h: number }
export type Mode = "IMAGE" | "VIDEO";

let detector: ObjectDetector | undefined;
let mode: Mode = "IMAGE";
let lastTs = 0;

async function create(delegate: "GPU" | "CPU", threshold: number): Promise<ObjectDetector> {
  const fileset = await FilesetResolver.forVisionTasks(`${import.meta.env.BASE_URL}wasm`);
  return ObjectDetector.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: `${import.meta.env.BASE_URL}models/efficientdet_lite2.tflite`, delegate },
    runningMode: mode, scoreThreshold: threshold, maxResults: 60,
  });
}

export async function loadDetector(threshold: number): Promise<string> {
  try { detector = await create("GPU", threshold); return "GPU"; }
  catch { detector = await create("CPU", threshold); return "CPU"; }
}

export async function setThreshold(t: number): Promise<void> { await detector?.setOptions({ scoreThreshold: t }); }

export async function setMode(m: Mode): Promise<void> {
  if (m === mode) return;
  mode = m;
  await detector?.setOptions({ runningMode: m });
}

export function detect(src: HTMLImageElement | HTMLVideoElement): Det[] {
  if (!detector) return [];
  const res = src instanceof HTMLVideoElement
    ? detector.detectForVideo(src, (lastTs = Math.max(lastTs + 1, performance.now())))
    : detector.detect(src);
  return res.detections.flatMap((d) => {
    const c = d.categories[0], b = d.boundingBox;
    return c && b ? [{ name: c.categoryName, score: c.score, x: b.originX, y: b.originY, w: b.width, h: b.height }] : [];
  });
}
