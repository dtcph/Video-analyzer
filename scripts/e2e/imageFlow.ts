/**
 * End-to-end check of the image flow in the real app (Phase 2), in the installed Chrome:
 * upload each test-img/*.jpg, read the counts panel, toggle class groups, a single
 * class and the confidence threshold, then repeat the uploads on the WASM backend.
 *
 *   node scripts/e2e/imageFlow.ts [--build] [--headed]
 *
 * --build runs `vite build` and tests the production bundle via `vite preview`
 * (same COOP/COEP headers); otherwise the dev server. Writes .cache/e2e/image-flow.json
 * and screenshots of the stage to .cache/e2e/.
 */
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "puppeteer-core";
import { collectErrors, debugText, launchChrome, serveApp, setSelect, uploadFile, waitForModel } from "./harness.ts";

const args = new Set(process.argv.slice(2));
const PORT = 5196;
const OUT = ".cache/e2e";

interface CountRow {
    label: string;
    count: number;
}

async function readCounts(page: Page): Promise<{ summary: string; rows: CountRow[]; message: string }> {
    return page.$eval(".counts-panel", (panel) => ({
        summary: panel.querySelector(".counts-summary")?.textContent ?? "",
        rows: [...panel.querySelectorAll(".counts-total .counts-row")].map((row) => ({
            label: row.querySelector(".counts-label")?.textContent ?? "",
            count: Number(row.querySelector(".counts-value")?.textContent)
        })),
        message: panel.querySelector(".counts-total .panel-empty")?.textContent ?? ""
    }));
}

async function revision(page: Page): Promise<number> {
    return page.$eval(".counts-panel", (panel) => Number((panel as HTMLElement).dataset.revision ?? 0));
}

async function uploadAndWait(page: Page, file: string): Promise<void> {
    const before = await revision(page);
    await uploadFile(page, file);
    await page.waitForFunction(
        (rev) => {
            const panel = document.querySelector(".counts-panel") as HTMLElement;
            return (
                Number(panel.dataset.revision) > rev &&
                !panel.classList.contains("is-busy") &&
                panel.querySelector(".counts-total-title")?.textContent === "Total (this image)"
            );
        },
        { timeout: 60_000 },
        before
    );
}

async function clickGroup(page: Page, groupId: string): Promise<void> {
    await page.click(`.class-group[data-group="${groupId}"] .class-group-header input`);
}

const stills = readdirSync("test-img")
    .filter((name) => name.endsWith(".jpg"))
    .sort()
    .map((name) => resolve("test-img", name));
if (stills.length === 0) throw new Error("no test-img/*.jpg");
mkdirSync(OUT, { recursive: true });

const server = await serveApp(PORT, args.has("--build"));
const browser = await launchChrome(args.has("--headed"));
let errors: string[] = [];
const report: Record<string, unknown> = {
    mode: args.has("--build") ? "production build (vite preview)" : "dev server"
};

try {
    const page = await browser.newPage();
    errors = collectErrors(page);
    await page.setViewport({ width: 1400, height: 1000 });
    await page.goto(server.url, { waitUntil: "load" });
    report.crossOriginIsolated = await page.evaluate(() => self.crossOriginIsolated);

    // 1. Default settings (auto backend), every still.
    report.modelAuto = await waitForModel(page);
    const auto: Record<string, unknown> = {};
    for (const file of stills) {
        await uploadAndWait(page, file);
        const name = file.split("/").pop() ?? file;
        auto[name] = { counts: await readCounts(page), debug: await debugText(page) };
        await (await page.$(".media-stage"))?.screenshot({ path: `${OUT}/auto__${name.replace(".jpg", ".png")}` });
    }
    report.auto = auto;
    await page.screenshot({ path: `${OUT}/app.png`, fullPage: true });

    // 2. Class toggles on the dense highway still (no new inference: applied to the last result).
    const highway = stills.find((f) => f.includes("steady-2")) ?? stills[0];
    await uploadAndWait(page, highway);
    const toggles: Record<string, unknown> = { before: await readCounts(page) };
    await clickGroup(page, "transportation");
    toggles.transportationOff = await readCounts(page);
    await clickGroup(page, "transportation");
    toggles.transportationOn = await readCounts(page);
    await page.click('.class-group[data-group="transportation"] .class-group-expand');
    await page.click('.class-item[data-class-id="2"] input');
    toggles.carOff = await readCounts(page);
    toggles.transportationCheckbox = await page.$eval(
        '.class-group[data-group="transportation"] .class-group-header input',
        (el) => ({ checked: (el as HTMLInputElement).checked, indeterminate: (el as HTMLInputElement).indeterminate })
    );
    await page.click('.class-item[data-class-id="2"] input');
    await page.$eval('[data-setting="confidenceThreshold"] input', (el) => {
        const input = el as HTMLInputElement;
        input.value = "0.6";
        input.dispatchEvent(new Event("input"));
    });
    toggles.confidence60 = await readCounts(page);
    await page.click(".settings-reset-button");
    toggles.afterReset = await readCounts(page);
    report.toggles = toggles;

    // 3. Forced WASM backend: reload, then every still again.
    await setSelect(page, "backend", 2); // options: auto, webgpu, wasm
    report.modelWasm = await waitForModel(page);
    const wasm: Record<string, unknown> = {};
    for (const file of stills) {
        await uploadAndWait(page, file);
        const name = file.split("/").pop() ?? file;
        wasm[name] = { counts: await readCounts(page), debug: await debugText(page) };
    }
    report.wasm = wasm;

    // 4. "Accurate" model (YOLOv8s) on the auto backend.
    await setSelect(page, "backend", 0);
    await setSelect(page, "modelSize", 1); // options: n, s
    report.modelSmall = await waitForModel(page);
    const small: Record<string, unknown> = {};
    for (const file of stills) {
        await uploadAndWait(page, file);
        const name = file.split("/").pop() ?? file;
        small[name] = { counts: await readCounts(page), debug: await debugText(page) };
        await (await page.$(".media-stage"))?.screenshot({ path: `${OUT}/small__${name.replace(".jpg", ".png")}` });
    }
    report.small = small;

    // 5. Unsupported file: a clear error, nothing loaded.
    writeFileSync(`${OUT}/not-media.txt`, "hello");
    await uploadFile(page, resolve(OUT, "not-media.txt"));
    report.unsupportedFileError = await page.$eval(".upload-error", (el) =>
        (el as HTMLElement).hidden ? "" : el.textContent
    );

    // 6. Reload: the model should now come from the Cache API.
    await page.reload({ waitUntil: "load" });
    await waitForModel(page);
    report.afterReloadDebug = await debugText(page);
} finally {
    report.consoleErrors = errors;
    writeFileSync(`${OUT}/image-flow.json`, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    await browser.close();
    await server.close();
}
