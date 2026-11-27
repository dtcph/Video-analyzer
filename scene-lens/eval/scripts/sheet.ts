/** Contact sheet of an image folder (numbered thumbnails) via headless Chrome: node eval/scripts/sheet.ts <dir> <out.jpg> */
import { readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import puppeteer from "puppeteer-core";
const [dir, out] = process.argv.slice(2);
const files = readdirSync(dir).filter((f) => /\.(jpe?g|png)$/i.test(f)).sort();
const html = `<body style="margin:0;font:bold 18px sans-serif;display:grid;grid-template-columns:repeat(8,200px);gap:4px;background:#fff">${files
  .map((f) => `<figure style="margin:0;position:relative;width:200px;height:200px;background:#eee"><img src="file://${resolve(dir, f)}" style="width:100%;height:100%;object-fit:contain"><figcaption style="position:absolute;top:0;left:0;background:#fff;color:#d00;padding:2px 4px">${f.replace(/\.\w+$/, "")}</figcaption></figure>`)
  .join("")}</body>`;
const b = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--allow-file-access-from-files"] });
const p = await b.newPage();
await p.setViewport({ width: 8 * 204, height: 400 });
const tmp = resolve(out + ".html");
writeFileSync(tmp, html);
await p.goto(`file://${tmp}`, { waitUntil: "load" });
await p.screenshot({ path: out, fullPage: true, type: "jpeg", quality: 70 });
await b.close();
