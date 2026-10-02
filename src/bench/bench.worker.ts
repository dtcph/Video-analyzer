/// <reference lib="webworker" />
import type * as Ort from "onnxruntime-web";
import { NUM_COCO_CLASSES } from "../inference/cocoClasses";
import { decodeYoloV8, decodeYoloV8Nms, nonMaxSuppression, toSourceDetections } from "../inference/postprocess";
import type { Detection } from "../inference/postprocess";
import { LETTERBOX_FILL, letterboxTransform, rgbaToPlanarRgb } from "../inference/preprocess";
import type { BenchRequest, BenchResponse, BenchRun } from "./BenchMessages";
import type { BenchRuntime } from "./benchRuntime";
import { loadBenchRuntime } from "./benchRuntime";

/**
 * Phase 1 spike / benchmark worker: one ORT session, timed per stage.
 * - preprocess: letterbox on an OffscreenCanvas, getImageData, RGBA → planar float32;
 * - inference: session.run, including upload and output download;
 * - postprocess: decode, class-aware NMS, map back to the source frame.
 */
let runtime: BenchRuntime | null = null;
let session: Ort.InferenceSession | null = null;
let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;
let inputBuffer: Float32Array | null = null;

function post(message: BenchResponse): void {
    self.postMessage(message);
}

async function init(message: Extract<BenchRequest, { type: "init" }>): Promise<void> {
    await session?.release();
    session = null;
    runtime = await loadBenchRuntime(message.runtime, message.numThreads);

    const fetchStart = performance.now();
    const response = await fetch(message.modelUrl);
    if (!response.ok) throw new Error(`model fetch failed: ${response.status} ${message.modelUrl}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const fetchMs = performance.now() - fetchStart;

    const createStart = performance.now();
    session = await runtime.ort.InferenceSession.create(bytes, {
        executionProviders: runtime.executionProviders,
        graphOptimizationLevel: "all"
    });
    post({
        type: "ready",
        runtime: message.runtime,
        threads: runtime.threads,
        crossOriginIsolated: self.crossOriginIsolated,
        fetchMs,
        sessionCreateMs: performance.now() - createStart,
        modelBytes: bytes.byteLength
    });
}

async function runOnce(message: BenchRun): Promise<{ times: [number, number, number]; detections: Detection[] }> {
    if (!session || !runtime) throw new Error("not initialized");
    const { image, inputSize } = message;

    const t0 = performance.now();
    const transform = letterboxTransform({ width: image.width, height: image.height }, inputSize, message.letterbox);
    const { inputWidth: width, inputHeight: height } = transform;
    if (!canvas || canvas.width !== width || canvas.height !== height) {
        canvas = new OffscreenCanvas(width, height);
        ctx = canvas.getContext("2d", { willReadFrequently: true });
        inputBuffer = new Float32Array(3 * width * height);
    }
    if (!ctx || !inputBuffer) throw new Error("no 2D context");
    ctx.fillStyle = LETTERBOX_FILL;
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(image, transform.offsetX, transform.offsetY, transform.drawWidth, transform.drawHeight);
    rgbaToPlanarRgb(ctx.getImageData(0, 0, width, height).data, inputBuffer);
    const input = new runtime.ort.Tensor("float32", inputBuffer, [1, 3, height, width]);

    const t1 = performance.now();
    const outputs = await session.run({ [session.inputNames[0]]: input });
    const output = outputs[session.outputNames[0]];
    const data = (await output.getData()) as Float32Array;

    const t2 = performance.now();
    const candidates =
        message.head === "nms"
            ? decodeYoloV8Nms(data, message.confThreshold)
            : nonMaxSuppression(decodeYoloV8(data, NUM_COCO_CLASSES, message.confThreshold), message.iouThreshold);
    const detections = toSourceDetections(candidates, transform);
    const t3 = performance.now();

    output.dispose();
    return { times: [t1 - t0, t2 - t1, t3 - t2], detections };
}

async function run(message: BenchRun): Promise<void> {
    const times = { preprocess: [] as number[], inference: [] as number[], postprocess: [] as number[] };
    let firstRunMs = 0;
    let detections: Detection[] = [];
    try {
        for (let i = 0; i < message.warmup + message.iterations; i++) {
            const result = await runOnce(message);
            if (i === 0) firstRunMs = result.times[0] + result.times[1] + result.times[2];
            if (i < message.warmup) continue;
            times.preprocess.push(result.times[0]);
            times.inference.push(result.times[1]);
            times.postprocess.push(result.times[2]);
            detections = result.detections;
        }
    } finally {
        message.image.close();
    }
    post({ type: "result", firstRunMs, times, detections });
}

self.onmessage = (event: MessageEvent<BenchRequest>) => {
    const message = event.data;
    const task = message.type === "init" ? init(message) : run(message);
    task.catch((error: unknown) =>
        post({ type: "error", message: error instanceof Error ? error.message : String(error) })
    );
};
