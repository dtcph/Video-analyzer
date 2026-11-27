/**
 * Treemap check with synthetic counts (dev server): every box has as many parts as its count, all parts of a
 * box have the same area, no title is cut off, and hovering a part shows the tooltip.
 *   node eval/scripts/treemap.ts   → screenshots in eval/.out/treemap/
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import puppeteer from "puppeteer-core";
import { createServer } from "vite";

const SETS: Record<string, [string, number][]> = {
  street: [["person", 16], ["car", 9], ["bicycle", 3], ["traffic light", 1], ["handbag", 1]],
  skewed: [["car", 66], ["person", 12], ["truck", 3], ["motorcycle", 1], ["fire hydrant", 1], ["parking meter", 1], ["baseball glove", 1]],
  many: ["person", "car", "chair", "bottle", "cup", "book", "laptop", "keyboard", "mouse", "cell phone", "backpack", "dining table", "potted plant", "teddy bear", "hair drier", "wine glass", "tennis racket", "refrigerator"].map((k, i) => [k, i < 3 ? 20 - i * 5 : 1]),
  single: [["person", 1]],
};
mkdirSync("eval/.out/treemap", { recursive: true });
const server = await createServer({ root: resolve("."), server: { port: 5194, strictPort: true }, logLevel: "error" });
await server.listen();
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--hide-scrollbars"] });
for (const width of [375, 768, 1280, 1920]) {
  const page = await browser.newPage();
  const errs: string[] = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  await page.setViewport({ width, height: width === 375 ? 812 : 900 });
  await page.goto("http://localhost:5194/");
  for (const lang of ["en", "ko"]) {
    await page.evaluate((l) => { document.getElementById("tm-close")!.click(); document.getElementById(`lang-${l}`)!.click(); }, lang);
    for (const [name, data] of Object.entries(SETS)) {
      await page.evaluate(async (entries) => {
        const path = "/src/treemapModal.ts";
        const m = await import(/* @vite-ignore */ path);
        m.closeTreemap(); m.openTreemap(); m.updateTreemap(new Map(entries), new Map(entries));
      }, data);
      await new Promise((r) => setTimeout(r, 500));
      const res = await page.evaluate(() => {
        const cut: string[] = [], bad: string[] = [], sizes: number[] = [];
        for (const c of document.querySelectorAll<HTMLElement>(".cell")) {
          const title = c.querySelector<HTMLElement>(".title")!, box = c.getBoundingClientRect(), r = title.getBoundingClientRect();
          const key = c.dataset.key!, count = Number(c.getAttribute("aria-label")!.split(": ")[1]);
          if (title.hidden || r.right > box.right + 0.5 || r.bottom > box.bottom + 0.5) cut.push(key);
          sizes.push(parseFloat(title.style.fontSize));
          const areas = [...c.querySelectorAll(".unit")].map((u) => { const q = u.getBoundingClientRect(); return q.width * q.height; });
          if (areas.length !== count || Math.max(...areas) - Math.min(...areas) > Math.max(...areas) * 0.03) bad.push(key);
        }
        return { cut, bad, sizes: `${Math.min(...sizes)}–${Math.max(...sizes)}px` };
      });
      await page.screenshot({ path: `eval/.out/treemap/${width}-${lang}-${name}.png` });
      const first = await page.$eval(".unit", (u) => { const r = u.getBoundingClientRect(); return { x: r.right - 3, y: r.bottom - 3 }; });
      await page.mouse.move(first.x, first.y);
      const tip = await page.$eval("#tm-tip", (e) => ((e as HTMLElement).hidden ? null : e.textContent));
      if (width === 1280 && name === "street") await page.screenshot({ path: `eval/.out/treemap/${width}-${lang}-hover.png` });
      await page.mouse.move(2, 2);
      const ok = !res.cut.length && !res.bad.length && !!tip;
      if (!ok) process.exitCode = 1;
      console.log(`${ok ? "PASS" : "FAIL"} ${width} ${lang} ${name.padEnd(7)} type ${res.sizes} tip "${tip}"${res.cut.length ? ` cut: ${res.cut}` : ""}${res.bad.length ? ` parts: ${res.bad}` : ""}`);
    }
  }
  if (errs.length) { console.log(errs); process.exitCode = 1; }
  await page.close();
}
await browser.close();
await server.close();
