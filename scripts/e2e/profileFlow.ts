/**
 * Realtime pipeline profiler (Phase 8): plays clips in the real app and times
 * every sampled frame's round trip, without changing app code. The page's
 * Worker is wrapped before the app loads, so each "detect" message's send
 * time and its answer (receive time + the worker's own stage timings) are
 * recorded.
 *
 *   node scripts/e2e/profileFlow.ts [--build] [--headed] [--seconds 8] [--label x]
 *       [--clips a.mp4,b.mp4] [--configs s-webgpu,n-webgpu,n-wasm] [--pre]
 *
 * --pre profiles pre-analysis (whole clip, every frame) instead of realtime playback.
 * --load [--mbps 50]: first visit with an empty cache on a throttled network (default model
 * Auto), then a reload: time until the model is ready and when each file over 1 MB downloaded.
 *
 * Per run: inference fps, dropped samples, and per frame p50/p95 of
 * round trip, worker pre / infer / post, messaging overhead (round trip
 * minus worker time), idle gap (result received → next frame sent), the
 * worker's busy share of the wall time, and main-thread long tasks. Writes .cache/e2e/profile/<label>.json.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "puppeteer-core";
import { collectErrors, debugText, launchChrome, serveApp, setSelect, uploadFile, waitForModel } from "./harness.ts";

const argv = process.argv.slice(2);
const args = new Set(argv);
const option = (name: string, fallback: string) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);

const SECONDS = Number(option("--seconds", "8"));
const LABEL = option("--label", "profile");
const CLIPS = option("--clips", "moving_car.mp4,steady-2.mp4,moving_drone-2.mp4").split(",");
const CONFIGS = option("--configs", "s-webgpu,n-webgpu,n-wasm").split(",");
const PRE = args.has("--pre");
const LOAD = args.has("--load");
const MBPS = Number(option("--mbps", "50"));
const PORT = 5197;
const OUT = ".cache/e2e/profile";

interface FrameRecord {
    sent: number;
    received?: number;
    pre?: number;
    infer?: number;
    post?: number;
}

declare global {
    interface Window {
        __frames: Map<number, FrameRecord>;
        __longTasks: number[];
    }
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** Runs before any app script: wraps Worker to time detect requests, observes long tasks. */
function instrument(): void {
    window.__frames = new Map();
    window.__longTasks = [];
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
        constructor(url: string | URL, options?: WorkerOptions) {
            super(url, options);
            this.addEventListener("message", (event: MessageEvent) => {
                const data = event.data as {
                    type: string;
                    requestId: number;
                    timings?: { preprocessMs: number; inferenceMs: number; postprocessMs: number };
                };
                const record = window.__frames.get(data.requestId);
                if (data.type !== "detections" || !record || !data.timings) return;
                record.received = performance.now();
                record.pre = data.timings.preprocessMs;
                record.infer = data.timings.inferenceMs;
                record.post = data.timings.postprocessMs;
            });
        }
        override postMessage(message: unknown, transfer?: Transferable[] | StructuredSerializeOptions): void {
            const data = message as { type?: string; requestId?: number };
            if (data.type === "detect" && data.requestId !== undefined) {
                window.__frames.set(data.requestId, { sent: performance.now() });
            }
            super.postMessage(message, transfer as Transferable[]);
        }
    };
    new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) window.__longTasks.push(entry.duration);
    }).observe({ type: "longtask", buffered: false });
}

