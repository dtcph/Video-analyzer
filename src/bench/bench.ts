import { COCO_CLASSES } from "../inference/cocoClasses";
import { classColor } from "../rendering/classColors";
import type { Detection } from "../inference/postprocess";
import type { RuntimeKind } from "./benchRuntime";
import type { LetterboxMode } from "../inference/preprocess";
import type { BenchReady, BenchRequest, BenchResponse, BenchResult } from "./BenchMessages";

/**
 * Phase 1 spike page (dev server only; not part of the production build).
 * Runs one ORT configuration on the test stills in a worker, draws the
 * detections, and exposes window.__bench.run(plan) for scripts/bench/runBrowserBench.ts.
 */

export interface BenchConfig {
    runtime: RuntimeKind;
    model: string;
    inputSize: number;
    letterbox: LetterboxMode;
    head: "raw" | "nms";
    threads: number;
    warmup: number;
    iterations: number;
    images: string[];
}

export interface BenchConfigResult {
    config: BenchConfig;
    ready?: BenchReady;
    error?: string;
    images: { url: string; firstRunMs: number; times: BenchResult["times"]; detections: Detection[] }[];
}

const STILLS = import.meta.glob("/test-img/*.jpg", { query: "?url", import: "default", eager: true }) as Record<
    string,
    string
>;
/** Benchmark candidates live outside public/ so they never reach dist/; the dev server serves the repo root. */
const BENCH_MODELS = "/.cache/models-bench";
const CONF = 0.25;
const IOU = 0.7;

class BenchWorker {
    private readonly worker = new Worker(new URL("./bench.worker.ts", import.meta.url), { type: "module" });

    request(message: BenchRequest, transfer: Transferable[] = []): Promise<BenchResponse> {
        return new Promise((resolve) => {
            this.worker.onmessage = (event: MessageEvent<BenchResponse>) => resolve(event.data);
            this.worker.onerror = (event) => resolve({ type: "error", message: event.message || "worker error" });
            this.worker.postMessage(message, transfer);
        });
    }

    terminate(): void {
        this.worker.terminate();
    }
}

async function bitmapFor(url: string): Promise<ImageBitmap> {
    return createImageBitmap(await (await fetch(url)).blob());
}

export async function runConfig(config: BenchConfig): Promise<BenchConfigResult> {
    const result: BenchConfigResult = { config, images: [] };
    const worker = new BenchWorker();
    try {
        const ready = await worker.request({
            type: "init",
            runtime: config.runtime,
            modelUrl: `${BENCH_MODELS}/${config.model}`,
            numThreads: config.threads
        });
        if (ready.type !== "ready") throw new Error(ready.type === "error" ? ready.message : "unexpected reply");
        result.ready = ready;

        for (const url of config.images) {
            const image = await bitmapFor(url);
            const reply = await worker.request(
                {
                    type: "run",
                    image,
                    inputSize: config.inputSize,
                    letterbox: config.letterbox,
                    head: config.head,
                    warmup: config.warmup,
                    iterations: config.iterations,
                    confThreshold: CONF,
                    iouThreshold: IOU
                },
                [image]
            );
            if (reply.type !== "result") throw new Error(reply.type === "error" ? reply.message : "unexpected reply");
            result.images.push({ url, firstRunMs: reply.firstRunMs, times: reply.times, detections: reply.detections });
        }
    } catch (error) {
        result.error = error instanceof Error ? error.message : String(error);
    } finally {
        worker.terminate();
    }
    return result;
}

export async function draw(canvas: HTMLCanvasElement, url: string, detections: Detection[]): Promise<void> {
    const image = await bitmapFor(url);
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(image, 0, 0);
    const line = Math.max(2, image.width / 600);
    ctx.font = `${Math.round(line * 7)}px sans-serif`;
    ctx.textBaseline = "bottom";
    for (const d of detections) {
        const x = d.box.x * image.width;
        const y = d.box.y * image.height;
        ctx.strokeStyle = ctx.fillStyle = classColor(d.classId);
        ctx.lineWidth = line;
        ctx.strokeRect(x, y, d.box.width * image.width, d.box.height * image.height);
        const label = `${COCO_CLASSES[d.classId]} ${Math.round(d.score * 100)}%`;
        const width = ctx.measureText(label).width + line * 2;
        ctx.fillRect(x - line / 2, y - line * 9, width, line * 9);
        ctx.fillStyle = "#000";
        ctx.fillText(label, x + line, y - line);
    }
    image.close();
}

