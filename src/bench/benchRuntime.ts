import type * as Ort from "onnxruntime-web";
import jsepWasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url";
import { configureRuntime, loadRuntime } from "../inference/ortRuntime";

/**
 * Phase 1 benchmark runtimes: the app's two builds plus the legacy JSEP
 * WebGPU build, kept here so its 27 MB .wasm never enters the app bundle.
 */
export type RuntimeKind = "webgpu" | "webgpu-jsep" | "wasm";

export interface BenchRuntime {
    ort: typeof Ort;
    threads: number;
    executionProviders: Ort.InferenceSession.ExecutionProviderConfig[];
}

export async function loadBenchRuntime(kind: RuntimeKind, numThreads: number): Promise<BenchRuntime> {
    if (kind === "webgpu-jsep") {
        const ort = await import("onnxruntime-web");
        return { ort, threads: configureRuntime(ort, jsepWasmUrl, numThreads), executionProviders: ["webgpu"] };
    }
    const runtime = await loadRuntime(kind, numThreads);
    return { ort: runtime.ort, threads: runtime.threads, executionProviders: [kind] };
}
