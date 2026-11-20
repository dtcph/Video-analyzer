/**
 * Text contrast audit in the installed Chrome: for every visible text and icon
 * of the start screen, the analysis page and both pop-ups, the worst contrast
 * between its color and what is really behind it (the rendered page with the
 * text made transparent, so glass, color field and tiles are all included).
 *
 *   node scripts/e2e/contrastAudit.ts [--build] [--headed]
 *
 * WCAG AA: 4.5:1 for text, 3:1 for large text (24 px, or 18.66 px bold) and icons.
 * The color behind a text is a range; the ratio is taken against its worst end.
 * Exit code 1 when anything is below the limit.
 */
import { resolve } from "node:path";
import type { Page } from "puppeteer-core";
import { launchChrome, serveApp, uploadFile, waitForModel } from "./harness.ts";

const args = new Set(process.argv.slice(2));
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

interface Item {
    name: string;
    x: number;
    y: number;
    w: number;
    h: number;
    color: string;
    size: number;
    weight: number;
    icon: boolean;
}

interface Result extends Item {
    state: string;
    worst: number;
    required: number;
}

/** Runs in the page: every visible text run and icon with its box and color. */
function collectItems(): Item[] {
    const items: Item[] = [];
    const visible = (el: Element) => {
        if (el.closest("[inert], .visually-hidden, [hidden]")) return false;
        const style = getComputedStyle(el);
        return style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0";
    };
    const inView = (r: DOMRect) => r.width > 1 && r.height > 1 && r.bottom > 0 && r.right > 0 && r.top < innerHeight;
    /** Not under something else (e.g. the page behind an open dialog). */
    const onTop = (el: Element, r: DOMRect) => {
        const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return top !== null && (el.contains(top) || top.contains(el));
    };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
        const node = walker.currentNode;
        const text = node.textContent?.trim();
        const el = node.parentElement;
        if (!text || !el || !visible(el) || el.closest("script, style, option, select")) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        const rect = range.getBoundingClientRect();
        if (!inView(rect) || !onTop(el, rect)) continue;
        const style = getComputedStyle(el);
        items.push({
            name: `${el.className || el.tagName.toLowerCase()}: ${text.slice(0, 28)}`,
            x: rect.x,
            y: rect.y,
            w: rect.width,
            h: rect.height,
            color: style.color,
            size: Number.parseFloat(style.fontSize),
            weight: Number.parseInt(style.fontWeight, 10),
            icon: false
        });
    }
    for (const svg of document.querySelectorAll("svg.icon")) {
        if (!visible(svg)) continue;
        const rect = svg.getBoundingClientRect();
        if (!inView(rect) || !onTop(svg, rect)) continue;
        const label = svg.closest("[aria-label]")?.getAttribute("aria-label") ?? "icon";
        items.push({
            name: `icon: ${label}`,
            x: rect.x,
            y: rect.y,
            w: rect.width,
            h: rect.height,
            color: getComputedStyle(svg).color,
            size: 0,
            weight: 0,
            icon: true
        });
    }
    return items;
}

/** Runs in the page: the luminance range of the screenshot under each item, and its worst contrast. */
async function measure(png: string, items: Item[]): Promise<number[]> {
    const image = new Image();
    image.src = `data:image/png;base64,${png}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
    ctx.drawImage(image, 0, 0);
    const scale = image.naturalWidth / innerWidth;
    const lum = (r: number, g: number, b: number) => {
        const [lr, lg, lb] = [r, g, b].map((c) => {
            const s = c / 255;
            return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
    };
    const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    return items.map((item) => {
        const x = Math.max(0, Math.floor(item.x * scale));
        const y = Math.max(0, Math.floor(item.y * scale));
        const w = Math.max(1, Math.min(canvas.width - x, Math.ceil(item.w * scale)));
        const h = Math.max(1, Math.min(canvas.height - y, Math.ceil(item.h * scale)));
        const data = ctx.getImageData(x, y, w, h).data;
        let low = 1;
        let high = 0;
        for (let i = 0; i < data.length; i += 4) {
            const l = lum(data[i], data[i + 1], data[i + 2]);
            if (l < low) low = l;
            if (l > high) high = l;
        }
        const [r, g, b] = (item.color.match(/[\d.]+/g) ?? ["0", "0", "0"]).map(Number);
        const text = lum(r, g, b);
        return Math.min(ratio(text, low), ratio(text, high));
    });
}

async function audit(page: Page, state: string): Promise<Result[]> {
    const items = await page.evaluate(collectItems);
    const hide = await page.addStyleTag({
        content:
            "*{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important}"
    });
    await sleep(150);
    const png = (await page.screenshot({ encoding: "base64" })) as string;
    await hide.evaluate((el) => el.remove());
    const worst = await page.evaluate(measure, png, items);
    return items.map((item, i) => {
        const large = item.size >= 24 || (item.size >= 18.66 && item.weight >= 700);
        return { ...item, state, worst: worst[i], required: item.icon || large ? 3 : 4.5 };
    });
}

const server = await serveApp(5198, args.has("--build"));
const browser = await launchChrome(args.has("--headed"));
const results: Result[] = [];
try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(server.url, { waitUntil: "load" });
    await waitForModel(page);

    results.push(...(await audit(page, "start screen")));
    await page.evaluate(() => document.getElementById("choose")?.scrollIntoView());
    await sleep(600);
    results.push(...(await audit(page, "start options")));

    await uploadFile(page, resolve("test-vid", "steady-2.mp4"));
    await page.waitForFunction(() => document.documentElement.dataset.view === "analysis");
    await page.click(".playback-button");
    await sleep(5000);
    await page.click(".playback-button");
    await sleep(500);
    results.push(...(await audit(page, "analysis page")));

    await page.click(".settings-open");
    await sleep(900);
    results.push(...(await audit(page, "settings pop-up")));
    await page.keyboard.press("Escape");
    await sleep(900);

    await page.click(".result-open");
    await sleep(1800);
    results.push(...(await audit(page, "result pop-up")));
} finally {
    await browser.close();
    await server.close();
}

const failed = results.filter((r) => r.worst < r.required);
const states = [...new Set(results.map((r) => r.state))];
console.log("| state | texts and icons | lowest ratio | failing |");
console.log("|---|---|---|---|");
for (const state of states) {
    const own = results.filter((r) => r.state === state);
    const lowest = Math.min(...own.map((r) => r.worst));
    console.log(
        `| ${state} | ${own.length} | ${lowest.toFixed(2)} | ${own.filter((r) => r.worst < r.required).length} |`
    );
}
if (failed.length > 0) {
    console.log("\nBelow the limit:");
    for (const r of failed) console.log(`- ${r.state}: ${r.name} (${r.worst.toFixed(2)}, needs ${r.required})`);
}
process.exitCode = failed.length > 0 ? 1 : 0;
