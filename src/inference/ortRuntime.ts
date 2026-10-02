import type * as Ort from "onnxruntime-web";
import asyncifyWasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url";
import jsepWasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url";
import plainWasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";

export type OrtModule = typeof Ort;

/**
 * The three onnxruntime-web builds under evaluation (Phase 1):
 * - "webgpu": native WebGPU execution provider (`onnxruntime-web/webgpu`, asyncify wasm);
 * - "webgpu-jsep": the older JS-implemented WebGPU EP (default `onnxruntime-web` import);
 * - "wasm": CPU only, SIMD + threads (`onnxruntime-web/wasm`, smallest runtime).
 *
 * Each build is loaded on demand, so only the chosen runtime is downloaded.
 * The .wasm URL is passed explicitly: the bundles would otherwise resolve it
 * relative to their own (Vite-rewritten) location.
 */
export type RuntimeKind = "webgpu" | "webgpu-jsep" | "wasm";

export interface LoadedRuntime {
    kind: RuntimeKind;
    ort: OrtModule;
    executionProviders: Ort.InferenceSession.ExecutionProviderConfig[];
}

export async function loadRuntime(kind: RuntimeKind, numThreads: number): Promise<LoadedRuntime> {
    let ort: OrtModule;
    let wasmUrl: string;
    switch (kind) {
        case "webgpu":
            ort = await import("onnxruntime-web/webgpu");
            wasmUrl = asyncifyWasmUrl;
            break;
        case "webgpu-jsep":
            ort = await import("onnxruntime-web");
            wasmUrl = jsepWasmUrl;
            break;
        case "wasm":
            ort = await import("onnxruntime-web/wasm");
            wasmUrl = plainWasmUrl;
            break;
    }
    ort.env.wasm.wasmPaths = { wasm: new URL(wasmUrl, self.location.href).href };
    // Already inside a worker; ORT's own proxy worker would add a hop.
    ort.env.wasm.proxy = false;
    // Threads need cross-origin isolation (SharedArrayBuffer); without it ORT falls back to 1.
    ort.env.wasm.numThreads = self.crossOriginIsolated ? numThreads : 1;
    return { kind, ort, executionProviders: kind === "wasm" ? ["wasm"] : ["webgpu"] };
}

export async function hasWebGpu(): Promise<boolean> {
    const gpu = (self.navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    if (!gpu) return false;
    try {
        return (await gpu.requestAdapter()) !== null;
    } catch {
        return false;
    }
}
