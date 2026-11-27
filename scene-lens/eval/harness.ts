/**
 * Eval harness (dev only, served by `vite` through /eval.html). It imports the real app modules, so every
 * phase measures the pipeline that ships. The puppeteer driver (eval/scripts/run.ts) calls window.evalApi.
 */
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import * as det from "../src/detector";
import * as faces from "../src/faces";
import { classify as legacyClassify } from "./legacyRule";

const img = document.getElementById("img") as HTMLImageElement;
const vid = document.getElementById("vid") as HTMLVideoElement;
const ms = (t0: number): number => Math.round((performance.now() - t0) * 10) / 10;

async function loadImage(url: string): Promise<void> {
  img.src = url;
  await img.decode();
}

let diag: FaceLandmarker | undefined;

const api = {
  /** Detector init with the app's own loader (wasm + model fetch + graph setup). */
  async initObjects(threshold: number): Promise<{ delegate: string; ms: number }> {
    const t0 = performance.now();
    const delegate = await det.loadDetector(threshold);
    return { delegate, ms: ms(t0) };
  },
  async setThreshold(t: number): Promise<void> { await det.setThreshold(t); },

  /** One still image through the app's detector (IMAGE mode). */
  async detectImage(url: string): Promise<{ w: number; h: number; ms: number; dets: det.Det[] }> {
    await det.setMode("IMAGE");
    await loadImage(url);
    const t0 = performance.now();
    const dets = await det.detect(img);
    return { w: img.naturalWidth, h: img.naturalHeight, ms: ms(t0), dets };
  },

  setFaceOptions(m: number, a: boolean, model?: string, size?: number): Promise<void> { faces.setFaceOptions(m, a, model, size); return Promise.resolve(); },
  async initFaces(): Promise<{ ms: number }> {
    const t0 = performance.now();
    await faces.loadFaces();
    return { ms: ms(t0) };
  },

  /** App chain: detector → person boxes → faces.refresh/annotate → emotion of each person (largest first). */
  async emotions(url: string): Promise<{ persons: { score: number; area: number; emotion: string | null; p?: number; probs?: number[] }[] }> {
    await det.setMode("IMAGE");
    await loadImage(url);
    const dets = await det.detect(img);
    faces.clearFaces();
    await faces.refresh(img, dets, true);
    const map = faces.annotateFull(dets);
    const persons = [...map].map(([d, e]) => ({ score: d.score, area: d.w * d.h, emotion: e ? e.emotion : null, p: e?.p, probs: e ? [...e.probs].map((v) => +v.toFixed(3)) : undefined }))
      .sort((a, b) => b.area - a.area);
    return { persons };
  },

  /** Emotion stage alone on a face image (FER+): landmarks + alignment + classifier. */
  async faceOnly(url: string): Promise<number[] | null> {
    await loadImage(url);
    const p = await faces.classifyImage(img);
    return p ? [...p].map((v) => +v.toFixed(3)) : null;
  },

  /** FER+ stage comparison: old blendshape rule (upscaled to 224), new chain, classifier on the whole image. */
  async ferStage(url: string): Promise<{ legacy: string | null; shapes: object; chain: number[] | null; whole: number[] }> {
    await loadImage(url);
    const up = document.createElement("canvas"); up.width = 224; up.height = 224;
    up.getContext("2d")!.drawImage(img, 0, 0, 224, 224);
    if (!diag) {
      const fs = await FilesetResolver.forVisionTasks(`${import.meta.env.BASE_URL}wasm`);
      diag = await FaceLandmarker.createFromOptions(fs, { baseOptions: { modelAssetPath: `${import.meta.env.BASE_URL}models/face_landmarker.task`, delegate: "GPU" }, runningMode: "IMAGE", numFaces: 1, outputFaceBlendshapes: true });
    }
    const cats = diag.detect(up).faceBlendshapes[0]?.categories;
    const sh = cats ? Object.fromEntries(cats.map((c) => [c.categoryName, c.score])) : null;
    const legacy = sh ? legacyClassify(sh) : null;
    const avg = (a: string, b: string): number => sh ? +(((sh[a] ?? 0) + (sh[b] ?? 0)) / 2).toFixed(3) : -1;
    const shapes = { browDown: avg("browDownLeft", "browDownRight"), smile: avg("mouthSmileLeft", "mouthSmileRight"), frown: avg("mouthFrownLeft", "mouthFrownRight"), press: avg("mouthPressLeft", "mouthPressRight") };
    const chain = await faces.classifyImage(img);
    const whole = await faces.classifyWhole(img);
    const r = (p: Float32Array): number[] => [...p].map((v) => +v.toFixed(3));
    return { legacy, shapes, chain: chain ? r(chain) : null, whole: r(whole) };
  },

  /** Diagnostic only: blendshapes on the full image (no person crop), plus the app's rule on them. */
  async blendshapes(url: string): Promise<{ found: boolean; rule: string | null; top: [string, number][] }> {
    if (!diag) {
      const fs = await FilesetResolver.forVisionTasks(`${import.meta.env.BASE_URL}wasm`);
      diag = await FaceLandmarker.createFromOptions(fs, {
        baseOptions: { modelAssetPath: `${import.meta.env.BASE_URL}models/face_landmarker.task`, delegate: "GPU" },
        runningMode: "IMAGE", numFaces: 1, outputFaceBlendshapes: true,
      });
    }
    await loadImage(url);
    const cats = diag.detect(img).faceBlendshapes[0]?.categories;
    if (!cats) return { found: false, rule: null, top: [] };
    const shapes = Object.fromEntries(cats.map((c) => [c.categoryName, c.score]));
    const top = cats.filter((c) => c.categoryName !== "_neutral").sort((a, b) => b.score - a.score).slice(0, 6)
      .map((c): [string, number] => [c.categoryName, Math.round(c.score * 1000) / 1000]);
    return { found: true, rule: legacyClassify(shapes), top };
  },

  /** Inference speed on a playing video in VIDEO mode: n detect() calls on consecutive frames. */
  async videoFps(url: string, n: number): Promise<{ meanMs: number; p95Ms: number; fps: number; w: number; h: number }> {
    await det.setMode("VIDEO");
    vid.src = url;
    await vid.play();
    const times: number[] = [];
    for (let i = 0; i < n + 5; i++) {
      await new Promise((r) => vid.requestVideoFrameCallback(() => r(undefined)));
      const t0 = performance.now();
      await det.detect(vid);
      if (i >= 5) times.push(performance.now() - t0); // first frames warm up the GPU pipeline
    }
    vid.pause();
    times.sort((a, b) => a - b);
    const mean = times.reduce((s, x) => s + x, 0) / times.length;
    return { meanMs: +mean.toFixed(1), p95Ms: +times[Math.floor(times.length * 0.95)].toFixed(1), fps: +(1000 / mean).toFixed(1), w: vid.videoWidth, h: vid.videoHeight };
  },

  /** Plays a clip in real time like the app (one detect in flight, newest frame next) and records every result. */
  async recordVideo(url: string): Promise<{ t: number; dets: det.Det[] }[]> {
    vid.src = url; vid.muted = true;
    await vid.play();
    const frames: { t: number; dets: det.Det[] }[] = [];
    while (!vid.ended) {
      const got = await new Promise<boolean>((r) => {
        vid.requestVideoFrameCallback(() => r(true));
        vid.addEventListener("ended", () => r(false), { once: true }); // no frame callback after the last frame
      });
      if (!got) break;
      const t = vid.currentTime;
      frames.push({ t, dets: await det.detect(vid) });
    }
    return frames;
  },
};

(window as unknown as { evalApi: typeof api }).evalApi = api;
document.title = "eval ready";
