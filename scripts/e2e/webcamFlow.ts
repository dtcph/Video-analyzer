/**
 * End-to-end check of the webcam (Phase 5) in the installed Chrome, with
 * Chrome's fake camera instead of real hardware:
 *   --use-fake-device-for-media-stream=device-count=2   two fake cameras
 *   --use-file-for-fake-video-capture=<mjpeg>           both show test-vid/steady-2.mp4 (looped)
 *   --use-fake-ui-for-media-stream                      auto-accept the permission prompt
 *
 *   node scripts/e2e/webcamFlow.ts [--build] [--headed] [--backend wasm]
 *
 * Checks: start, live counting, device picker + switch (totals kept), pause
 * (Current frame, totals frozen, tracks continue after resume), stop (camera
 * released, totals kept), restart (counting continues), disconnect, a file
 * load releasing the camera, Reset, and every error message (permission
 * denied for real in a second browser without auto-accept; the other
 * getUserMedia failures injected).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { Browser, Page } from "puppeteer-core";
import { collectErrors, debugText, launchChrome, serveApp, setSelect, uploadFile, waitForModel } from "./harness.ts";

const argv = process.argv.slice(2);
const args = new Set(argv);
const BACKEND = argv.includes("--backend") ? argv[argv.indexOf("--backend") + 1] : "auto";
const PORT = 5197;
const OUT = ".cache/e2e";
const CAMERA_FILE = resolve(OUT, "webcam-steady-2.mjpeg");
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

interface TraceEntry {
    t: number;
    ids: number[];
}

declare global {
    interface Window {
        __camTrace: TraceEntry[];
        __lastTrack: MediaStreamTrack | null;
    }
}

const results: [string, boolean, string][] = [];
const check = (name: string, ok: boolean, detail: unknown) => {
    results.push([name, ok, JSON.stringify(detail)]);
    console.error(`${ok ? "PASS" : "FAIL"}  ${name}`);
};

async function state(page: Page) {
    return page.evaluate(() => {
        const panel = document.querySelector(".webcam-panel") as HTMLElement;
        const video = document.querySelector("video") as HTMLVideoElement;
        const totals: Record<string, number> = {};
        document.querySelectorAll(".counts-total .counts-row").forEach((row) => {
            const label = row.querySelector(".counts-label")?.firstChild?.textContent?.trim() ?? "?";
            totals[label] = Number(row.querySelector(".counts-value")?.textContent);
        });
        const visible = (selector: string) => !(document.querySelector(selector) as HTMLElement).hidden;
        return {
            webcam: panel.dataset.state,
            status: (panel.querySelector(".webcam-status") as HTMLElement).textContent,
            error: visible(".webcam-error") ? (panel.querySelector(".webcam-error") as HTMLElement).textContent : "",
            devices: [...panel.querySelectorAll(".webcam-device option")].map((o) => o.textContent),
            pickerVisible: visible(".webcam-device"),
            stageVisible: visible(".media-stage"),
            hasStream: video.srcObject !== null,
            paused: video.paused,
            lastTrackState: window.__lastTrack?.readyState ?? null,
            totals,
            total: Object.values(totals).reduce((a, b) => a + b, 0),
            totalText: (document.querySelector(".counts-total") as HTMLElement).textContent?.trim() ?? "",
            currentVisible: visible(".counts-current"),
            current: (document.querySelector(".counts-current") as HTMLElement).textContent?.trim() ?? "",
            resetVisible: visible(".counts-reset")
        };
    });
}

/** Records the camera's track handle (to check it is released) and the track IDs of every tracker update. */
async function instrument(page: Page): Promise<void> {
    await page.evaluate(() => {
        window.__camTrace = [];
        window.__lastTrack = null;
        const stage = document.querySelector(".media-stage") as HTMLElement;
        stage.dataset.trace = "1";
        stage.addEventListener("trackerupdate", (event) => {
            const detail = (event as CustomEvent).detail as {
                mediaTime: number;
                tracks: { id: number; state: string }[];
            };
            window.__camTrace.push({
                t: detail.mediaTime,
                ids: detail.tracks.filter((t) => t.state === "confirmed").map((t) => t.id)
            });
        });
        const video = document.querySelector("video") as HTMLVideoElement;
        video.addEventListener("loadedmetadata", () => {
            const stream = video.srcObject as MediaStream | null;
            if (stream) window.__lastTrack = stream.getVideoTracks()[0];
        });
    });
}

async function waitWebcam(page: Page, wanted: string, timeout = 20_000): Promise<void> {
    await page.waitForFunction(
        (w) => (document.querySelector(".webcam-panel") as HTMLElement).dataset.state === w,
        { timeout },
        wanted
    );
}

async function startCamera(page: Page): Promise<void> {
    await page.click(".webcam-start");
    await waitWebcam(page, "live");
}

async function injectFailure(page: Page, name: string): Promise<void> {
    await page.evaluate((errorName) => {
        const media = navigator.mediaDevices as MediaDevices & { __real?: MediaDevices["getUserMedia"] };
        media.__real ??= media.getUserMedia.bind(media);
        media.getUserMedia = () => Promise.reject(new DOMException("injected", errorName));
    }, name);
}

