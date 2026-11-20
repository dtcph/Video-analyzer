/**
 * Keyboard check in the installed Chrome: Tab order on the start screen and
 * the analysis page, a visible focus ring on everything Tab reaches, both
 * pop-ups opened and closed from the keyboard (focus goes in, stays inside,
 * returns to the button on Esc and on a click outside), and the back arrow.
 *
 *   node scripts/e2e/keyboardFlow.ts [--build] [--headed]
 */
import { resolve } from "node:path";
import type { Page } from "puppeteer-core";
import { collectErrors, launchChrome, serveApp, uploadFile, waitForModel } from "./harness.ts";

const args = new Set(process.argv.slice(2));
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
let failures = 0;
function check(name: string, ok: boolean, detail?: unknown): void {
    if (!ok) failures++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail === undefined ? "" : `  ${JSON.stringify(detail)}`}`);
}

interface Focus {
    name: string;
    ring: boolean;
}

/** What has the focus: a short name, and whether a focus ring is drawn. */
const focused = (page: Page): Promise<Focus> =>
    page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return { name: "body", ring: false };
        const style = getComputedStyle(el);
        const label = el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 20) ?? "";
        return {
            name: `${el.tagName.toLowerCase()}${el.className ? `.${String(el.className).split(" ")[0]}` : ""}${label ? ` (${label})` : ""}`,
            ring: style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) >= 1.5
        };
    });

const insideOverlay = (page: Page, selector: string) =>
    page.evaluate((s) => document.querySelector(s)?.contains(document.activeElement) ?? false, selector);

const server = await serveApp(5195, args.has("--build"));
const browser = await launchChrome(args.has("--headed"));
try {
    const page = await browser.newPage();
    const errors = collectErrors(page);
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(server.url, { waitUntil: "load" });
    await waitForModel(page);

    // Start screen.
    const start: Focus[] = [];
    for (let i = 0; i < 3; i++) {
        await page.keyboard.press("Tab");
        start.push(await focused(page));
    }
    check(
        "start screen: Tab reaches the scroll link, then the two round buttons",
        start[0].name.startsWith("a.landing-scroll") &&
            start[1].name.includes("Photo or video") &&
            start[2].name.includes("camera"),
        start.map((f) => f.name)
    );
    check(
        "start screen: a focus ring on each",
        start.every((f) => f.ring),
        start
    );

    // Analysis page (a video).
    await uploadFile(page, resolve("test-vid", "steady-2.mp4"));
    await page.waitForFunction(() => document.documentElement.dataset.view === "analysis");
    await sleep(1500);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const order: Focus[] = [];
    for (let i = 0; i < 40; i++) {
        await page.keyboard.press("Tab");
        order.push(await focused(page));
        if (order.at(-1)?.name.includes("settings-open")) break;
    }
    const names = order.map((f) => f.name);
    const at = (part: string) => names.findIndex((n) => n.includes(part));
    check(
        "analysis page: Tab order is back arrow, play, seek, result, then the class list, then settings",
        at("back-link") === 0 &&
            at("playback-button") < at("playback-scrubber") &&
            at("playback-scrubber") < at("result-open") &&
            at("result-open") < at("settings-open") &&
            at("settings-open") > 0,
        names.slice(0, 6)
    );
    check(
        "analysis page: a focus ring on everything Tab reaches",
        order.every((f) => f.ring),
        order.filter((f) => !f.ring).map((f) => f.name)
    );

    // Result dialog from the keyboard.
    await page.focus(".result-open");
    await page.keyboard.press("Enter");
    await sleep(800);
    const inResult = await focused(page);
    check(
        "result dialog: Enter opens it and the focus moves to its close button",
        (await page.$eval(".result-overlay", (el) => (el as HTMLElement).dataset.state)) === "open" &&
            inResult.name.includes("result-close"),
        inResult.name
    );
    let stays = true;
    for (let i = 0; i < 6; i++) {
        await page.keyboard.press("Tab");
        stays &&= await insideOverlay(page, ".result-overlay");
    }
    await page.keyboard.down("Shift");
    await page.keyboard.press("Tab");
    await page.keyboard.up("Shift");
    stays &&= await insideOverlay(page, ".result-overlay");
    check("result dialog: Tab and Shift+Tab stay inside", stays);
    await page.keyboard.press("Escape");
    await sleep(700);
    check(
        "result dialog: Esc closes it and the focus returns to the result button",
        (await focused(page)).name.includes("result-open"),
        (await focused(page)).name
    );

    // Settings dialog from the keyboard, closed by Esc and by a click outside.
    await page.focus(".settings-open");
    await page.keyboard.press("Enter");
    await sleep(800);
    check(
        "settings dialog: Enter opens it and the focus moves in",
        (await focused(page)).name.includes("settings-close"),
        (await focused(page)).name
    );
    const settingsPath: string[] = [];
    let settingsStays = true;
    for (let i = 0; i < 12; i++) {
        await page.keyboard.press("Tab");
        settingsPath.push((await focused(page)).name);
        settingsStays &&= await insideOverlay(page, ".settings-overlay");
    }
    check(
        "settings dialog: 12 Tab presses stay inside (also past the collapsed sections)",
        settingsStays,
        settingsPath
    );
    await page.keyboard.press("Escape");
    await sleep(700);
    check(
        "settings dialog: Esc closes it and the focus returns to the gear",
        (await focused(page)).name.includes("settings-open"),
        (await focused(page)).name
    );
    await page.keyboard.press("Enter");
    await sleep(800);
    await page.mouse.click(10, 10);
    await sleep(700);
    check(
        "settings dialog: a click outside closes it and the focus returns to the gear",
        (await page.$eval(".settings-overlay", (el) => (el as HTMLElement).dataset.state)) === "closed" &&
            (await focused(page)).name.includes("settings-open"),
        (await focused(page)).name
    );

    // Back arrow from the keyboard.
    await page.focus(".back-link");
    await page.keyboard.press("Enter");
    await sleep(600);
    const back = await page.evaluate(() => ({
        view: document.documentElement.dataset.view,
        y: Math.round(scrollY),
        h: innerHeight
    }));
    check(
        "back arrow: Enter returns to the start screen, scrolled to the options",
        back.view === "landing" && back.y === back.h,
        back
    );
    check("no console or page errors", errors.length === 0, errors);
} finally {
    await browser.close();
    await server.close();
}
console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exitCode = failures === 0 ? 0 : 1;
