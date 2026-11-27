/**
 * Time to first result: production build, fresh profile per run; a photo is chosen `--delay` ms after
 * DOMContentLoaded, and the time until its counts appear is measured.  node eval/scripts/ttfr.ts --label x [--runs 5] [--delay 1000]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import puppeteer from "puppeteer-core";
import { build, preview } from "vite";

const opt = (k: string, d: string): string => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const label = opt("--label", "run"), runs = Number(opt("--runs", "5")), delay = Number(opt("--delay", "1000"));
await build({ logLevel: "warn" });
const server = await preview({ preview: { port: 5195, strictPort: true }, logLevel: "warn" });
const out: number[] = [];
for (let i = 0; i < runs; i++) {
  const b = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--enable-unsafe-webgpu", "--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const p = await b.newPage();
  await p.goto("http://localhost:5195/", { waitUntil: "domcontentloaded" });
  await new Promise((r) => setTimeout(r, delay));
  const t0 = Date.now();
  await (await p.$("#file-img") as unknown as { uploadFile(f: string): Promise<void> }).uploadFile(resolve("eval/fixtures/objects/ctl-car.jpg"));
  await p.waitForFunction(() => document.querySelectorAll("#counts li .v").length > 0, { timeout: 60_000, polling: 10 });
  out.push(Date.now() - t0);
  await b.close();
}
await new Promise<void>((d) => server.httpServer.close(() => d()));
out.sort((a, b) => a - b);
const res = { label, delay, runs: out, median: out[Math.floor(out.length / 2)] };
mkdirSync("eval/.out", { recursive: true });
writeFileSync(`eval/.out/ttfr-${label}.json`, JSON.stringify(res));
console.log(JSON.stringify(res));
