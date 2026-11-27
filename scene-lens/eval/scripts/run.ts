/**
 * Eval driver: serves scene-lens with Vite, opens /eval.html in the installed Chrome (headless, GPU on)
 * and runs the real app modules over image sets.
 *
 *   node eval/scripts/run.ts objects <img dir> [--label x]   → eval/.out/objects-<label>.json
 *   node eval/scripts/run.ts emotions <img dir> [--label x]  → eval/.out/emotions-<label>.json
 *   node eval/scripts/run.ts fps <video file> [--label x]    → eval/.out/fps-<label>.json
 * (run from scene-lens/). puppeteer-core is resolved from the parent project's node_modules.
 */
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import puppeteer from "puppeteer-core";
import { createServer } from "vite";

const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const [cmd, target] = process.argv.slice(2);
const label = process.argv.includes("--label") ? process.argv[process.argv.indexOf("--label") + 1] : "run";
const APP_THRESHOLD = Number(process.env.APP_THRESHOLD ?? 0.4);
const root = resolve(".");

const server = await createServer({ root, server: { port: 5190, strictPort: true, fs: { allow: [root, resolve("..")] } }, logLevel: "error" });
await server.listen();
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ["--enable-unsafe-webgpu", "--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--no-first-run", "--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto("http://localhost:5190/eval.html");
await page.waitForFunction(() => document.title === "eval ready", { timeout: 60_000 });

type Api = Record<string, (...a: unknown[]) => Promise<unknown>>;
const call = <T>(fn: string, ...args: unknown[]): Promise<T> =>
  page.evaluate((f, a) => ((window as unknown as { evalApi: Api }).evalApi[f] as (...x: unknown[]) => Promise<unknown>)(...a), fn, args) as Promise<T>;

const images = (dir: string): string[] => {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.isDirectory()) walk(join(d, e.name));
      else if (/\.(jpe?g|png|webp)$/i.test(e.name)) out.push(join(d, e.name));
    }
  };
  walk(dir);
  return out;
};
const urlOf = (file: string): string => "/" + relative(root, resolve(file)).split("\\").join("/");

interface D { name: string; score: number; x: number; y: number; w: number; h: number }
const result: Record<string, unknown> = { label, chrome: await browser.version(), date: new Date().toISOString() };

if (cmd === "objects") {
  result.init = await call("initObjects", APP_THRESHOLD);
  const rows: unknown[] = [];
  for (const f of images(target)) {
    await call("setThreshold", APP_THRESHOLD);
    const app = await call<{ w: number; h: number; ms: number; dets: D[] }>("detectImage", urlOf(f));
    await call("setThreshold", 0.05);
    const raw = await call<{ dets: D[] }>("detectImage", urlOf(f));
    rows.push({
      file: relative(root, f), w: app.w, h: app.h, ms: app.ms,
      app: app.dets.map((d) => [d.name, +d.score.toFixed(3)]),
      raw: raw.dets.slice(0, 12).map((d) => [d.name, +d.score.toFixed(3), Math.round(d.x), Math.round(d.y), Math.round(d.w), Math.round(d.h)]),
    });
    process.stdout.write(".");
  }
  result.threshold = APP_THRESHOLD;
  result.rows = rows;
} else if (cmd === "emotions") {
  result.initObjects = await call("initObjects", APP_THRESHOLD);
  if (process.env.FACE_MARGIN) await call("setFaceOptions", Number(process.env.FACE_MARGIN), process.env.ALIGN !== "0", process.env.EMO_MODEL, Number(process.env.EMO_SIZE ?? 224));
  result.initFaces = await call("initFaces");
  const rows: unknown[] = [];
  for (const f of images(target)) {
    const chain = await call<{ persons: unknown[] }>("emotions", urlOf(f));
    const bs = await call<unknown>("blendshapes", urlOf(f));
    rows.push({ file: relative(root, f), chain: chain.persons, fullImage: bs });
    process.stdout.write(".");
  }
  result.rows = rows;
} else if (cmd === "ferplus") { // emotion stage alone on FER+ faces (folders = labels)
  await call("initObjects", APP_THRESHOLD);
  if (process.env.FACE_MARGIN) await call("setFaceOptions", Number(process.env.FACE_MARGIN), process.env.ALIGN !== "0", process.env.EMO_MODEL, Number(process.env.EMO_SIZE ?? 224));
  result.initFaces = await call("initFaces");
  const rows: unknown[] = [];
  for (const f of images(target)) { rows.push({ file: relative(root, f), label: f.split("/").slice(-2)[0], ...(await call<object>("ferStage", urlOf(f))) }); }
  result.rows = rows;
} else if (cmd === "record") { // detections of a clip in real time, for offline tracker comparisons
  result.init = await call("initObjects", APP_THRESHOLD);
  result.frames = await call("recordVideo", urlOf(target));
} else if (cmd === "fps") {
  result.init = await call("initObjects", APP_THRESHOLD);
  result.fps = await call("videoFps", urlOf(target), 120);
} else {
  throw new Error(`unknown command ${cmd}`);
}
result.errors = errors;
mkdirSync("eval/.out", { recursive: true });
const out = `eval/.out/${cmd}-${label}.json`;
writeFileSync(out, JSON.stringify(result, null, 1));
console.log(`\n→ ${out} (${errors.length} page errors)`);
await browser.close();
await server.close();
