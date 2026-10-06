/**
 * End-to-end check of pre-analysis (Phase 6) in the installed Chrome.
 *
 *   node scripts/e2e/preAnalysisFlow.ts [--build] [--headed] [--backend wasm] [--speed]
 *
 * Flow on steady-2.mp4: realtime is the default; Pre-analysis locks playback;
 * progress and ETA advance; Stop keeps a partial (locked) result and Resume
 * completes it; the whole video's totals are shown before playing; two
 * playthroughs and a second, uninterrupted analysis give identical totals;
 * boxes match the frame on screen; settings changes make the cache stale and
 * both kinds of Re-analyze work; switching modes keeps the cache; a
 * portrait phone-style file (sideways pixels + rotation tag) is analyzed as
 * displayed, like realtime.
 * --speed: analyzes all 7 clips and prints a speed / ETA / totals table.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "puppeteer-core";
import { collectErrors, launchChrome, serveApp, setRange, setSelect, uploadFile, waitForModel } from "./harness.ts";

const argv = process.argv.slice(2);
const args = new Set(argv);
const BACKEND = argv.includes("--backend") ? argv[argv.indexOf("--backend") + 1] : "auto";
const PORT = 5198;
const OUT = ".cache/e2e";
const ROTATED = resolve(OUT, "steady-portrait.mp4");
const ALL_CLIPS = [
    "moving_car.mp4",
    "moving_drone.mp4",
    "moving_drone-2.mp4",
    "moving_handheld.mp4",
    "moving_handheld-2.mp4",
    "steady.mp4",
    "steady-2.mp4"
];
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

const results: [string, boolean, string][] = [];
const check = (name: string, ok: boolean, detail: unknown) => {
    results.push([name, ok, JSON.stringify(detail)]);
    console.error(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  ${JSON.stringify(detail)}`}`);
};

async function ui(page: Page) {
    return page.evaluate(() => {
        const panel = document.querySelector(".analysis-panel") as HTMLElement;
        const visible = (selector: string) => {
            const el = document.querySelector(selector) as HTMLElement | null;
            return el !== null && !el.hidden;
        };
        const totals: Record<string, number> = {};
        document.querySelectorAll(".counts-total .counts-row").forEach((row) => {
            const label = row.querySelector(".counts-label")?.firstChild?.textContent?.trim() ?? "?";
            totals[label] = Number(row.querySelector(".counts-value")?.textContent);
        });
        const video = document.querySelector("video") as HTMLVideoElement;
        return {
            mode: panel.dataset.mode,
            status: panel.dataset.status,
            progressText: (panel.querySelector(".analysis-progress-text") as HTMLElement).textContent ?? "",
            progressValue: (panel.querySelector(".analysis-progress") as HTMLProgressElement).value,
            message: (panel.querySelector(".analysis-message") as HTMLElement).textContent ?? "",
            staleVisible: visible(".analysis-stale"),
            staleText: (panel.querySelector(".analysis-stale-text") as HTMLElement).textContent ?? "",
            error: visible(".analysis-error")
                ? (panel.querySelector(".analysis-error") as HTMLElement).textContent
                : "",
            startLabel: visible(".analysis-start")
                ? (panel.querySelector(".analysis-start") as HTMLElement).textContent
                : null,
            playDisabled: (document.querySelector(".playback-button") as HTMLButtonElement).disabled,
            scrubberDisabled: (document.querySelector(".playback-scrubber") as HTMLInputElement).disabled,
            paused: video.paused,
            time: video.currentTime,
            totalTitle: (document.querySelector(".counts-total-title") as HTMLElement).textContent,
            totals,
            total: Object.values(totals).reduce((a, b) => a + b, 0),
            totalNote: (document.querySelector(".counts-total") as HTMLElement).textContent?.trim().slice(-120) ?? "",
            currentVisible: visible(".counts-current"),
            current:
                (document.querySelector(".counts-current .counts-summary") as HTMLElement | null)?.textContent ?? "",
            resetVisible: visible(".counts-reset")
        };
    });
}

async function waitStatus(page: Page, statuses: string[], timeout = 600_000): Promise<void> {
    await page.waitForFunction(
        (wanted) => wanted.includes((document.querySelector(".analysis-panel") as HTMLElement).dataset.status ?? ""),
        { timeout, polling: 100 },
        statuses
    );
}

async function setMode(page: Page, mode: "realtime" | "pre"): Promise<void> {
    await page.$eval(`.analysis-mode input[value="${mode}"]`, (el) => {
        const radio = el as HTMLInputElement;
        radio.checked = true;
        radio.dispatchEvent(new Event("change"));
    });
}

async function loadClip(page: Page, path: string): Promise<void> {
    await uploadFile(page, path);
    await page.waitForFunction(() => (document.querySelector("video") as HTMLVideoElement).readyState >= 2);
}

/** Starts (or resumes) and waits for completion; returns wall time and the ETA estimates seen on the way. */
async function analyze(page: Page): Promise<{ ms: number; etas: { at: number; etaS: number }[] }> {
    const start = Date.now();
    await page.click(".analysis-start");
    await waitStatus(page, ["running", "complete"], 30_000);
    const etas: { at: number; etaS: number }[] = [];
    for (;;) {
        const state = await ui(page);
        const eta = /ETA (\d+):(\d+)/.exec(state.progressText);
        if (eta) etas.push({ at: Date.now() - start, etaS: Number(eta[1]) * 60 + Number(eta[2]) });
        if (state.status === "complete" || state.status === "stopped" || state.error) break;
        await sleep(250);
    }
    return { ms: Date.now() - start, etas };
}

