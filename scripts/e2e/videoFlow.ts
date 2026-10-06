/**
 * End-to-end check of realtime video analysis (Phase 3) in the installed Chrome.
 *
 *   node scripts/e2e/videoFlow.ts [--build] [--headed] [--seconds 6]
 *
 * For each clip × backend × max inference rate: load, check the paused first
 * frame is detected, play, measure (effective inference FPS, dropped samples,
 * latency, dropped video frames, box lag behind the picture), pause (current-
 * frame counts must be for exactly the displayed frame), seek while paused and
 * while playing (no boxes from before the seek may ever be drawn).
 * Writes .cache/e2e/video-flow.json, a markdown table to stdout, and screenshots.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "puppeteer-core";
import {
    collectErrors,
    debugText,
    launchChrome,
    serveApp,
    setRange,
    setSelect,
    uploadFile,
    waitForModel
} from "./harness.ts";

const argv = process.argv.slice(2);
const args = new Set(argv);
const PLAY_SECONDS = argv.includes("--seconds") ? Number(argv[argv.indexOf("--seconds") + 1]) : 6;
const PORT = 5194;
const OUT = ".cache/e2e";
const CLIPS = ["moving_car.mp4", "steady-2.mp4", "moving_drone-2.mp4"];
const BACKENDS: [string, number][] = [
    ["auto", 0],
    ["wasm", 2]
];
const RATES = [15, 30];

interface DrawSample {
    draw: number;
    result: number | null;
    boxes: number;
}

declare global {
    interface Window {
        __draws: DrawSample[];
    }
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** Records every overlay draw (media time drawn, media time of the result shown) from inside the page. */
async function installDrawLog(page: Page): Promise<void> {
    await page.evaluate(() => {
        window.__draws = [];
        const stage = document.querySelector(".media-stage") as HTMLElement;
        new MutationObserver(() => {
            const { drawTime, resultTime, boxes } = stage.dataset;
            window.__draws.push({
                draw: Number(drawTime),
                result: resultTime ? Number(resultTime) : null,
                boxes: Number(boxes)
            });
        }).observe(stage, { attributes: true, attributeFilter: ["data-draw-time"] });
    });
}

async function takeDraws(page: Page): Promise<DrawSample[]> {
    return page.evaluate(() => window.__draws.splice(0));
}

async function currentCounts(page: Page): Promise<string> {
    await page.waitForFunction(
        () => {
            const section = document.querySelector(".counts-current") as HTMLElement;
            return !section.hidden && !section.textContent?.includes("Detecting");
        },
        { timeout: 30_000 }
    );
    return page.$eval(
        ".counts-current",
        (el) => el.querySelector(".counts-summary")?.textContent ?? el.querySelector(".panel-empty")?.textContent ?? ""
    );
}

async function videoState(page: Page) {
    return page.$eval("video", (v) => ({ paused: v.paused, time: v.currentTime, duration: v.duration }));
}

async function exactPausedFrame(page: Page): Promise<boolean> {
    return page.$eval(".media-stage", (stage) => {
        const { drawTime, resultTime } = (stage as HTMLElement).dataset;
        return resultTime !== "" && Math.abs(Number(drawTime) - Number(resultTime)) < 0.002;
    });
}

async function seekTo(page: Page, seconds: number): Promise<void> {
    await page.$eval(
        ".playback-scrubber",
        (el, s) => {
            const input = el as HTMLInputElement;
            input.value = String(s);
            input.dispatchEvent(new Event("input"));
        },
        seconds
    );
}

/**
 * Draws after a seek to `target`. A seek lands on the frame at or just before the target, so a
 * fresh result may lie up to one frame (≤ 42 ms at 24 fps) before it. Stale = a result from before
 * the seek: more than 50 ms before the target, or later than the frame being drawn.
 */
function analyzeSeek(draws: DrawSample[], target: number) {
    const first = draws.findIndex((d) => Math.abs(d.draw - target) < 0.1);
    const after = first < 0 ? [] : draws.slice(first);
    const results = after.filter((d) => d.result !== null) as { draw: number; result: number }[];
    const stale = results.filter((d) => d.result < target - 0.05 || d.result > d.draw + 0.001);
    return {
        drawsAfterSeek: after.length,
        staleDraws: stale.length,
        staleExamples: stale.slice(0, 3),
        minResultMinusTargetMs: results.length
            ? Math.round(Math.min(...results.map((d) => d.result - target)) * 1000)
            : null,
        resultsResumed: results.length > 0
    };
}

function num(text: string | undefined): number {
    return Number(/[\d.]+/.exec(text ?? "")?.[0] ?? NaN);
}

