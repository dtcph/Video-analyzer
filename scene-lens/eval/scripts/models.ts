/**
 * Runs candidate detectors (eval/models.ts via /eval-models.html) over image sets.
 *   node eval/scripts/models.ts --cands lite2,yolo11s --sets fixtures,coco,pool [--still <1080p jpg>]
 * → eval/.out/cand-<name>.json  { name, load, speed, sets: { fixtures: rows, coco: rows, dog: rows, ... } }
 * Rows have the same shape as run.ts objects rows (file, w, h, ms, raw), so score.py works on them.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import puppeteer from "puppeteer-core";
import { createServer } from "vite";

const arg = (k: string, d: string): string => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const root = resolve(".");
const M = "/eval/.out/models/";
const labels = (f: string): Record<string, string> => JSON.parse(readFileSync(`eval/.out/models/${f}.config.json`, "utf8")).id2label;
const CANDS: Record<string, object> = {
  lite2: { kind: "mediapipe", url: `${M}efficientdet_lite2.tflite` },
  lite4: { kind: "mediapipe", url: `${M}efficientdet_lite4.tflite`, delegate: "CPU" }, // int8: GPU delegate rejects its ops (measured)
  yolov8n: { kind: "yolo", url: `${M}yolov8n-640-dyn-fp16.onnx`, size: 640 },
  yolov8s: { kind: "yolo", url: `${M}yolov8s-640-dyn-fp16.onnx`, size: 640 },
  yolov8m: { kind: "yolo", url: `${M}yolov8m.wf16.onnx`, size: 640 },
  yolo11s: { kind: "yolo", url: `${M}yolo11s.wf16.onnx`, size: 640 },
  yolo11m: { kind: "yolo", url: `${M}yolo11m.wf16.onnx`, size: 640 },
  dfine_n: { kind: "detr", url: `${M}dfine_n_coco.onnx`, size: 640, labels: labels("dfine_n_coco") },
  // onnx-community fp16 exports give empty/constant output on the WebGPU EP (measured), so the fp32 files are used
  dfine_s: { kind: "detr", url: `${M}dfine_s_obj2coco.fp32.onnx`, size: 640, labels: labels("dfine_s_obj2coco") },
  dfine_m: { kind: "detr", url: `${M}dfine_m_obj2coco.fp32.onnx`, size: 640, labels: labels("dfine_m_obj2coco") },
  rfdetr_small: { kind: "detr", url: `${M}rfdetr_small.fp32.onnx`, size: 512, labels: labels("rfdetr_small"), normalize: true },
  dfine_m_wf16: { kind: "detr", url: `${M}dfine_m_obj2coco.wf16.onnx`, size: 640, labels: labels("dfine_m_obj2coco") },
  dfm_b10: { kind: "detr", url: `${M}dfine_m_obj2coco.wf16.onnx`, size: 640, labels: labels("dfine_m_obj2coco"), border: 0.10 },
  dfm_b15: { kind: "detr", url: `${M}dfine_m_obj2coco.wf16.onnx`, size: 640, labels: labels("dfine_m_obj2coco"), border: 0.15 },
  dfm_b25: { kind: "detr", url: `${M}dfine_m_obj2coco.wf16.onnx`, size: 640, labels: labels("dfine_m_obj2coco"), border: 0.25 },
  dfine_s_f16hf: { kind: "detr", url: `${M}dfine_s_obj2coco.onnx`, size: 640, labels: labels("dfine_s_obj2coco") },
};
const extra = process.env.CAND_JSON ? JSON.parse(process.env.CAND_JSON) as Record<string, object> : {};
Object.assign(CANDS, extra);
const SETS: Record<string, string> = {
  fixtures: "eval/fixtures/objects", coco: "eval/.out/coco/val500",
  dog: "eval/pool/dog", scarf: "eval/pool/scarf", control: "eval/pool/control",
};
const cands = arg("--cands", "lite2").split(",");
const sets = arg("--sets", "fixtures").split(",").flatMap((s) => (s === "pool" ? ["dog", "scarf", "control"] : [s]));
const still = arg("--still", "../test-img/moving_car_t2.0.jpg");

const files = (dir: string): string[] => readdirSync(dir).filter((f) => /\.(jpe?g|png)$/i.test(f)).sort().map((f) => join(dir, f));
const urlOf = (f: string): string => {
  const rel = relative(root, resolve(f));
  return rel.startsWith("..") ? `/@fs${resolve(f)}` : "/" + rel;
};

const server = await createServer({ root, server: { port: 5194, strictPort: true, fs: { allow: [root, resolve("..")] } }, logLevel: "error" });
await server.listen();
const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true,
  args: ["--enable-unsafe-webgpu", "--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--no-first-run"],
  protocolTimeout: 600_000,
});
mkdirSync("eval/.out", { recursive: true });
for (const name of cands) {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 300)); });
  await page.goto("http://localhost:5194/eval-models.html");
  await page.waitForFunction(() => document.title === "models ready", { timeout: 60_000 });
  type Api = { load(c: object): Promise<unknown>; detectUrl(u: string): Promise<unknown>; speed(u: string, n: number): Promise<unknown> };
  const api = <T>(fn: keyof Api, ...a: unknown[]): Promise<T> => page.evaluate((f, x) => ((window as unknown as { modelsApi: Record<string, (...y: unknown[]) => Promise<unknown>> }).modelsApi[f])(...x), fn, a) as Promise<T>;
  const out: Record<string, unknown> = { name, cand: { ...CANDS[name], labels: undefined }, date: new Date().toISOString() };
  try {
    out.load = await api("load", CANDS[name]);
    out.speed = existsSync(still) ? await api("speed", urlOf(still), 30) : null;
    const res: Record<string, unknown[]> = {};
    for (const s of sets) {
      res[s] = [];
      for (const f of files(SETS[s])) {
        const r = await api<{ ms: number; w: number; h: number; dets: unknown[] }>("detectUrl", urlOf(f));
        res[s].push({ file: relative(root, f), w: r.w, h: r.h, ms: +r.ms.toFixed(1), raw: r.dets });
      }
    }
    out.sets = res;
  } catch (e) { out.error = String(e); }
  out.errors = errors;
  // merge with previous runs of other sets
  const path = `eval/.out/cand-${name}.json`;
  if (existsSync(path)) { const prev = JSON.parse(readFileSync(path, "utf8")); out.sets = { ...prev.sets, ...(out.sets as object) }; }
  writeFileSync(path, JSON.stringify(out));
  console.log(name, JSON.stringify({ load: out.load, speed: out.speed, error: out.error, errors: errors.slice(0, 2) }));
  await page.close();
}
await browser.close();
await server.close();