async function playToEnd(page: Page) {
    await page.evaluate(() => {
        const w = window as unknown as { __pre: number[][]; __preObserved?: boolean };
        w.__pre = [];
        if (w.__preObserved) return;
        w.__preObserved = true;
        const stage = document.querySelector(".media-stage") as HTMLElement;
        new MutationObserver(() => {
            const { drawTime, resultTime, boxes } = stage.dataset;
            (window as unknown as { __pre: number[][] }).__pre.push([
                Number(drawTime),
                resultTime ? Number(resultTime) : NaN,
                Number(boxes)
            ]);
        }).observe(stage, { attributes: true, attributeFilter: ["data-draw-time"] });
    });
    await page.click(".playback-button");
    await page.waitForFunction(() => (document.querySelector("video") as HTMLVideoElement).ended, {
        timeout: 120_000
    });
    const draws = await page.evaluate(() => (window as unknown as { __pre: number[][] }).__pre.splice(0));
    // After "ended", currentTime is the duration, past the last frame's time: not a frame on screen.
    const duration = await page.$eval("video", (v) => v.duration);
    const playing = draws.filter(([draw, result]) => !Number.isNaN(result) && draw < duration - 0.001);
    const offsets = playing.map(([draw, result]) => Math.round((draw - result) * 1000));
    const histogram: Record<number, number> = {};
    for (const o of offsets) histogram[o] = (histogram[o] ?? 0) + 1;
    return {
        draws: draws.length,
        withBoxes: draws.filter(([, , boxes]) => boxes > 0).length,
        maxOffsetMs: Math.max(0, ...offsets),
        offsetHistogramMs: histogram,
        largeOffsets: playing.filter(([draw, result]) => draw - result > 0.034).map(([draw, result]) => [draw, result])
    };
}

mkdirSync(OUT, { recursive: true });
if (!existsSync(ROTATED)) {
    // Like a phone's portrait video: the pixels are stored sideways and a rotation tag displays them upright.
    const sideways = resolve(OUT, "steady-sideways.tmp.mp4");
    const ffmpeg = (...ffArgs: string[]) => execFileSync("ffmpeg", ["-loglevel", "error", "-y", ...ffArgs]);
    ffmpeg(
        "-t",
        "5",
        "-i",
        "test-vid/steady.mp4",
        "-vf",
        "scale=1280:720,transpose=1",
        "-c:v",
        "libx264",
        "-crf",
        "20",
        "-an",
        sideways
    );
    ffmpeg("-display_rotation", "90", "-i", sideways, "-c", "copy", ROTATED);
}
const server = await serveApp(PORT, args.has("--build"));
const browser = await launchChrome(args.has("--headed"));
const page = await browser.newPage();
const errors = collectErrors(page);
const measured: Record<string, unknown> = {};
const speed: Record<string, unknown>[] = [];