async function restoreGetUserMedia(page: Page): Promise<void> {
    await page.evaluate(() => {
        const media = navigator.mediaDevices as MediaDevices & { __real?: MediaDevices["getUserMedia"] };
        if (media.__real) media.getUserMedia = media.__real;
    });
}

mkdirSync(OUT, { recursive: true });
if (!existsSync(CAMERA_FILE)) {
    // Chrome's fake capture plays MJPEG (or Y4M) files; 720p at 24 fps keeps the file small.
    execFileSync("ffmpeg", [
        "-loglevel",
        "error",
        "-y",
        "-i",
        "test-vid/steady-2.mp4",
        "-vf",
        "fps=24",
        "-q:v",
        "4",
        CAMERA_FILE
    ]);
}

const server = await serveApp(PORT, args.has("--build"));
const browsers: Browser[] = [];
const errors: string[] = [];
const measured: Record<string, unknown> = {};

try {
    const browser = await launchChrome(args.has("--headed"), [
        "--use-fake-device-for-media-stream=device-count=2",
        "--use-fake-ui-for-media-stream",
        `--use-file-for-fake-video-capture=${CAMERA_FILE}`
    ]);
    browsers.push(browser);
    const page = await browser.newPage();
    const pageErrors = collectErrors(page);
    await page.setViewport({ width: 1400, height: 1000 });
    await page.goto(server.url, { waitUntil: "load" });
    if (BACKEND === "wasm") await setSelect(page, "backend", 2);
    measured.model = await waitForModel(page);
    await instrument(page);

    const idle = await state(page);
    check("camera off at load, Start shown", idle.webcam === "off" && !idle.stageVisible, idle);

    // Start and count live.
    await startCamera(page);
    await sleep(6000);
    const live = await state(page);
    const debug = await debugText(page);
    Object.assign(measured, {
        inferenceFps: debug["Inference FPS"],
        sampledDropped: debug["Sampled frames dropped"],
        latency: debug["Latency capture→result"],
        timings: debug["ms pre / infer / post"],
        cameraMode: debug["Camera mode (asked)"],
        tracker: debug["Tracks tentative / confirmed / lost"],
        liveTotals: live.totals
    });
    check(
        "live: stream shown, status, totals grow, no Current frame",
        live.webcam === "live" && live.hasStream && Boolean(live.status) && live.total > 0 && !live.currentVisible,
        { status: live.status, totals: live.totals }
    );
    await (await page.$(".media-stage"))?.screenshot({ path: `${OUT}/webcam__live.png` });

    // Pause: Current frame for the frozen picture, totals frozen.
    const beforePause = await page.evaluate(() => window.__camTrace.at(-1) ?? null);
    await page.click(".webcam-pause");
    await waitWebcam(page, "paused");
    await page.waitForFunction(() => {
        const section = document.querySelector(".counts-current") as HTMLElement;
        return !section.hidden && !section.textContent?.includes("Detecting");
    });
    const paused1 = await state(page);
    const exact = await page.$eval(".media-stage", (stage) => {
        const { drawTime, resultTime } = (stage as HTMLElement).dataset;
        return resultTime !== "" && Math.abs(Number(drawTime) - Number(resultTime)) < 0.002;
    });
    await sleep(3000);
    const paused2 = await state(page);
    check(
        "pause: Current frame of the frozen picture, totals frozen",
        paused1.currentVisible && exact && paused1.total === paused2.total && paused2.paused,
        { current: paused1.current, exact, totals: [paused1.total, paused2.total] }
    );

    // Resume after the 3 s pause: confirmed tracks continue with their IDs (the paused time is skipped).
    const traceLength = await page.evaluate(() => window.__camTrace.length);
    await page.click(".webcam-pause");
    await waitWebcam(page, "live");
    await sleep(1500);
    const afterResume = await page.evaluate((from) => window.__camTrace.slice(from), traceLength);
    const firstAfter = afterResume[0];
    const kept = beforePause && firstAfter ? beforePause.ids.filter((id) => firstAfter.ids.includes(id)) : [];
    const gap = beforePause && firstAfter ? firstAfter.t - beforePause.t : null;
    measured.resume = { confirmedBefore: beforePause?.ids.length, keptAfter: kept.length, streamGapSeconds: gap };
    check(
        "resume: ≥ 25% of confirmed tracks keep their IDs across a 3 s pause (traffic keeps moving; without the skip: 10%)",
        Boolean(
            beforePause && firstAfter && beforePause.ids.length > 0 && kept.length >= beforePause.ids.length * 0.25
        ),
        measured.resume
    );

    // Stop: camera released, totals kept.
    await page.click(".webcam-stop");
    await waitWebcam(page, "off");
    const stopped = await state(page);
    check(
        "stop: camera released, stage hidden, totals kept with Reset",
        stopped.lastTrackState === "ended" &&
            !stopped.hasStream &&
            !stopped.stageVisible &&
            stopped.total > 0 &&
            stopped.resetVisible &&
            stopped.totalText.includes("Camera stopped"),
        { track: stopped.lastTrackState, totals: stopped.total, text: stopped.totalText.slice(-90) }
    );

    // Restart: counting continues from the kept totals.
    await startCamera(page);
    await sleep(3000);
    const restarted = await state(page);
    check("restart: counting continues (not reset)", restarted.total >= stopped.total, {
        stopped: stopped.total,
        restarted: restarted.total
    });

    // Reset counts while live.
    await page.click(".counts-reset");
    await sleep(200);
    const reset = await state(page);
    check("Reset counts clears totals while live", reset.total < restarted.total, {
        before: restarted.total,
        after: reset.total
    });

    // Disconnect (the track ends without stop(): unplugged camera).
    await page.evaluate(() => window.__lastTrack?.dispatchEvent(new Event("ended")));
    await waitWebcam(page, "off");
    const unplugged = await state(page);
    check(
        "disconnect: message, camera released, totals kept",
        unplugged.error.includes("disconnected") && unplugged.lastTrackState === "ended" && !unplugged.hasStream,
        { error: unplugged.error, track: unplugged.lastTrackState }
    );

    // Loading a file releases the camera and starts fresh.
    await startCamera(page);
    await sleep(1500);
    await uploadFile(page, resolve("test-vid", "steady.mp4"));
    await page.waitForFunction(() => (document.querySelector("video") as HTMLVideoElement).readyState >= 2);
    const file = await state(page);
    check(
        "file load: camera released, fresh totals",
        file.webcam === "off" && file.lastTrackState === "ended" && file.total === 0,
        { webcam: file.webcam, track: file.lastTrackState, totals: file.totals }
    );

    // Injected getUserMedia failures.
    for (const [name, expected] of [
        ["NotFoundError", "No camera was found"],
        ["NotReadableError", "in use by another application"],
        ["OverconstrainedError", "not available any more"]
    ]) {
        await injectFailure(page, name);
        await page.click(".webcam-start");
        await waitWebcam(page, "off");
        const failed = await state(page);
        check(
            `error ${name}: message shown, nothing running`,
            failed.error.includes(expected) && !failed.hasStream,
            failed.error
        );
    }
    await restoreGetUserMedia(page);
    errors.push(...pageErrors);

    // Device picker and switching: two fake pattern cameras (Chrome ignores device-count with a file).
    const twoCams = await launchChrome(args.has("--headed"), [
        "--use-fake-device-for-media-stream=device-count=2",
        "--use-fake-ui-for-media-stream"
    ]);
    browsers.push(twoCams);
    const camPage = await twoCams.newPage();
    const camErrors = collectErrors(camPage);
    await camPage.goto(server.url, { waitUntil: "load" });
    await waitForModel(camPage);
    await instrument(camPage);
    await startCamera(camPage);
    const twoLive = await state(camPage);
    check("device picker lists both cameras", twoLive.pickerVisible && twoLive.devices.length === 2, twoLive.devices);
    const firstTrack = await camPage.evaluateHandle(() => window.__lastTrack);
    const firstId = await camPage.evaluate((t) => t?.getSettings().deviceId, firstTrack);
    await camPage.$eval(".webcam-device", (el) => {
        const select = el as HTMLSelectElement;
        select.selectedIndex = (select.selectedIndex + 1) % select.options.length;
        select.dispatchEvent(new Event("change"));
    });
    await camPage.waitForFunction(
        (id) => {
            const track = window.__lastTrack;
            return track !== null && track.readyState === "live" && track.getSettings().deviceId !== id;
        },
        { timeout: 20_000 },
        firstId
    );
    await waitWebcam(camPage, "live");
    const oldTrackState = await camPage.evaluate((t) => t?.readyState, firstTrack);
    const twoSwitched = await state(camPage);
    check(
        "switch camera: other device live, old camera released, picker follows",
        oldTrackState === "ended" && twoSwitched.webcam === "live" && twoSwitched.devices.length === 2,
        { oldTrack: oldTrackState, status: twoSwitched.status }
    );
    errors.push(...camErrors);

    // Real permission denial: no auto-accept, so headless Chrome dismisses the prompt.
    const denyBrowser = await launchChrome(args.has("--headed"), ["--use-fake-device-for-media-stream"]);
    browsers.push(denyBrowser);
    const denyPage = await denyBrowser.newPage();
    const denyErrors = collectErrors(denyPage);
    await denyPage.goto(server.url, { waitUntil: "load" });
    await denyPage.click(".webcam-start");
    await waitWebcam(denyPage, "off", 30_000);
    const denied = await state(denyPage);
    check("permission denied (real prompt dismissed): message shown", denied.error.includes("denied"), denied.error);
    errors.push(...denyErrors.filter((e) => !e.includes("Permission")));
} finally {
    for (const browser of browsers) await browser.close();
    await server.close();
}

console.log("\nmeasured:", JSON.stringify(measured, null, 2));
for (const [name, ok, detail] of results) console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail}`);
console.log("errors:", errors.length ? errors : "none");
if (results.some(([, ok]) => !ok) || errors.length) process.exitCode = 1;