mkdirSync(OUT, { recursive: true });
const server = await serveApp(PORT, args.has("--build"));
const browser = await launchChrome(args.has("--headed"));
const page = await browser.newPage();
const errors = collectErrors(page);
const runs: Record<string, unknown>[] = [];

try {
    await page.setViewport({ width: 1400, height: 1000 });
    await page.goto(server.url, { waitUntil: "load" });
    for (const [backendName, backendIndex] of BACKENDS) {
        await setSelect(page, "backend", backendIndex);
        const model = await waitForModel(page);
        for (const rate of RATES) {
            await setRange(page, "maxInferenceFps", rate);
            for (const clip of CLIPS) {
                const run: Record<string, unknown> = { clip, backend: backendName, model, maxFps: rate };
                await uploadFile(page, resolve("test-vid", clip));
                await page.waitForFunction(() => (document.querySelector("video") as HTMLVideoElement).readyState >= 2);
                await installDrawLog(page);
                run.firstFrameCounts = await currentCounts(page);

                // Play and measure.
                await takeDraws(page);
                await page.click(".playback-button");
                await sleep(PLAY_SECONDS * 1000);
                const debug = await debugText(page);
                const draws = await takeDraws(page);
                const withResult = draws.filter((d) => d.result !== null);
                const lags = withResult.map((d) => d.draw - (d.result as number)).sort((a, b) => a - b);
                Object.assign(run, {
                    effectiveFps: num(debug["Inference FPS"]),
                    sampledDropped: debug["Sampled frames dropped"],
                    latencyMs: num(debug["Latency capture→result"]),
                    timings: debug["ms pre / infer / post"],
                    input: debug["Input"],
                    videoFramesDropped: debug["Video frames dropped"],
                    overlayDraws: draws.length,
                    drawsWithBoxes: withResult.length,
                    boxLagMedianMs: lags.length ? Math.round(lags[Math.floor(lags.length / 2)] * 1000) : null,
                    boxLagP95Ms: lags.length ? Math.round(lags[Math.floor(lags.length * 0.95)] * 1000) : null
                });
                if (backendName === "auto" && rate === 30) {
                    await (
                        await page.$(".media-stage")
                    )?.screenshot({ path: `${OUT}/video__${clip.replace(".mp4", "")}.png` });
                }

                // Pause: the current-frame counts must be for the displayed frame.
                await page.click(".playback-button");
                run.pausedCounts = await currentCounts(page);
                run.pausedExact = await exactPausedFrame(page);

                // Seek while paused.
                const { duration } = await videoState(page);
                await takeDraws(page);
                const pausedTarget = Math.round(duration * 0.7 * 100) / 100;
                await seekTo(page, pausedTarget);
                run.seekPausedCounts = await currentCounts(page);
                run.seekPausedExact = await exactPausedFrame(page);
                run.seekPaused = analyzeSeek(await takeDraws(page), pausedTarget);

                // Seek while playing (backwards), keep playing.
                await page.click(".playback-button");
                await sleep(1500);
                const playingTarget = Math.round(duration * 0.2 * 100) / 100;
                await takeDraws(page);
                await seekTo(page, playingTarget);
                await sleep(2000);
                run.seekPlaying = analyzeSeek(await takeDraws(page), playingTarget);
                await page.click(".playback-button");
                await currentCounts(page);
                runs.push(run);
                console.error(
                    `${clip} ${backendName} ${rate}fps: ${run.effectiveFps} fps, dropped ${run.sampledDropped}`
                );
            }
        }
    }
} finally {
    writeFileSync(`${OUT}/video-flow.json`, JSON.stringify({ errors, runs }, null, 2));
    await browser.close();
    await server.close();
}

console.log(
    "| clip | backend | max fps | inference fps | samples dropped | latency ms | pre/infer/post ms | video frames dropped | box lag p50/p95 ms | paused exact | seek stale draws (paused/playing) |"
);
console.log("|---|---|---|---|---|---|---|---|---|---|---|");
for (const r of runs as Record<string, never>[]) {
    const sp = r.seekPaused as { staleDraws: number };
    const sl = r.seekPlaying as { staleDraws: number; resultsResumed: boolean };
    console.log(
        `| ${r.clip} | ${r.backend} | ${r.maxFps} | ${r.effectiveFps} | ${r.sampledDropped} | ${r.latencyMs} | ${r.timings} | ${r.videoFramesDropped} | ${r.boxLagMedianMs}/${r.boxLagP95Ms} | ${r.pausedExact && r.seekPausedExact} | ${sp.staleDraws}/${sl.staleDraws}${sl.resultsResumed ? "" : " (no results after seek!)"} |`
    );
}
console.log("errors:", errors.length ? errors : "none");