function percentile(values: number[], p: number): number {
    if (values.length === 0) return NaN;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

const fmt = (values: number[]) => `${percentile(values, 0.5).toFixed(1)} / ${percentile(values, 0.95).toFixed(1)}`;

async function profileClip(page: Page, clip: string) {
    await uploadFile(page, resolve("test-vid", clip));
    await page.waitForFunction(() => (document.querySelector("video") as HTMLVideoElement).readyState >= 2);
    await page.waitForFunction(
        () => !(document.querySelector(".counts-current") as HTMLElement).textContent?.includes("Detecting"),
        { timeout: 30_000 }
    );
    await page.evaluate(() => {
        window.__frames.clear();
        window.__longTasks.length = 0;
    });
    await page.click(".playback-button");
    // Skip the first second (rate meter and GPU clocks settle), then measure.
    await sleep(1000);
    await page.evaluate(() => {
        window.__frames.clear();
        window.__longTasks.length = 0;
    });
    const quality0 = await page.$eval("video", (v) => v.getVideoPlaybackQuality().droppedVideoFrames);
    await sleep(SECONDS * 1000);
    const debug = await debugText(page);
    const quality1 = await page.$eval("video", (v) => v.getVideoPlaybackQuality().droppedVideoFrames);
    const frames: FrameRecord[] = await page.evaluate(() => [...window.__frames.values()]);
    const longTasks: number[] = await page.evaluate(() => [...window.__longTasks]);
    await page.click(".playback-button");
    return {
        ...stats(frames),
        inferenceFpsShown: debug["Inference FPS"],
        dropped: debug["Sampled frames dropped"],
        longTasks: `${longTasks.length} (max ${Math.round(Math.max(0, ...longTasks))} ms)`,
        videoFramesDropped: quality1 - quality0,
        clip
    };
}

/** Pre-analysis of the whole clip: every frame, back to back. */
async function profilePre(page: Page, clip: string) {
    await uploadFile(page, resolve("test-vid", clip));
    await page.waitForFunction(() => (document.querySelector("video") as HTMLVideoElement).readyState >= 2);
    await page.$eval(`.analysis-mode input[value="pre"]`, (el) => {
        const radio = el as HTMLInputElement;
        radio.checked = true;
        radio.dispatchEvent(new Event("change"));
    });
    await page.evaluate(() => {
        window.__frames.clear();
        window.__longTasks.length = 0;
    });
    const start = Date.now();
    await page.click(".analysis-start");
    await page.waitForFunction(
        () => (document.querySelector(".analysis-panel") as HTMLElement).dataset.status === "complete",
        { timeout: 300_000, polling: 50 }
    );
    const seconds = (Date.now() - start) / 1000;
    const duration = await page.$eval("video", (v) => v.duration);
    const frames: FrameRecord[] = await page.evaluate(() => [...window.__frames.values()]);
    const longTasks: number[] = await page.evaluate(() => [...window.__longTasks]);
    return {
        ...stats(frames),
        xRealtime: (duration / seconds).toFixed(2),
        seconds: seconds.toFixed(1),
        longTasks: `${longTasks.length} (max ${Math.round(Math.max(0, ...longTasks))} ms)`,
        clip
    };
}

function stats(frames: FrameRecord[]) {
    const done = frames.filter((f) => f.received !== undefined) as Required<FrameRecord>[];
    const roundTrip = done.map((f) => f.received - f.sent);
    const worker = done.map((f) => f.pre + f.infer + f.post);
    const overhead = roundTrip.map((trip, i) => trip - worker[i]);
    const idle = done.slice(1).map((f, i) => f.sent - done[i].received);
    const span = done.length > 1 ? (done.at(-1)!.received - done[0].sent) / 1000 : NaN;
    return {
        frames: done.length,
        fps: done.length / span,
        roundTrip: fmt(roundTrip),
        pre: fmt(done.map((f) => f.pre)),
        infer: fmt(done.map((f) => f.infer)),
        post: fmt(done.map((f) => f.post)),
        overhead: fmt(overhead),
        idle: fmt(idle),
        /** Share of the wall time the worker spent on frames (pre + infer + post). */
        workerBusy: `${Math.round((worker.reduce((a, b) => a + b, 0) / (span * 1000)) * 100)}%`,
        raw: done
    };
}

/** Time from navigation to "model ready", with the download window of every file over 1 MB. */
async function profileLoad(page: Page) {
    const requests = new Map<string, { start: number; end?: number; bytes?: number }>();
    let t0 = Date.now();
    page.on("request", (request) => requests.set(request.url(), { start: Date.now() - t0 }));
    page.on("requestfinished", async (request) => {
        const entry = requests.get(request.url());
        if (!entry) return;
        entry.end = Date.now() - t0;
        entry.bytes = Number((await request.response()?.headers())?.["content-length"] ?? 0);
    });
    const visit = async (reload: boolean) => {
        requests.clear();
        t0 = Date.now();
        if (reload) await page.reload({ waitUntil: "load" });
        else await page.goto(server.url, { waitUntil: "load" });
        const status = await waitForModel(page);
        const readyMs = Date.now() - t0;
        const files = [...requests]
            .filter(([, r]) => (r.bytes ?? 0) > 1_000_000)
            .map(([url, r]) => `${url.split("/").pop()} ${r.start}–${r.end} ms`);
        return { status, readyMs, files };
    };
    return { first: await visit(false), reload: await visit(true) };
}

mkdirSync(OUT, { recursive: true });
const server = await serveApp(PORT, args.has("--build"));
if (LOAD) {
    const browser = await launchChrome(args.has("--headed"));
    const page = await browser.newPage();
    const cdp = await page.createCDPSession();
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: 20,
        downloadThroughput: (MBPS * 1_000_000) / 8,
        uploadThroughput: (10 * 1_000_000) / 8
    });
    const result = await profileLoad(page);
    console.log(JSON.stringify({ mbps: MBPS, ...result }, null, 1));
    writeFileSync(`${OUT}/${LABEL}-load-${MBPS}mbps.json`, JSON.stringify(result, null, 1));
    await browser.close();
    await server.close();
    process.exit(0);
}
const results: Record<string, unknown>[] = [];
try {
    for (const config of CONFIGS) {
        const [model, backend] = config.split("-");
        const browser = await launchChrome(args.has("--headed"));
        const page = await browser.newPage();
        const errors = collectErrors(page);
        await page.evaluateOnNewDocument(instrument);
        await page.setViewport({ width: 1400, height: 1000 });
        await page.goto(server.url, { waitUntil: "load" });
        if (backend === "wasm") await setSelect(page, "backend", 2);
        await setSelect(page, "modelSize", model === "n" ? 1 : 2); // options: auto, n, s
        const loaded = await waitForModel(page);
        for (const clip of CLIPS) {
            const result = PRE ? await profilePre(page, clip) : await profileClip(page, clip);
            results.push({ config, model: loaded, ...result, errors: [...errors] });
            const { raw: _raw, ...shown } = result;
            console.error(`${config} ${JSON.stringify(shown)}`);
        }
        await browser.close();
    }
} finally {
    writeFileSync(`${OUT}/${LABEL}${PRE ? "-pre" : ""}.json`, JSON.stringify(results, null, 1));
    await server.close();
}

const last = PRE ? "× realtime" : "dropped";
console.log(
    `| config | clip | fps | ${last} | round trip | pre | infer | post | messaging | idle gap | worker busy | long tasks | video drops |`
);
console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const r of results as Record<string, never>[]) {
    console.log(
        `| ${r.config} | ${r.clip} | ${(r.fps as number).toFixed(1)} | ${PRE ? r.xRealtime : r.dropped} | ${r.roundTrip} | ${r.pre} | ${r.infer} | ${r.post} | ${r.overhead} | ${r.idle} | ${r.workerBusy} | ${r.longTasks} | ${r.videoFramesDropped ?? "–"} |`
    );
}
