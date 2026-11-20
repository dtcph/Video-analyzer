/**
 * Main-thread cost of the live analysis, to compare builds and the result
 * dialog: plays a busy clip in the real app and reads the page's main-thread
 * task time (Chrome DevTools Performance metrics) over a fixed span, plus the
 * inference rate, how often the totals changed, and long tasks.
 *
 *   node scripts/e2e/mainThreadCost.ts [--build] [--clip moving_car.mp4] [--seconds 10] [--runs 3]
 *       [--dialog] [--port 5191] [--label name]
 *
 * --dialog opens the analysis result (treemap) before measuring. Run it from
 * another checkout's root to measure that build (e.g. the V3 baseline).
 * The numbers are medians over --runs fresh page loads. Writes .cache/e2e/main-thread/<label>.json.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { debugText, launchChrome, serveApp, uploadFile, waitForModel } from "./harness.ts";

const argv = process.argv.slice(2);
const option = (name: string, fallback: string) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
const CLIP = option("--clip", "moving_car.mp4");
const SECONDS = Number(option("--seconds", "10"));
const RUNS = Number(option("--runs", "3"));
const PORT = Number(option("--port", "5191"));
const LABEL = option("--label", "run");
const DIALOG = argv.includes("--dialog");
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

declare global {
    interface Window {
        __longTasks: number[];
    }
}

const server = await serveApp(PORT, argv.includes("--build"));
const browser = await launchChrome(argv.includes("--headed"));
const runs: Record<string, number>[] = [];
try {
    for (let run = 0; run < RUNS; run++) {
        const page = await browser.newPage();
        await page.evaluateOnNewDocument(() => {
            window.__longTasks = [];
            new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) window.__longTasks.push(entry.duration);
            }).observe({ type: "longtask", buffered: true });
        });
        await page.setViewport({ width: 1440, height: 900 });
        await page.goto(server.url, { waitUntil: "load" });
        await waitForModel(page);
        await uploadFile(page, resolve("test-vid", CLIP));
        await page.waitForFunction(() => (document.querySelector("video") as HTMLVideoElement).readyState >= 2);
        await sleep(1000);
        await page.click(".playback-button");
        if (DIALOG) {
            await page.click(".result-open");
            await page.waitForSelector(".result-overlay.is-open");
        }
        await sleep(3000); // settled: tracks exist, the dialog's slide-in is over

        const cdp = await page.createCDPSession();
        await cdp.send("Performance.enable");
        const task = async () =>
            (await cdp.send("Performance.getMetrics")).metrics.find((m) => m.name === "TaskDuration")?.value ?? 0;
        const revision = () =>
            page.evaluate(() => Number((document.querySelector(".counts-panel") as HTMLElement).dataset.revision ?? 0));
        await page.evaluate(() => (window.__longTasks.length = 0));
        const [task0, revision0] = [await task(), await revision()];
        await sleep(SECONDS * 1000);
        const [task1, revision1] = [await task(), await revision()];
        const debug = await debugText(page);
        const longTasks = await page.evaluate(() => [...window.__longTasks]);
        runs.push({
            mainThreadMsPerSecond: ((task1 - task0) * 1000) / SECONDS,
            countUpdatesPerSecond: (revision1 - revision0) / SECONDS,
            inferenceFps: Number.parseFloat(debug["Inference FPS"] ?? "0"),
            longTasks: longTasks.length,
            longestMs: Math.max(0, ...longTasks)
        });
        await page.close();
    }
} finally {
    await browser.close();
    await server.close();
}

const summary = Object.fromEntries(
    Object.keys(runs[0]).map((key) => [key, Number(median(runs.map((r) => r[key])).toFixed(2))])
);
mkdirSync(".cache/e2e/main-thread", { recursive: true });
writeFileSync(
    `.cache/e2e/main-thread/${LABEL}.json`,
    JSON.stringify({ clip: CLIP, dialog: DIALOG, runs, summary }, null, 2)
);
console.log(
    `${LABEL} (${CLIP}, ${DIALOG ? "result dialog open" : "dialog closed"}, median of ${RUNS}):`,
    JSON.stringify(summary)
);
