/**
 * Runtime measurements of the real app (production build + vite preview, installed Chrome headless, GPU on).
 *   node eval/scripts/perf.ts --label baseline [--runs 5] [--no-build]   (run from scene-lens/)
 * → eval/.out/perf-<label>.json
 *
 * Metrics and methods:
 *  - bundle: bytes of every file in dist/ (what Vercel serves), split by type.
 *  - cold load (fresh profile per run, empty cache, localhost, no throttling): FCP, DOMContentLoaded,
 *    model ready (status text switches to "ready", seen by a MutationObserver), TTI (end of the last long task
 *    before a 5 s window without long tasks, not earlier than DOMContentLoaded; long tasks via PerformanceObserver).
 *  - warm load: reload in the same profile (HTTP cache filled), same metrics.
 *  - playback: a local clip through the app's own file input; over 8 s: app loop rate (requestAnimationFrame
 *    callbacks; the app runs detect() in every rAF while playing), new video frames (requestVideoFrameCallback),
 *    CPU time of the renderer and GPU process (CDP SystemInfo.getProcessInfo), JS heap (CDP), RSS (ps).
 */
import { execFileSync } from "node:child_process";
import { readdirSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve, extname } from "node:path";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { build, preview } from "vite";

const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const argv = process.argv;
const opt = (k: string, d: string): string => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const label = opt("--label", "run"), runs = Number(opt("--runs", "5"));
const VIDEO_OBJ = resolve(opt("--video", "../test-vid/moving_car.mp4"));
const VIDEO_FACE = resolve(opt("--video-faces", "../test-vid/moving_handheld.mp4"));
const ARGS = ["--enable-unsafe-webgpu", "--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--no-first-run", "--autoplay-policy=no-user-gesture-required"];
const READY = /Model ready|모델 준비 완료/;

if (!argv.includes("--no-build")) await build({ logLevel: "warn" });

// ---------- bundle ----------
const files: { path: string; bytes: number }[] = [];
const walk = (d: string): void => { for (const e of readdirSync(d)) { const p = join(d, e); statSync(p).isDirectory() ? walk(p) : files.push({ path: p.slice(5), bytes: statSync(p).size }); } };
walk("dist");
const group = (f: { path: string }): string => {
  if (f.path.startsWith("models/")) return "models";
  if (f.path.startsWith("wasm/")) return "wasm runtime";
  return ({ ".js": "js", ".css": "css", ".html": "html" } as Record<string, string>)[extname(f.path)] ?? "other";
};
const bundle: Record<string, number> = {};
for (const f of files) bundle[group(f)] = (bundle[group(f)] ?? 0) + f.bytes;
bundle.total = files.reduce((s, f) => s + f.bytes, 0);

// ---------- server ----------
const server = await preview({ preview: { port: 5191, strictPort: true }, logLevel: "warn" });
const URL = "http://localhost:5191/";

const instrument = (page: Page): Promise<unknown> => page.evaluateOnNewDocument(() => {
  const w = window as unknown as { __m: { lt: [number, number][]; ready?: number } };
  w.__m = { lt: [] };
  new PerformanceObserver((l) => { for (const e of l.getEntries()) w.__m.lt.push([e.startTime, e.startTime + e.duration]); }).observe({ type: "longtask", buffered: true });
  document.addEventListener("DOMContentLoaded", () => {
    const s = document.getElementById("status")!;
    new MutationObserver(() => { if (/Model ready|모델 준비 완료/.test(s.textContent ?? "") && !w.__m.ready) w.__m.ready = performance.now(); })
      .observe(s, { childList: true, characterData: true, subtree: true });
  });
});

async function loadMetrics(page: Page): Promise<Record<string, number>> {
  await page.waitForFunction(() => !!(window as unknown as { __m: { ready?: number } }).__m.ready, { timeout: 120_000 });
  await new Promise((r) => setTimeout(r, 5500)); // the 5 s quiet window for TTI
  return page.evaluate(() => {
    const m = (window as unknown as { __m: { lt: [number, number][]; ready: number } }).__m;
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
    const fcp = performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? 0;
    let tti = Math.max(fcp, nav.domContentLoadedEventEnd);
    const lts = m.lt.filter((x) => x[1] > fcp).sort((a, b) => a[0] - b[0]);
    for (const [s, e] of lts) if (s - tti < 5000) tti = Math.max(tti, e); else break;
    return { fcp: Math.round(fcp), dcl: Math.round(nav.domContentLoadedEventEnd), modelReady: Math.round(m.ready), tti: Math.round(tti),
      longTasks: lts.length, longTaskMs: Math.round(lts.reduce((s, [a, b]) => s + b - a, 0)), transferKB: Math.round(performance.getEntriesByType("resource").reduce((s, r) => s + (r as PerformanceResourceTiming).transferSize, nav.transferSize) / 1024) };
  });
}

const median = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const summarize = (rs: Record<string, number>[]): Record<string, number> => Object.fromEntries(Object.keys(rs[0]).map((k) => [k, median(rs.map((r) => r[k]))]));

