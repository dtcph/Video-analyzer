/**
 * End-to-end check of the Total section (Phase 4) in the installed Chrome:
 * totals appear while playing, pausing adds nothing, a seek keeps totals and
 * clears tracks, disabling a class marks its total "not counting" and stops
 * it growing, Reset counts clears totals.
 *
 *   node scripts/e2e/countsFlow.ts [--build] [--headed]
 */
import { resolve } from "node:path";
import type { Page } from "puppeteer-core";
import { collectErrors, launchChrome, serveApp, uploadFile, waitForModel } from "./harness.ts";

const args = new Set(process.argv.slice(2));
const PORT = 5196;
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function totals(page: Page): Promise<{ text: string; rows: Record<string, number>; inactive: string[] }> {
    return page.$eval(".counts-total", (el) => {
        const rows: Record<string, number> = {};
        const inactive: string[] = [];
        el.querySelectorAll(".counts-row").forEach((row) => {
            const label = row.querySelector(".counts-label")?.firstChild?.textContent?.trim() ?? "?";
            rows[label] = Number(row.querySelector(".counts-value")?.textContent);
            if (row.classList.contains("is-inactive")) inactive.push(label);
        });
        return { text: el.textContent?.trim() ?? "", rows, inactive };
    });
}

const sum = (rows: Record<string, number>) => Object.values(rows).reduce((a, b) => a + b, 0);
const results: [string, boolean, string][] = [];
const check = (name: string, ok: boolean, detail: unknown) => results.push([name, ok, JSON.stringify(detail)]);

const server = await serveApp(PORT, args.has("--build"));
const browser = await launchChrome(args.has("--headed"));
const page = await browser.newPage();
const errors = collectErrors(page);

try {
    await page.setViewport({ width: 1400, height: 1000 });
    await page.goto(server.url, { waitUntil: "load" });
    await waitForModel(page);
    await uploadFile(page, resolve("test-vid", "steady-2.mp4"));
    await page.waitForFunction(() => (document.querySelector("video") as HTMLVideoElement).readyState >= 2);
    await sleep(1000);

    const initial = await totals(page);
    const resetVisible = await page.$eval(".counts-reset", (b) => (b as HTMLElement).hidden === false);
    check("empty totals and Reset button after load", sum(initial.rows) === 0 && resetVisible, initial.text);

    await page.click(".playback-button");
    await sleep(3000);
    const playing = await totals(page);
    const currentHidden = await page.$eval(".counts-current", (s) => (s as HTMLElement).hidden === true);
    check("totals grow while playing; current frame hidden", sum(playing.rows) > 0 && currentHidden, playing.rows);

    await page.click(".playback-button");
    await sleep(1500);
    const paused = await totals(page);
    await sleep(1500);
    const stillPaused = await totals(page);
    check("pausing adds nothing", JSON.stringify(paused.rows) === JSON.stringify(stillPaused.rows), [
        paused.rows,
        stillPaused.rows
    ]);

    // Seek back while paused: totals stay.
    await page.$eval(".playback-scrubber", (el) => {
        (el as HTMLInputElement).value = "0.5";
        el.dispatchEvent(new Event("input"));
    });
    await sleep(1500);
    const afterSeek = await totals(page);
    const tracksAfterSeek = await page.$eval(".debug-readout", (dl) => {
        const dt = [...dl.querySelectorAll("dt")].find((d) => d.textContent?.startsWith("Tracks"));
        return dt?.nextElementSibling?.textContent ?? "";
    });
    check(
        "seek keeps totals, clears tracks",
        JSON.stringify(afterSeek.rows) === JSON.stringify(stillPaused.rows) && tracksAfterSeek === "0 / 0 / 0",
        { totals: afterSeek.rows, tracks: tracksAfterSeek }
    );

    // Disable Transportation: car total stays, marked inactive, and stops growing.
    await page.evaluate(() => {
        const group = [...document.querySelectorAll(".class-group")].find((g) =>
            g.textContent?.includes("Transportation")
        );
        (group?.querySelector("input[type=checkbox]") as HTMLInputElement).click();
    });
    await sleep(300);
    const disabled = await totals(page);
    const note = await page.$eval(
        ".class-panel .panel-note",
        (n) => (n as HTMLElement).hidden === false && Boolean(n.textContent?.includes("not recomputed"))
    );
    await page.click(".playback-button");
    await sleep(3000);
    await page.click(".playback-button");
    await sleep(800);
    const disabledLater = await totals(page);
    check(
        "disabled class: kept, 'not counting', frozen; note shown",
        disabled.inactive.includes("car") && disabledLater.rows.car === disabled.rows.car && note,
        { before: disabled.rows, after: disabledLater.rows, inactive: disabled.inactive, note }
    );

    await page.click(".counts-reset");
    await sleep(300);
    const reset = await totals(page);
    check("Reset counts clears totals", sum(reset.rows) === 0, reset.text);
} finally {
    await browser.close();
    await server.close();
}

for (const [name, ok, detail] of results) console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail}`);
console.log("errors:", errors.length ? errors : "none");
if (results.some(([, ok]) => !ok) || errors.length) process.exitCode = 1;
