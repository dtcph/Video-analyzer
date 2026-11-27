/**
 * Layout screenshots of every screen at 375 / 768 / 1280 / 1920 px (dev server, headless Chrome).
 *   node eval/scripts/shots.ts --label before   → eval/.out/shots/<label>/<width>-<view>.png
 * Also records the header box (top, height, left of first item, right of last item) per screen and width,
 * and whether the page scrolls horizontally, into eval/.out/shots/<label>/header.json.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import puppeteer from "puppeteer-core";
import { createServer } from "vite";

const label = process.argv.includes("--label") ? process.argv[process.argv.indexOf("--label") + 1] : "run";
const out = `eval/.out/shots/${label}`;
mkdirSync(out, { recursive: true });
const server = await createServer({ root: resolve("."), server: { port: 5192, strictPort: true }, logLevel: "error" });
await server.listen();
const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--hide-scrollbars"],
});
const report: Record<string, unknown> = {};
const header = (): unknown => {
  // the analysis header in the old layout is .bar, the language switch is .lang; the new layout uses .site-header
  const h = document.querySelector<HTMLElement>(".site-header") ?? (document.getElementById("analysis")!.hidden ? null : document.querySelector<HTMLElement>(".bar"));
  const lang = document.querySelector<HTMLElement>(".lang")!.getBoundingClientRect();
  const r = h?.getBoundingClientRect();
  return { header: r ? { top: r.top, height: r.height, left: r.left, right: r.right } : null, lang: { top: lang.top, height: lang.height, right: innerWidth - lang.right },
    hScroll: document.documentElement.scrollWidth > innerWidth };
};
for (const width of [375, 768, 1280, 1920]) {
  const page = await browser.newPage();
  await page.setViewport({ width, height: width === 375 ? 812 : 900 });
  await page.goto("http://localhost:5192/");
  await page.waitForFunction(() => /ready|준비/.test(document.getElementById("status")?.textContent ?? ""), { timeout: 60_000 });
  await page.evaluate(() => document.documentElement.style.setProperty("scroll-behavior", "auto"));
  await page.screenshot({ path: `${out}/${width}-1-home.png` });
  report[`${width}-home`] = await page.evaluate(header);
  await page.evaluate(() => document.getElementById("about")!.scrollIntoView());
  await page.screenshot({ path: `${out}/${width}-2-about.png`, fullPage: false });
  await page.evaluate(() => window.scrollTo(0, 0));
  const input = await page.$("#file-img");
  await (input as unknown as { uploadFile(f: string): Promise<void> }).uploadFile(resolve("eval/fixtures/objects/ctl-car.jpg"));
  await page.waitForFunction(() => document.querySelectorAll("#counts li .v").length > 0, { timeout: 30_000 });
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({ path: `${out}/${width}-3-analysis.png`, fullPage: true });
  report[`${width}-analysis`] = await page.evaluate(header);
  await page.click("#open-tm");
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({ path: `${out}/${width}-4-treemap.png` });
  await page.close();
  process.stdout.write(`${width} `);
}
writeFileSync(`${out}/header.json`, JSON.stringify(report, null, 1));
console.log(JSON.stringify(report));
await browser.close();
await server.close();