export function countByClass(detections: Detection[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const d of detections) counts[COCO_CLASSES[d.classId]] = (counts[COCO_CLASSES[d.classId]] ?? 0) + 1;
    return counts;
}

function median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
}

function buildUi(root: HTMLElement): void {
    root.innerHTML = `
        <style>
            body { margin: 0; background: #0a0d0f; color: #d8e0e2; font: 13px system-ui, sans-serif; }
            #bench { padding: 16px; display: flex; flex-direction: column; gap: 12px; }
            .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
            canvas { max-width: 100%; height: auto; border: 1px solid #232b2f; }
            pre { white-space: pre-wrap; font: 12px ui-monospace, monospace; margin: 0; }
        </style>
        <h1 style="font-size:15px;margin:0">Phase 1 spike: YOLOv8 in the browser</h1>
        <div class="row">
            <select id="runtime"><option>webgpu</option><option>webgpu-jsep</option><option>wasm</option></select>
            <select id="model"></select>
            <select id="image"></select>
            <button id="run">Run</button>
        </div>
        <pre id="log">crossOriginIsolated: ${self.crossOriginIsolated}</pre>
        <canvas id="canvas"></canvas>
    `;
    const $ = <T extends HTMLElement>(id: string) => root.querySelector(`#${id}`) as T;
    const modelSelect = $<HTMLSelectElement>("model");
    const imageSelect = $<HTMLSelectElement>("image");
    const log = $<HTMLElement>("log");

    for (const url of Object.values(STILLS)) imageSelect.add(new Option(url.split("/").pop() ?? url, url));
    void fetch(`${BENCH_MODELS}/manifest.json`)
        .then((response) => response.json())
        .then((manifest: { files: Record<string, unknown> }) => {
            for (const name of Object.keys(manifest.files)) modelSelect.add(new Option(name, name));
        })
        .catch(
            () =>
                (log.textContent += `\nNo ${BENCH_MODELS}/manifest.json: run scripts/export_models.py --set benchmark`)
        );

    $<HTMLButtonElement>("run").addEventListener("click", async () => {
        const model = modelSelect.value;
        const config: BenchConfig = {
            runtime: $<HTMLSelectElement>("runtime").value as RuntimeKind,
            model,
            inputSize: Number(/-(\d+)/.exec(model)?.[1] ?? 640),
            letterbox: model.includes("-dyn") ? "rect" : "square",
            head: model.includes("-nms") ? "nms" : "raw",
            threads: Math.min(navigator.hardwareConcurrency, 8),
            warmup: 2,
            iterations: 10,
            images: [imageSelect.value]
        };
        log.textContent = "running...";
        const result = await runConfig(config);
        if (result.error) {
            log.textContent = `error: ${result.error}`;
            return;
        }
        const image = result.images[0];
        log.textContent = [
            `runtime ${config.runtime}, threads ${result.ready?.threads}, isolated ${result.ready?.crossOriginIsolated}`,
            `session ${result.ready?.sessionCreateMs.toFixed(0)} ms, first run ${image.firstRunMs.toFixed(1)} ms`,
            `median ms: pre ${median(image.times.preprocess).toFixed(2)} / infer ${median(image.times.inference).toFixed(2)} / post ${median(image.times.postprocess).toFixed(2)}`,
            `counts: ${JSON.stringify(countByClass(image.detections))}`
        ].join("\n");
        await draw($<HTMLCanvasElement>("canvas"), image.url, image.detections);
    });
}

declare global {
    interface Window {
        __bench: {
            stills: string[];
            run(config: BenchConfig): Promise<BenchConfigResult>;
            draw(url: string, detections: Detection[]): Promise<void>;
        };
    }
}

const root = document.getElementById("bench");
if (root) buildUi(root);
window.__bench = {
    stills: Object.values(STILLS),
    run: runConfig,
    draw: (url, detections) => draw(document.getElementById("canvas") as HTMLCanvasElement, url, detections)
};
