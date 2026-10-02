import type * as Ort from "onnxruntime-web";
import asyncifyWasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url";
import plainWasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";

export type OrtModule = typeof Ort;

/**
 * The two onnxruntime-web builds the app uses (docs/decisions.md, section 1):
 * - "webgpu": native WebGPU execution provider (`onnxruntime-web/webgpu`, asyncify wasm);
 * - "wasm": CPU only, SIMD + threads (`onnxruntime-web/wasm`, the smallest runtime).
 *
 * Each build is imported on demand, so a device downloads only the one it uses.
 * The .wasm URL is passed explicitly (a Vite-hashed asset): the bundles would
 * otherwise resolve it relative to their own, rewritten, location.
 */
export type BackendKind = "webgpu" | "wasm";

export interface LoadedRuntime {
    backend: BackendKind;
    ort: OrtModule;
    /** Threads ORT actually uses (1 without cross-origin isolation). */
    threads: number;
}

/** Half the logical cores, 1..8: 8 was fastest on 16 cores, 16 was slower (docs/benchmarks.md). */
export function defaultThreadCount(hardwareConcurrency: number): number {
    return Math.min(8, Math.max(1, Math.floor(hardwareConcurrency / 2)));
}

export function configureRuntime(ort: OrtModule, wasmUrl: string, numThreads: number): number {
    ort.env.wasm.wasmPaths = { wasm: new URL(wasmUrl, self.location.href).href };
    // Already inside a worker; ORT's own proxy worker would add a hop.
    ort.env.wasm.proxy = false;
    // ORT warns that shape ops run on the CPU (intended); only real errors should reach the console.
    ort.env.logLevel = "error";
    // Threads need cross-origin isolation (SharedArrayBuffer); without it ORT runs one thread.
    const threads = self.crossOriginIsolated ? numThreads : 1;
    ort.env.wasm.numThreads = threads;
    return threads;
}

export async function loadRuntime(backend: BackendKind, numThreads: number): Promise<LoadedRuntime> {
    const ort: OrtModule =
        backend === "webgpu" ? await import("onnxruntime-web/webgpu") : await import("onnxruntime-web/wasm");
    const threads = configureRuntime(ort, backend === "webgpu" ? asyncifyWasmUrl : plainWasmUrl, numThreads);
    return { backend, ort, threads };
}
