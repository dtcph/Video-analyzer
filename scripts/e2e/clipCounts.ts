/**
 * Clip runner (Phase 4): plays each clip in test-vid/ to the end at 1× in the
 * real app (installed Chrome) and records what the tracker saw and counted.
 *
 *   node scripts/e2e/clipCounts.ts [--build] [--headed] [--clips a.mp4,b.mp4] [--fps 30]
 *       [--backend auto|wasm] [--confirm 3] [--lost 1] [--shots 3] [--label name]
 *
 * Per clip, writes .cache/e2e/clip-counts/<label>/<clip>.json with:
 * - totals shown in the panel at the end (per class),
 * - every tracker update: media time, all detections ≥ the low score (all
 *   classes, for offline replays with other parameters: scripts/e2e/sweepTracker.ts),
 * - per-track summary (first/last seen, hits, class, counted),
 * plus screenshots with track IDs every `--shots` seconds of media time.
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
const option = (name: string, fallback: string) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);

const ALL_CLIPS = [
    "moving_car.mp4",
    "moving_drone.mp4",
    "moving_drone-2.mp4",
    "moving_handheld.mp4",
    "moving_handheld-2.mp4",
    "steady.mp4",
    "steady-2.mp4"
];
const CLIPS = option("--clips", ALL_CLIPS.join(",")).split(",");
const FPS = Number(option("--fps", "30"));
const BACKEND = option("--backend", "auto");
const CONFIRM = option("--confirm", "");
const LOST = option("--lost", "");
const SHOT_EVERY = Number(option("--shots", "3"));
const LABEL = option("--label", `${BACKEND}-${FPS}fps`);
const PORT = 5195;
const OUT = `.cache/e2e/clip-counts/${LABEL}`;

/** One recorded tracker update; detections as [classId, score, x, y, w, h] (normalized). */
export interface TraceFrame {
    t: number;
    d: number[][];
    ms: number;
    tracks: { id: number; c: number; s: string; h: number; n: boolean }[];
    confirmed: { id: number; c: number }[];
}

