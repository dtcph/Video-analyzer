/**
 * Full walk through the app in the installed Chrome, at 1440×900 and 1920×1080:
 * start screen → photo → back arrow → video → settings and result pop-up →
 * back → camera (Chrome's fake camera showing test-vid/steady-2.mp4).
 * Checks the view changes, the scroll to the start options, the footer links
 * on both pages and that nothing logs an error; saves a screenshot of every
 * state to .cache/e2e/walkthrough/.
 *
 *   node scripts/e2e/walkthrough.ts [--build] [--headed]
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "puppeteer-core";
import { backToStart, collectErrors, launchChrome, serveApp, uploadFile, waitForModel } from "./harness.ts";

const args = new Set(process.argv.slice(2));
const OUT = ".cache/e2e/walkthrough";
const CAMERA_FILE = resolve(".cache/e2e", "webcam-steady-2.mjpeg");
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
const VIEWPORTS = [
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 }
];

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown): void {
    if (!ok) failures++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail === undefined ? "" : `  ${JSON.stringify(detail)}`}`);
}

const view = (page: Page) => page.evaluate(() => document.documentElement.dataset.view);

async function openClose(page: Page, trigger: string, shot: string): Promise<void> {
    await page.click(trigger);
    await sleep(2200);
    await page.screenshot({ path: shot });
    await page.keyboard.press("Escape");
    await sleep(700);
}

/** The AGPL footer: the source link and the notices link are there, visible, and the notices file is served. */
async function footerOk(page: Page, baseUrl: string): Promise<{ ok: boolean; detail: unknown }> {
    const links = await page.evaluate(() =>
        [...document.querySelectorAll(".app-footer a")]
            .filter((a) => (a as HTMLElement).offsetParent !== null || getComputedStyle(a).position === "fixed")
            .map((a) => ({ text: a.textContent?.trim(), href: (a as HTMLAnchorElement).href }))
    );
    const notices = links.find((l) => l.text === "Third-party notices");
    const source = links.find((l) => l.text === "source code");
    const status = notices ? (await fetch(new URL(notices.href, baseUrl))).status : 0;
    return { ok: Boolean(source?.href.includes("github.com") && notices && status === 200), detail: { links, status } };
}

mkdirSync(OUT, { recursive: true });
if (!existsSync(CAMERA_FILE)) {
    execFileSync("ffmpeg", [
        "-loglevel",
        "error",
        "-y",
        // The fake camera loops the file: a loop point inside a test is a scene cut. 4 × 15.7 s outlasts a run.
        "-stream_loop",
        "3",
        "-i",
        "test-vid/steady-2.mp4",
        "-vf",
        "fps=24",
        "-q:v",
        "4",
        CAMERA_FILE
    ]);
}
const server = await serveApp(5196, args.has("--build"));
const browser = await launchChrome(args.has("--headed"), [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    `--use-file-for-fake-video-capture=${CAMERA_FILE}`
]);
try {
    for (const size of VIEWPORTS) {
        const tag = `${size.width}x${size.height}`;
        const page = await browser.newPage();
        const pageErrors = collectErrors(page);
        await page.setViewport(size);
        await page.goto(server.url, { waitUntil: "load" });
        await waitForModel(page);

        check(`${tag} start screen: landing view`, (await view(page)) === "landing");
        await page.screenshot({ path: `${OUT}/${tag}-1-start.png` });
        await page.evaluate(() => document.getElementById("choose")?.scrollIntoView());
        await sleep(600);
        await page.screenshot({ path: `${OUT}/${tag}-2-options.png` });
        const optionsFooter = await footerOk(page, server.url);
        check(`${tag} AGPL footer on the start options`, optionsFooter.ok, optionsFooter.detail);

        // Photo.
        await uploadFile(page, resolve("test-img", "moving_car_t2.0.jpg"));
        await page.waitForFunction(() => document.documentElement.dataset.view === "analysis");
        await page.waitForFunction(() => document.querySelector(".counts-summary") !== null, { timeout: 60_000 });
        await sleep(800);
        await page.screenshot({ path: `${OUT}/${tag}-3-photo.png` });
        const photoBox = await page.evaluate(() => {
            const box = document.querySelector(".analysis-box")?.getBoundingClientRect();
            const img = document.querySelector(".media-image")?.getBoundingClientRect();
            return { box: [box?.width, box?.height], img: [img?.width, img?.height] };
        });
        const analysisFooter = await footerOk(page, server.url);
        check(`${tag} photo: analysis page, boxes counted, AGPL footer`, analysisFooter.ok, photoBox);
        await openClose(page, ".result-open", `${OUT}/${tag}-4-photo-result.png`);

        // Back arrow → the start options (scrolled to #choose).
        await backToStart(page);
        await sleep(500);
        const scroll = await page.evaluate(() => ({ y: Math.round(scrollY), h: innerHeight }));
        check(`${tag} back arrow: start screen scrolled to the options`, scroll.y === scroll.h, scroll);

        // Video, with settings and result pop-ups.
        await uploadFile(page, resolve("test-vid", "steady-2.mp4"));
        await page.waitForFunction(() => document.documentElement.dataset.view === "analysis");
        await page.click(".playback-button");
        await sleep(5000);
        await page.screenshot({ path: `${OUT}/${tag}-5-video.png` });
        await openClose(page, ".settings-open", `${OUT}/${tag}-6-video-settings.png`);
        await openClose(page, ".result-open", `${OUT}/${tag}-7-video-result.png`);
        const videoBox = await page.evaluate(() => {
            const box = document.querySelector(".analysis-box")?.getBoundingClientRect();
            return {
                box: [Math.round(box?.width ?? 0), Math.round(box?.height ?? 0)],
                scrolls: document.documentElement.scrollHeight > innerHeight
            };
        });
        check(`${tag} video: the page fits the viewport without scrolling`, !videoBox.scrolls, videoBox);

        // Camera.
        await backToStart(page);
        await page.click(".choose-camera");
        await page.waitForFunction(() => document.documentElement.dataset.view === "analysis", { timeout: 20_000 });
        await sleep(6000);
        await page.screenshot({ path: `${OUT}/${tag}-8-camera.png` });
        await openClose(page, ".result-open", `${OUT}/${tag}-9-camera-result.png`);
        const live = await page.evaluate(() => (document.querySelector(".webcam-panel") as HTMLElement).dataset.state);
        check(`${tag} camera: live on the analysis page`, live === "live", live);

        check(`${tag} no console or page errors`, pageErrors.length === 0, pageErrors);
        await page.close();
    }
} finally {
    await browser.close();
    await server.close();
}
console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}; screenshots in ${OUT}/`);
process.exitCode = failures === 0 ? 0 : 1;
