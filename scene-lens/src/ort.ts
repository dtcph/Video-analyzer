/** Shared ONNX Runtime Web loader (object detector and emotion classifier use the same runtime and backend). */
import type * as Ort from "onnxruntime-web/jspi";
import wasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.jspi.wasm?url";

export type OrtModule = typeof Ort;
let ort: OrtModule | undefined;
let backend: "webgpu" | "wasm" = "webgpu";

export async function getOrt(): Promise<OrtModule> {
  if (!ort) {
    ort = await import("onnxruntime-web/jspi");
    ort.env.wasm.wasmPaths = { wasm: new URL(wasmUrl, location.href).href };
    ort.env.logLevel = "error";
  }
  return ort;
}

/** Creates a session on WebGPU, falling back to WASM (then every later session uses WASM too). */
export async function createSession(url: string, dims: Record<string, number> = {}): Promise<{ session: Ort.InferenceSession; backend: "webgpu" | "wasm" }> {
  const o = await getOrt();
  // fixed input sizes (freeDimensionOverrides) let ORT plan static shapes (eval/04-runtime.md)
  const opts = { graphOptimizationLevel: "all" as const, freeDimensionOverrides: (globalThis as { __noDims?: boolean }).__noDims ? {} : dims };
  if (backend === "webgpu") {
    try { return { session: await o.InferenceSession.create(url, { ...opts, executionProviders: ["webgpu"] }), backend }; }
    catch { backend = "wasm"; }
  }
  return { session: await o.InferenceSession.create(url, { ...opts, executionProviders: ["wasm"] }), backend };
}