const cold: Record<string, number>[] = [];
for (let i = 0; i < runs; i++) {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ARGS });
  const p = await b.newPage(); await instrument(p);
  await p.goto(URL); cold.push(await loadMetrics(p));
  await b.close(); process.stdout.write("c");
}
const warm: Record<string, number>[] = [];
{
  const b = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ARGS });
  const p = await b.newPage(); await instrument(p);
  await p.goto(URL); await loadMetrics(p);
  for (let i = 0; i < runs; i++) { await p.reload(); warm.push(await loadMetrics(p)); process.stdout.write("w"); }
  await b.close();
}

// ---------- playback ----------
async function procs(b: Browser): Promise<{ type: string; id: number; cpuTime: number }[]> {
  const s = await b.target().createCDPSession();
  const r = (await s.send("SystemInfo.getProcessInfo")) as { processInfo: { type: string; id: number; cpuTime: number }[] };
  await s.detach();
  return r.processInfo;
}
const rssMB = (pid: number): number => { try { return Math.round(Number(execFileSync("ps", ["-o", "rss=", "-p", String(pid)]).toString().trim()) / 1024); } catch { return 0; } };

async function playback(video: string, faces: boolean): Promise<Record<string, number | string>> {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ARGS });
  const p = await b.newPage(); await instrument(p);
  await p.setViewport({ width: 1440, height: 900 });
  await p.goto(URL);
  await p.waitForFunction(() => !!(window as unknown as { __m: { ready?: number } }).__m.ready, { timeout: 120_000 });
  const log = (m: string): void => { if (process.env.PERF_DEBUG) console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`); };
  log("model ready");
  const input = await p.$("#file-vid");
  await (input as unknown as { uploadFile(f: string): Promise<void> }).uploadFile(video);
  await p.waitForFunction(() => { const v = document.getElementById("vid") as HTMLVideoElement; return v.readyState >= 2 && !v.paused; }, { timeout: 30_000 });
  log("video playing");
  if (faces) {
    await p.click(".switch");
    await p.waitForFunction(() => (document.getElementById("faces-on") as HTMLInputElement).checked && /ready|준비/.test(document.getElementById("status")!.textContent ?? ""), { timeout: 60_000 });
  }
  log("faces ready");
  await new Promise((r) => setTimeout(r, 1500));
  const before = await procs(b);
  log("window start");
  const win = await p.evaluate(async () => {
    const v = document.getElementById("vid") as HTMLVideoElement;
    let raf = 0, vf = 0, run = true;
    const tick = (): void => { if (!run) return; raf++; requestAnimationFrame(tick); };
    const vtick = (): void => { if (!run) return; vf++; v.requestVideoFrameCallback(vtick); };
    requestAnimationFrame(tick); v.requestVideoFrameCallback(vtick);
    const t0 = performance.now(), lt0 = (window as unknown as { __m: { lt: unknown[] } }).__m.lt.length;
    await new Promise((r) => setTimeout(r, 8000));
    run = false;
    const sec = (performance.now() - t0) / 1000;
    const lt = (window as unknown as { __m: { lt: [number, number][] } }).__m.lt.slice(lt0);
    return { sec, loopFps: +(raf / sec).toFixed(1), videoFps: +(vf / sec).toFixed(1), longTasks: lt.length, w: v.videoWidth, h: v.videoHeight };
  });
  log("window end");
  const after = await procs(b);
  const cpu = (type: string): number => {
    const sum = (ps: typeof before): number => ps.filter((x) => x.type === type).reduce((s, x) => s + x.cpuTime, 0);
    return +(((sum(after) - sum(before)) / win.sec) * 100).toFixed(0);
  };
  const cdp = await p.createCDPSession();
  await cdp.send("HeapProfiler.collectGarbage");
  const heap = (await p.metrics()).JSHeapUsedSize ?? 0;
  const renderer = after.filter((x) => x.type === "renderer").map((x) => rssMB(x.id)).reduce((s, x) => s + x, 0);
  const gpu = after.filter((x) => x.type === "GPU").map((x) => rssMB(x.id)).reduce((s, x) => s + x, 0);
  await b.close();
  return { video: video.split("/").pop()!, faces: String(faces), ...win, cpuRendererPct: cpu("renderer"), cpuGpuProcPct: cpu("GPU"), jsHeapMB: Math.round(heap / 1048576), rendererRssMB: renderer, gpuRssMB: gpu };
}

const play = [await playback(VIDEO_OBJ, false), await playback(VIDEO_FACE, true)];
process.stdout.write("p\n");
await new Promise<void>((done) => server.httpServer.close(() => done()));

const out = { label, date: new Date().toISOString(), runs, bundle, files: files.sort((a, b) => b.bytes - a.bytes).slice(0, 12), cold: summarize(cold), coldRuns: cold, warm: summarize(warm), playback: play };
mkdirSync("eval/.out", { recursive: true });
writeFileSync(`eval/.out/perf-${label}.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify({ bundle, cold: out.cold, warm: out.warm, playback: play }, null, 1));