declare global {
    interface Window {
        __trace: TraceFrame[];
    }
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function installTrace(page: Page): Promise<void> {
    await page.evaluate(() => {
        window.__trace = [];
        const stage = document.querySelector(".media-stage") as HTMLElement;
        if (stage.dataset.trace === "1") return; // listener already installed (earlier clip)
        stage.dataset.trace = "1";
        const round = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;
        stage.addEventListener("trackerupdate", (event) => {
            const detail = (event as CustomEvent).detail;
            window.__trace.push({
                t: detail.mediaTime,
                ms: round(detail.trackerMs, 3),
                d: detail.detections.map((d: { classId: number; score: number; box: Record<string, number> }) => [
                    d.classId,
                    round(d.score, 3),
                    round(d.box.x, 5),
                    round(d.box.y, 5),
                    round(d.box.width, 5),
                    round(d.box.height, 5)
                ]),
                tracks: detail.tracks.map(
                    (t: { id: number; classId: number; state: string; hits: number; counted: boolean }) => ({
                        id: t.id,
                        c: t.classId,
                        s: t.state[0],
                        h: t.hits,
                        n: t.counted
                    })
                ),
                confirmed: detail.newlyConfirmed.map((t: { id: number; classId: number }) => ({
                    id: t.id,
                    c: t.classId
                }))
            });
        });
    });
}

async function setCheckbox(page: Page, setting: string, checked: boolean): Promise<void> {
    await page.$eval(
        `[data-setting="${setting}"] input`,
        (el, value) => {
            const input = el as HTMLInputElement;
            input.checked = value;
            input.dispatchEvent(new Event("change"));
        },
        checked
    );
}

async function totals(page: Page): Promise<Record<string, number>> {
    return page.$eval(".counts-total", (el) => {
        const out: Record<string, number> = {};
        el.querySelectorAll(".counts-row").forEach((row) => {
            const label = row.querySelector(".counts-label")?.firstChild?.textContent?.trim() ?? "?";
            out[label] = Number(row.querySelector(".counts-value")?.textContent);
        });
        return out;
    });
}

/** Per-track lifetime from the trace. */
function summarizeTracks(trace: TraceFrame[]) {
    const tracks = new Map<
        number,
        {
            id: number;
            first: number;
            last: number;
            hits: number;
            classId: number;
            counted: boolean;
            confirmedAt?: number;
        }
    >();
    for (const frame of trace) {
        for (const t of frame.tracks) {
            const entry = tracks.get(t.id) ?? {
                id: t.id,
                first: frame.t,
                last: frame.t,
                hits: 0,
                classId: t.c,
                counted: false
            };
            if (t.s !== "l") entry.last = frame.t;
            entry.hits = t.h;
            entry.classId = t.c;
            entry.counted ||= t.n;
            tracks.set(t.id, entry);
        }
        for (const c of frame.confirmed) {
            const entry = tracks.get(c.id);
            if (entry) entry.confirmedAt = frame.t;
        }
    }
    return [...tracks.values()];
}

mkdirSync(OUT, { recursive: true });
const server = await serveApp(PORT, args.has("--build"));
const browser = await launchChrome(args.has("--headed"));
const page = await browser.newPage();
const errors = collectErrors(page);
const summary: Record<string, unknown>[] = [];

try {
    await page.setViewport({ width: 1400, height: 1000 });
    await page.goto(server.url, { waitUntil: "load" });
    if (BACKEND === "wasm") await setSelect(page, "backend", 2);
    const model = await waitForModel(page);
    await setRange(page, "maxInferenceFps", FPS);
    if (CONFIRM) await setRange(page, "confirmationFrames", Number(CONFIRM));
    if (LOST) await setRange(page, "lostBufferSeconds", Number(LOST));
    await setCheckbox(page, "showTrackIds", true);

    for (const clip of CLIPS) {
        const name = clip.replace(".mp4", "");
        await uploadFile(page, resolve("test-vid", clip));
        await page.waitForFunction(() => (document.querySelector("video") as HTMLVideoElement).readyState >= 2);
        await installTrace(page);
        // Wait for the paused first frame's detection, so playback starts from a settled state.
        await page.waitForFunction(
            () => !(document.querySelector(".counts-current") as HTMLElement).textContent?.includes("Detecting"),
            { timeout: 30_000 }
        );

        await page.click(".playback-button");
        const started = Date.now();
        let nextShot = SHOT_EVERY;
        for (;;) {
            const { time, ended } = await page.$eval("video", (v) => ({ time: v.currentTime, ended: v.ended }));
            if (ended) break;
            if (time >= nextShot) {
                await (await page.$(".media-stage"))?.screenshot({ path: `${OUT}/${name}__t${nextShot}.png` });
                nextShot += SHOT_EVERY;
            }
            if (Date.now() - started > 180_000) throw new Error(`${clip}: playback did not end`);
            await sleep(100);
        }
        await sleep(500);
        const debug = await debugText(page);
        const trace: TraceFrame[] = await page.evaluate(() => window.__trace);
        const shownTotals = await totals(page);
        const tracks = summarizeTracks(trace);
        const msValues = trace.map((f) => f.ms).sort((a, b) => a - b);
        const result = {
            clip,
            model,
            backend: debug["Backend"],
            maxFps: FPS,
            settings: { confirmationFrames: CONFIRM || "default", lostBufferSeconds: LOST || "default" },
            inferenceFps: debug["Inference FPS"],
            sampledDropped: debug["Sampled frames dropped"],
            updates: trace.length,
            trackerMsMedian: msValues[Math.floor(msValues.length / 2)] ?? null,
            trackerMsP95: msValues[Math.floor(msValues.length * 0.95)] ?? null,
            trackerMsMax: msValues.at(-1) ?? null,
            totals: shownTotals,
            tracksCreated: tracks.length,
            tracksCounted: tracks.filter((t) => t.counted).length
        };
        summary.push(result);
        writeFileSync(`${OUT}/${name}.json`, JSON.stringify({ ...result, tracks, trace }));
        console.error(`${clip}: ${JSON.stringify(shownTotals)} (${trace.length} updates, ${result.inferenceFps} fps)`);
    }
} finally {
    writeFileSync(`${OUT}/summary.json`, JSON.stringify({ errors, summary }, null, 2));
    await browser.close();
    await server.close();
}

console.log(
    "| clip | totals | tracks created / counted | updates | inference fps | dropped | tracker ms p50/p95/max |"
);
console.log("|---|---|---|---|---|---|---|");
for (const r of summary as Record<string, never>[]) {
    const t = Object.entries(r.totals as Record<string, number>)
        .map(([k, v]) => `${v} ${k}`)
        .join(", ");
    console.log(
        `| ${r.clip} | ${t} | ${r.tracksCreated} / ${r.tracksCounted} | ${r.updates} | ${r.inferenceFps} | ${r.sampledDropped} | ${r.trackerMsMedian}/${r.trackerMsP95}/${r.trackerMsMax} |`
    );
}
console.log("errors:", errors.length ? errors : "none");
