/// <reference lib="webworker" />
import type * as Ort from "onnxruntime-web";
import { NUM_COCO_CLASSES } from "./cocoClasses";
import type {
    DetectRequest,
    InferenceRequest,
    InferenceResponse,
    LoadModelRequest,
    ModelInfo
} from "./InferenceMessages";
import type { CacheLike } from "./modelCache";
import { MODEL_CACHE_NAME, fetchModel } from "./modelCache";
import type { GpuCapabilities, ModelManifest, ModelPlan } from "./modelPlan";
import { planModel, wasmFallback } from "./modelPlan";
import type { LoadedRuntime } from "./ortRuntime";
import { loadRuntime } from "./ortRuntime";
import { decodeYoloV8, nonMaxSuppression, toSourceDetections } from "./postprocess";
import { LETTERBOX_FILL, letterboxTransform, rgbaToPlanarRgb } from "./preprocess";

/**
 * The app's inference worker: loads the onnxruntime-web build and model the
 * plan picks (modelPlan.ts), then turns transferred frames into detections.
 * No DOM. Requests are processed strictly in order.
 */

interface Loaded {
    runtime: LoadedRuntime;
    session: Ort.InferenceSession;
    info: ModelInfo;
}

let loaded: Loaded | null = null;
const runtimes = new Map<string, LoadedRuntime>();
let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;
let inputBuffer: Float32Array | null = null;
let queue: Promise<void> = Promise.resolve();

function post(message: InferenceResponse): void {
    self.postMessage(message);
}

async function gpuCapabilities(): Promise<GpuCapabilities> {
    const gpu = (self.navigator as Navigator & { gpu?: GPU }).gpu;
    if (!gpu) return { available: false, shaderF16: false };
    try {
        const adapter = await gpu.requestAdapter();
        return { available: adapter !== null, shaderF16: adapter?.features.has("shader-f16") ?? false };
    } catch {
        return { available: false, shaderF16: false };
    }
}

async function openCache(): Promise<CacheLike | null> {
    try {
        return typeof caches === "undefined" ? null : await caches.open(MODEL_CACHE_NAME);
    } catch {
        return null;
    }
}

async function runtimeFor(plan: ModelPlan, numThreads: number): Promise<LoadedRuntime> {
    const key = `${plan.backend}:${numThreads}`;
    let runtime = runtimes.get(key);
    if (!runtime) {
        runtime = await loadRuntime(plan.backend, numThreads);
        runtimes.set(key, runtime);
    }
    return runtime;
}

async function createSession(plan: ModelPlan, request: LoadModelRequest, manifest: ModelManifest): Promise<Loaded> {
    const entry = manifest.files[plan.file];
    if (!entry) throw new Error(`Model ${plan.file} is missing from manifest.json.`);

    post({ type: "progress", requestId: request.requestId, stage: "runtime", loadedBytes: 0, totalBytes: entry.bytes });
    const runtime = await runtimeFor(plan, request.numThreads);

    const downloadStart = performance.now();
    const { bytes, fromCache } = await fetchModel(new URL(plan.file, request.modelBaseUrl).href, entry, {
        cache: await openCache(),
        onProgress: (loadedBytes, totalBytes) =>
            post({ type: "progress", requestId: request.requestId, stage: "download", loadedBytes, totalBytes })
    });
    const downloadMs = performance.now() - downloadStart;

    post({
        type: "progress",
        requestId: request.requestId,
        stage: "session",
        loadedBytes: entry.bytes,
        totalBytes: entry.bytes
    });
    const sessionStart = performance.now();
    const session = await runtime.ort.InferenceSession.create(bytes, {
        executionProviders: [plan.backend],
        graphOptimizationLevel: "all",
        // 3 = errors only: skips the expected "shape ops assigned to CPU" warning.
        logSeverityLevel: 3
    });
    await warmUp(runtime, session);
    return {
        runtime,
        session,
        info: {
            backend: plan.backend,
            threads: runtime.threads,
            file: plan.file,
            modelSize: request.modelSize,
            notes: plan.notes,
            fromCache,
            downloadMs,
            sessionMs: performance.now() - sessionStart,
            crossOriginIsolated: self.crossOriginIsolated
        }
    };
}

