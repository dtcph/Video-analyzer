/** Shared setup for the e2e scripts: serve the app (dev or production build) and launch the installed Chrome. */
import type { Browser, Page } from "puppeteer-core";
import puppeteer from "puppeteer-core";
import { build, createServer, preview } from "vite";

export const CHROME_PATH = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export interface AppServer {
    url: string;
    close(): Promise<void>;
}

/** `production`: vite build + vite preview (same COOP/COEP headers); otherwise the dev server. */
export async function serveApp(port: number, production: boolean): Promise<AppServer> {
    if (production) {
        await build({ logLevel: "warn" });
        const server = await preview({ preview: { port, strictPort: true }, logLevel: "warn" });
        return {
            url: `http://localhost:${port}/`,
            close: () => new Promise((done) => server.httpServer.close(() => done()))
        };
    }
    const server = await createServer({ server: { port, strictPort: true }, logLevel: "error" });
    await server.listen();
    return { url: `http://localhost:${port}/`, close: () => server.close() };
}

export async function launchChrome(headed: boolean, extraArgs: string[] = []): Promise<Browser> {
    return puppeteer.launch({
        executablePath: CHROME_PATH,
        headless: !headed,
        args: [
            "--enable-unsafe-webgpu",
            "--use-angle=metal",
            "--no-first-run",
            "--autoplay-policy=no-user-gesture-required",
            ...extraArgs
        ]
    });
}

/** Collects console errors, page errors and failed requests. */
export function collectErrors(page: Page): string[] {
    const errors: string[] = [];
    page.on("console", (m) => {
        if (m.type() === "error") errors.push(m.text());
    });
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("response", (response) => {
        if (response.status() >= 400) errors.push(`HTTP ${response.status()} ${response.url()}`);
    });
    return errors;
}

export async function waitForModel(page: Page): Promise<string> {
    await page.waitForFunction(
        () =>
            ["ready", "error"].includes((document.querySelector(".model-status") as HTMLElement)?.dataset.state ?? ""),
        { timeout: 120_000 }
    );
    return page.$eval(".model-status-text", (el) => el.textContent?.trim() ?? "");
}

export async function setSelect(page: Page, setting: string, optionIndex: number): Promise<void> {
    await page.$eval(
        `[data-setting="${setting}"] select`,
        (el, index) => {
            const select = el as HTMLSelectElement;
            select.value = String(index);
            select.dispatchEvent(new Event("change"));
        },
        optionIndex
    );
}

export async function setRange(page: Page, setting: string, value: number): Promise<void> {
    await page.$eval(
        `[data-setting="${setting}"] input`,
        (el, v) => {
            const input = el as HTMLInputElement;
            input.value = String(v);
            input.dispatchEvent(new Event("input"));
        },
        value
    );
}

export async function debugText(page: Page): Promise<Record<string, string>> {
    return page.$eval(".debug-readout", (dl) => {
        const out: Record<string, string> = {};
        dl.querySelectorAll("dt").forEach(
            (dt) => (out[dt.textContent ?? ""] = (dt.nextElementSibling as HTMLElement).textContent ?? "")
        );
        return out;
    });
}

export async function uploadFile(page: Page, path: string): Promise<void> {
    const input = await page.$(".upload-input");
    if (!input) throw new Error("no upload input");
    await (input as unknown as { uploadFile(path: string): Promise<void> }).uploadFile(path);
}