try {
    await page.setViewport({ width: 1400, height: 1100 });
    await page.goto(server.url, { waitUntil: "load" });
    if (BACKEND === "wasm") await setSelect(page, "backend", 2);
    measured.model = await waitForModel(page);

    if (args.has("--speed")) {
        for (const clip of ALL_CLIPS) {
            await loadClip(page, resolve("test-vid", clip));
            await setMode(page, "pre");
            const run = await analyze(page);
            const state = await ui(page);
            const duration = await page.$eval("video", (v) => v.duration);
            const debug = await page.$eval(".debug-readout", (dl) => dl.textContent ?? "");
            const firstEta = run.etas.find((e) => e.at > 1000);
            speed.push({
                clip,
                seconds: +(run.ms / 1000).toFixed(1),
                xRealtime: +(duration / (run.ms / 1000)).toFixed(2),
                frames: /(\d+) \/ (\d+) frames/.exec(state.progressText)?.[0],
                etaAfter1s: firstEta
                    ? `${firstEta.etaS} s predicted, ${((run.ms - firstEta.at) / 1000).toFixed(1)} s actual`
                    : null,
                cache: /Pre-analysis cache([\d.]+ MiB)/.exec(debug)?.[1],
                totals: state.totals
            });
            console.error(`${clip}: ${JSON.stringify(speed.at(-1))}`);
        }
    } else {
        await loadClip(page, resolve("test-vid", "steady-2.mp4"));
        const loaded = await ui(page);
        check("realtime is the default mode", loaded.mode === "realtime" && !loaded.playDisabled, loaded.mode);

        await setMode(page, "pre");
        await sleep(300);
        const idle = await ui(page);
        check(
            "pre-analysis: idle, Start shown, playback locked, no Reset",
            idle.status === "idle" &&
                idle.startLabel === "Start analysis" &&
                idle.playDisabled &&
                idle.scrubberDisabled &&
                !idle.resetVisible,
            idle
        );

        // Start; try to play while running; Stop at ~40%.
        await page.click(".analysis-start");
        await waitStatus(page, ["running"]);
        await page.waitForFunction(
            () => Number((document.querySelector(".analysis-progress") as HTMLProgressElement).value) >= 40,
            { timeout: 120_000, polling: 50 }
        );
        const running = await ui(page);
        await page.$eval(".playback-button", (b) => (b as HTMLButtonElement).click());
        await page.keyboard.press("Space");
        await sleep(300);
        const stillLocked = await ui(page);
        check(
            "running: progress with frames, elapsed and ETA; playback stays locked",
            running.status === "running" &&
                /ETA \d+:\d+/.test(running.progressText) &&
                stillLocked.paused &&
                stillLocked.time === 0,
            { progress: running.progressText, paused: stillLocked.paused }
        );
        await page.click(".analysis-stop");
        await waitStatus(page, ["stopped"]);
        const stopped = await ui(page);
        check(
            "Stop: partial result kept, labeled incomplete, still locked, Resume offered",
            stopped.totalTitle === "Total (incomplete)" &&
                stopped.total > 0 &&
                stopped.playDisabled &&
                stopped.startLabel === "Resume analysis" &&
                stopped.message.startsWith("Stopped at"),
            {
                title: stopped.totalTitle,
                totals: stopped.totals,
                message: stopped.message,
                progress: stopped.progressText
            }
        );

        // Resume to the end.
        const resumed = await analyze(page);
        const complete = await ui(page);
        const framesMatch = /(\d+) \/ (\d+) frames/.exec(complete.progressText);
        check(
            "Resume completes: 100%, all frames, playback unlocked, whole-video totals before playing",
            complete.status === "complete" &&
                complete.progressValue === 100 &&
                framesMatch !== null &&
                framesMatch[1] === framesMatch[2] &&
                !complete.playDisabled &&
                complete.totalTitle === "Total (whole video)" &&
                complete.time === 0,
            { progress: complete.progressText, message: complete.message, totals: complete.totals }
        );
        measured.resumeSeconds = resumed.ms / 1000;
        measured.completeMessage = complete.message;
        const totalsA = complete.totals;
        await (await page.$(".media-stage"))?.screenshot({ path: `${OUT}/pre__steady-2_t0.png` });

        // Play twice: totals never change; boxes match the frame on screen.
        const play1 = await playToEnd(page);
        const after1 = await ui(page);
        const play2 = await playToEnd(page);
        const after2 = await ui(page);
        measured.playback = { play1, play2 };
        check(
            "playback: identical totals on every playthrough",
            JSON.stringify(after1.totals) === JSON.stringify(totalsA) &&
                JSON.stringify(after2.totals) === JSON.stringify(totalsA),
            { before: totalsA, after1: after1.totals, after2: after2.totals }
        );
        check(
            "playback: boxes from the cached sample of the frame on screen (all within the frame, ≥ 99% exact)",
            [play1, play2].every(
                (p) =>
                    p.withBoxes > p.draws * 0.5 &&
                    p.maxOffsetMs < 33 &&
                    (p.offsetHistogramMs[0] ?? 0) >=
                        0.99 * Object.values(p.offsetHistogramMs).reduce((a, b) => a + b, 0)
            ),
            play1
        );

        // Paused mid-video: Current frame from the cache.
        await page.$eval(".playback-scrubber", (el) => {
            (el as HTMLInputElement).value = "7.5";
            el.dispatchEvent(new Event("input"));
        });
        await sleep(800);
        const pausedMid = await ui(page);
        check(
            "paused: Current frame counts from the cache",
            pausedMid.currentVisible && pausedMid.current.length > 0,
            pausedMid.current
        );

        // Determinism: a second, uninterrupted analysis of the same file.
        await loadClip(page, resolve("test-vid", "steady-2.mp4"));
        await setMode(page, "pre");
        const oneGo = await analyze(page);
        const fresh = await ui(page);
        measured.uninterruptedSeconds = oneGo.ms / 1000;
        measured.etaSamples = oneGo.etas.slice(0, 8);
        check(
            "deterministic: an uninterrupted analysis gives the same totals as Stop + Resume",
            JSON.stringify(fresh.totals) === JSON.stringify(totalsA),
            { stopResume: totalsA, uninterrupted: fresh.totals }
        );

        // Tracking-only change: stale, cache kept; Re-analyze re-runs tracking only (fast).
        await setRange(page, "confidenceThreshold", 0.8); // above the 35% default: fewer objects
        await sleep(300);
        const staleTracking = await ui(page);
        check(
            "confidence change: stale prompt (tracking), cached totals kept, still playable",
            staleTracking.status === "stale" &&
                staleTracking.staleText.includes("re-runs tracking") &&
                JSON.stringify(staleTracking.totals) === JSON.stringify(totalsA) &&
                !staleTracking.playDisabled,
            { status: staleTracking.status, text: staleTracking.staleText }
        );
        const retrackStart = Date.now();
        await page.click(".analysis-reanalyze");
        await waitStatus(page, ["complete"]);
        const retracked = await ui(page);
        measured.retrackMs = Date.now() - retrackStart;
        check(
            "Re-analyze (tracking only): complete again in under 2 s, new totals",
            retracked.status === "complete" &&
                (measured.retrackMs as number) < 2000 &&
                retracked.total < staleTracking.total,
            { ms: measured.retrackMs, before: staleTracking.totals, after: retracked.totals }
        );

        // Class change and back: stale, then not stale.
        const toggleTransportation = () =>
            page.evaluate(() => {
                const group = [...document.querySelectorAll(".class-group")].find((g) =>
                    g.textContent?.includes("Transportation")
                );
                (group?.querySelector("input[type=checkbox]") as HTMLInputElement).click();
            });
        await toggleTransportation();
        await sleep(200);
        const staleClass = (await ui(page)).status;
        await toggleTransportation();
        await sleep(200);
        const back = (await ui(page)).status;
        check(
            "class change makes it stale; changing it back clears that",
            staleClass === "stale" && back === "complete",
            { staleClass, back }
        );

        // Full change: input size → Re-analyze runs the whole analysis (locked meanwhile).
        await setSelect(page, "inputSize", 0);
        await sleep(300);
        const staleFull = await ui(page);
        await page.click(".analysis-reanalyze");
        await waitStatus(page, ["running"]);
        const relocked = await ui(page);
        await waitStatus(page, ["complete"]);
        const reanalyzed = await ui(page);
        check(
            "input size change: stale (full); Re-analyze reruns everything with playback locked, then unlocks",
            staleFull.staleText.includes("whole analysis") && relocked.playDisabled && !reanalyzed.playDisabled,
            { stale: staleFull.staleText, totals: reanalyzed.totals }
        );
        await setSelect(page, "inputSize", 2);

        // Mode switch keeps the cache.
        await setMode(page, "realtime");
        await sleep(500);
        const realtime = await ui(page);
        await setMode(page, "pre");
        await sleep(300);
        const backToPre = await ui(page);
        check(
            "switching to realtime unlocks playback; switching back reuses the cache",
            realtime.mode === "realtime" &&
                !realtime.playDisabled &&
                realtime.resetVisible &&
                backToPre.status === "stale",
            {
                realtime: realtime.mode,
                backToPre: backToPre.status,
                note: "stale: input size was changed back after the last analysis"
            }
        );

        // Rotation-tagged file: analyzed in the displayed orientation (compare with realtime on the same frame).
        await loadClip(page, ROTATED);
        await page.waitForFunction(() => {
            const s = document.querySelector(".counts-current") as HTMLElement;
            return !s.hidden && !s.textContent?.includes("Detecting");
        });
        const realtimeFrame = await ui(page);
        await (await page.$(".media-stage"))?.screenshot({ path: `${OUT}/pre__rotated_realtime.png` });
        await setMode(page, "pre");
        await analyze(page);
        await sleep(500);
        const preFrame = await ui(page);
        await (await page.$(".media-stage"))?.screenshot({ path: `${OUT}/pre__rotated_pre.png` });
        const size = await page.$eval("video", (v) => [v.videoWidth, v.videoHeight]);
        check(
            "portrait (rotation-tagged) file: analyzed as displayed, same first-frame counts as realtime (screenshots: pre__rotated_*.png)",
            preFrame.status === "complete" && preFrame.current !== "" && preFrame.current === realtimeFrame.current,
            { displayed: size, realtime: realtimeFrame.current, pre: preFrame.current }
        );
    }
} finally {
    await browser.close();
    await server.close();
}

if (speed.length) {
    console.log(`\n| clip | analysis s | × realtime | frames | ETA after 1 s | cache | totals (${BACKEND}) |`);
    console.log("|---|---|---|---|---|---|---|");
    for (const r of speed as Record<string, never>[]) {
        const totals = Object.entries(r.totals as Record<string, number>)
            .map(([k, v]) => `${v} ${k}`)
            .join(", ");
        console.log(
            `| ${r.clip} | ${r.seconds} | ${r.xRealtime} | ${r.frames} | ${r.etaAfter1s} | ${r.cache} | ${totals} |`
        );
    }
}
console.log("\nmeasured:", JSON.stringify(measured, null, 2));
for (const [name, ok, detail] of results) console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail}`);
console.log("errors:", errors.length ? errors : "none");
if (results.some(([, ok]) => !ok) || errors.length) process.exitCode = 1;