/**
 * One run at the most common input shape (16:9 at 640 → 640x384), so WebGPU
 * compiles its shaders while the "Preparing the model" status shows, not on
 * the user's first image (measured: ~240 ms first run vs ~15 ms after).
 */
async function warmUp(runtime: LoadedRuntime, session: Ort.InferenceSession): Promise<void> {
    const input = new runtime.ort.Tensor("float32", new Float32Array(3 * 384 * 640), [1, 3, 384, 640]);
    const outputs = await session.run({ [session.inputNames[0]]: input });
    for (const output of Object.values(outputs)) output.dispose();
}

async function load(request: LoadModelRequest): Promise<void> {
    const plan = planModel(request.modelSize, request.backend, await gpuCapabilities());
    if (loaded && loaded.info.file === plan.file && loaded.info.backend === plan.backend) {
        post({ type: "loaded", requestId: request.requestId, info: loaded.info });
        return;
    }
    await loaded?.session.release();
    loaded = null;

    const manifestResponse = await fetch(new URL("manifest.json", request.modelBaseUrl), { cache: "no-cache" });
    if (!manifestResponse.ok) throw new Error(`Could not load the model list (HTTP ${manifestResponse.status}).`);
    const manifest = (await manifestResponse.json()) as ModelManifest;

    try {
        loaded = await createSession(plan, request, manifest);
    } catch (error) {
        if (plan.backend !== "webgpu") throw error;
        const reason = error instanceof Error ? error.message : String(error);
        loaded = await createSession(wasmFallback(plan, request.modelSize, reason), request, manifest);
    }
    post({ type: "loaded", requestId: request.requestId, info: loaded.info });
}

async function detect(request: DetectRequest): Promise<void> {
    const { frame } = request;
    try {
        if (!loaded) throw new Error("No model loaded.");
        const { session, runtime } = loaded;

        const t0 = performance.now();
        const width = "displayWidth" in frame ? frame.displayWidth : frame.width;
        const height = "displayHeight" in frame ? frame.displayHeight : frame.height;
        const transform = letterboxTransform({ width, height }, request.inputSize, "rect");
        const { inputWidth, inputHeight } = transform;
        if (!canvas || canvas.width !== inputWidth || canvas.height !== inputHeight) {
            canvas = new OffscreenCanvas(inputWidth, inputHeight);
            ctx = canvas.getContext("2d", { willReadFrequently: true });
            inputBuffer = new Float32Array(3 * inputWidth * inputHeight);
        }
        if (!ctx || !inputBuffer) throw new Error("Could not create the preprocessing canvas.");
        ctx.fillStyle = LETTERBOX_FILL;
        ctx.fillRect(0, 0, inputWidth, inputHeight);
        ctx.drawImage(frame, transform.offsetX, transform.offsetY, transform.drawWidth, transform.drawHeight);
        frame.close();
        rgbaToPlanarRgb(ctx.getImageData(0, 0, inputWidth, inputHeight).data, inputBuffer);
        const input = new runtime.ort.Tensor("float32", inputBuffer, [1, 3, inputHeight, inputWidth]);

        const t1 = performance.now();
        const outputs = await session.run({ [session.inputNames[0]]: input });
        const output = outputs[session.outputNames[0]];
        const data = (await output.getData()) as Float32Array;

        const t2 = performance.now();
        const candidates = nonMaxSuppression(
            decodeYoloV8(data, NUM_COCO_CLASSES, request.scoreFloor),
            request.iouThreshold
        );
        const detections = toSourceDetections(candidates, transform);
        output.dispose();
        const t3 = performance.now();

        post({
            type: "detections",
            requestId: request.requestId,
            detections,
            timings: { preprocessMs: t1 - t0, inferenceMs: t2 - t1, postprocessMs: t3 - t2 },
            inputWidth,
            inputHeight
        });
    } finally {
        // Idempotent: also covers the error paths before drawImage.
        frame.close();
    }
}

self.onmessage = (event: MessageEvent<InferenceRequest>) => {
    const request = event.data;
    queue = queue.then(() =>
        (request.type === "load" ? load(request) : detect(request)).catch((error: unknown) =>
            post({
                type: "error",
                requestId: request.requestId,
                message: error instanceof Error ? error.message : String(error)
            })
        )
    );
};
