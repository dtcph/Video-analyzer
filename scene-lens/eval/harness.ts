/**
 * Eval harness (dev only, served by `vite` through /eval.html). It imports the real app modules, so every
 * phase measures the pipeline that ships. The puppeteer driver (eval/scripts/run.ts) calls window.evalApi.
 */
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import * as det from "../src/detector";
import * as faces from "../src/faces";

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

  async initFaces(): Promise<{ ms: number }> {
    const t0 = performance.now();
    await faces.loadFaces();
    return { ms: ms(t0) };
  },

  /** App chain: detector → person boxes → faces.refresh/annotate → emotion of each person (largest first). */
  async emotions(url: string): Promise<{ persons: { score: number; area: number; emotion: string | null }[] }> {
    await det.setMode("IMAGE");
    await loadImage(url);
    const dets = await det.detect(img);
    faces.clearFaces();
    faces.refresh(img, dets, true);
    const map = faces.annotate(dets);
    const persons = [...map].map(([d, e]) => ({ score: d.score, area: d.w * d.h, emotion: e }))
      .sort((a, b) => b.area - a.area);
    return { persons };
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
    return { found: true, rule: faces.classify(shapes), top };
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
