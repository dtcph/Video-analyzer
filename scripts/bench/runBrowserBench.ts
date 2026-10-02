/**
 * Runs the Phase 1 in-browser benchmark (bench.html) in the installed Chrome.
 *
 *   node scripts/bench/runBrowserBench.ts [--headed] [--plan smoke|full] [--shots]
 *
 * Starts a Vite dev server, opens bench.html, runs every config of the plan
 * through window.__bench.run (each in a fresh worker), and writes
 * .cache/bench/results-<plan>.json plus a markdown summary to stdout.
 * --shots saves annotated stills per runtime to .cache/bench/shots/.
 *
 * Needs: test-img/*.jpg, .cache/models-bench/ (scripts/export_models.py --set benchmark),
 * Chrome at $CHROME_PATH or the default macOS location.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import puppeteer from "puppeteer-core";
import { createServer } from "vite";
import type { BenchConfig, BenchConfigResult } from "../../src/bench/bench.ts";

const args = new Set(process.argv.slice(2));
const planName = process.argv.includes("--plan") ? process.argv[process.argv.indexOf("--plan") + 1] : "smoke";
const chromePath = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

type PartialConfig = Pick<BenchConfig, "runtime" | "model"> & Partial<BenchConfig>;

function plan(name: string): PartialConfig[] {
    const smoke: PartialConfig[] = [
        { runtime: "webgpu", model: "yolov8n-640.onnx" },
        { runtime: "webgpu-jsep", model: "yolov8n-640.onnx" },
        { runtime: "wasm", model: "yolov8n-640.onnx" }
    ];
    if (name === "smoke") return smoke.map((c) => ({ ...c, warmup: 1, iterations: 3 }));
    if (name === "release") {
        // The configurations docs/decisions.md ships; run several times to see the spread.
        return [
            { runtime: "webgpu", model: "yolov8n-640-dyn-fp16.onnx" },
            { runtime: "webgpu", model: "yolov8n-640-dyn.onnx" },
            { runtime: "webgpu", model: "yolov8s-640-dyn-fp16.onnx" },
            { runtime: "wasm", model: "yolov8n-640-dyn-fp16.onnx" },
            { runtime: "wasm", model: "yolov8n-640-dyn-fp16.onnx", threads: 4 },
            { runtime: "wasm", model: "yolov8s-640-dyn-fp16.onnx" }
        ];
    }
    if (name === "rect") {
        return [
            { runtime: "webgpu", model: "yolov8n-640-dyn.onnx" },
            { runtime: "webgpu", model: "yolov8n-640-dyn-fp16.onnx" },
            { runtime: "webgpu", model: "yolov8n-640-dyn.onnx", letterbox: "square" },
            { runtime: "webgpu", model: "yolov8n-640-dyn-fp16.onnx", letterbox: "square" },
            { runtime: "wasm", model: "yolov8n-640-dyn.onnx" },
            { runtime: "wasm", model: "yolov8n-640-dyn-fp16.onnx" },
            { runtime: "wasm", model: "yolov8n-640-dyn-fp16.onnx", letterbox: "square" },
            { runtime: "webgpu", model: "yolov8s-640-dyn-fp16.onnx" },
            { runtime: "webgpu", model: "yolov8s-640-dyn-fp16.onnx", letterbox: "square" },
            { runtime: "wasm", model: "yolov8s-640-dyn-fp16.onnx" },
            { runtime: "wasm", model: "yolov8s-640-fp16.onnx" },
            { runtime: "wasm", model: "yolov8n-640-fp16.onnx", threads: 4 },
            { runtime: "webgpu", model: "yolov8n-640.onnx" }
        ];
    }
    return [
        // Runtime comparison, FP32, 640.
        ...smoke,
        // Precision variants.
        { runtime: "webgpu", model: "yolov8n-640-fp16.onnx" },
        { runtime: "webgpu-jsep", model: "yolov8n-640-fp16.onnx" },
        { runtime: "wasm", model: "yolov8n-640-int8.onnx" },
        { runtime: "wasm", model: "yolov8n-640-fp16.onnx" },
        // NMS inside the graph vs. JS NMS.
        { runtime: "webgpu", model: "yolov8n-640-nms.onnx" },
        { runtime: "wasm", model: "yolov8n-640-nms.onnx" },
        // Dynamic input shape.
        { runtime: "webgpu", model: "yolov8n-640-dyn.onnx" },
        { runtime: "wasm", model: "yolov8n-640-dyn.onnx" },
        // Input sizes.
        { runtime: "webgpu", model: "yolov8n-416-fp16.onnx" },
        { runtime: "webgpu", model: "yolov8n-320-fp16.onnx" },
        { runtime: "wasm", model: "yolov8n-416.onnx" },
        { runtime: "wasm", model: "yolov8n-320.onnx" },
        // Accuracy model.
        { runtime: "webgpu", model: "yolov8s-640.onnx" },
        { runtime: "webgpu", model: "yolov8s-640-fp16.onnx" },
        { runtime: "webgpu", model: "yolov8s-416-fp16.onnx" },
        { runtime: "wasm", model: "yolov8s-640.onnx" },
        { runtime: "wasm", model: "yolov8s-640-int8.onnx" },
        // WASM thread scaling.
        { runtime: "wasm", model: "yolov8n-640.onnx", threads: 1 },
        { runtime: "wasm", model: "yolov8n-640.onnx", threads: 4 },
        { runtime: "wasm", model: "yolov8n-640.onnx", threads: 16 }
    ];
}

function complete(config: PartialConfig, images: string[]): BenchConfig {
    return {
        inputSize: Number(/-(\d+)/.exec(config.model)?.[1] ?? 640),
        letterbox: config.model.includes("-dyn") ? "rect" : "square",
        head: config.model.includes("-nms") ? "nms" : "raw",
        threads: 8,
        warmup: 3,
        iterations: 20,
        images,
        ...config
    };
}

function quantile(values: number[], q: number): number {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : NaN;
}

const server = await createServer({ server: { port: 5197, strictPort: true }, logLevel: "error" });
await server.listen();
const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: !args.has("--headed"),
    args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-angle=metal", "--no-first-run"]
});

try {
    const page = await browser.newPage();
    page.on("console", (message) => {
        if (message.type() === "error") console.error("[page]", message.text());
    });
    await page.setViewport({ width: 1400, height: 900 });
    await page.goto("http://localhost:5197/bench.html", { waitUntil: "load" });
    await page.waitForFunction(() => window.__bench !== undefined);

    const environment = await page.evaluate(async () => {
        const gpu = (
            navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ info?: Record<string, string> } | null> } }
        ).gpu;
        const adapter = gpu ? await gpu.requestAdapter() : null;
        return {
            userAgent: navigator.userAgent,
            crossOriginIsolated: self.crossOriginIsolated,
            hardwareConcurrency: navigator.hardwareConcurrency,
            webgpu: adapter
                ? {
                      vendor: adapter.info?.vendor,
                      architecture: adapter.info?.architecture,
                      description: adapter.info?.description
                  }
                : null
        };
    });
    console.error("environment", JSON.stringify(environment), "host CPU", cpus()[0]?.model);

    const stills = await page.evaluate(() => window.__bench.stills);
    if (stills.length === 0) throw new Error("no test-img/*.jpg found");
    const results: BenchConfigResult[] = [];
    for (const partial of plan(planName)) {
        const config = complete(partial, stills);
        const result = await page.evaluate((c) => window.__bench.run(c), config);
        results.push(result);
        console.error(`${config.runtime} ${config.model} t${config.threads}: ${result.error ?? "ok"}`);
    }

    mkdirSync(".cache/bench/shots", { recursive: true });
    if (args.has("--shots")) {
        for (const result of results.slice(0, 3)) {
            for (const image of result.images) {
                await page.evaluate(
                    (url, detections) => window.__bench.draw(url, detections),
                    image.url,
                    image.detections
                );
                const canvas = await page.$("#canvas");
                const name = `${result.config.runtime}__${image.url.split("/").pop()}`.replace(/\.jpg$/, ".png");
                await canvas?.screenshot({ path: `.cache/bench/shots/${name}` });
            }
        }
    }

    writeFileSync(`.cache/bench/results-${planName}.json`, JSON.stringify({ environment, results }, null, 2));

    console.log(
        "| runtime | model | letterbox | threads | session ms | first run ms | pre p50 | infer p50 | infer p90 | post p50 | total p50 | FPS | detections per still |"
    );
    console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
    for (const r of results) {
        if (r.error) {
            console.log(
                `| ${r.config.runtime} | ${r.config.model} | ${r.config.letterbox} | ${r.config.threads} | error: ${r.error} |`
            );
            continue;
        }
        const all = (key: "preprocess" | "inference" | "postprocess") => r.images.flatMap((image) => image.times[key]);
        const totals = r.images.flatMap((image) =>
            image.times.inference.map((v, i) => v + image.times.preprocess[i] + image.times.postprocess[i])
        );
        const total = quantile(totals, 0.5);
        const firstRun = Math.max(...r.images.map((image) => image.firstRunMs));
        const threads = r.config.runtime === "wasm" ? String(r.ready?.threads) : "-";
        console.log(
            `| ${r.config.runtime} | ${r.config.model} | ${r.config.letterbox} | ${threads} | ${r.ready?.sessionCreateMs.toFixed(0)} | ${r.images[0].firstRunMs.toFixed(0)} (max ${firstRun.toFixed(0)}) | ` +
                `${quantile(all("preprocess"), 0.5).toFixed(1)} | ${quantile(all("inference"), 0.5).toFixed(1)} | ${quantile(all("inference"), 0.9).toFixed(1)} | ` +
                `${quantile(all("postprocess"), 0.5).toFixed(2)} | ${total.toFixed(1)} | ${(1000 / total).toFixed(0)} | ${r.images.map((image) => image.detections.length).join(" / ")} |`
        );
    }
} finally {
    await browser.close();
    await server.close();
}
