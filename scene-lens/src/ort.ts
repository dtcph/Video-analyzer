/** Shared ONNX Runtime Web loader (object detector and emotion classifier use the same runtime and backend). */
import type * as Ort from "onnxruntime-web/webgpu";
import wasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url";

export type OrtModule = typeof Ort;
let ort: OrtModule | undefined;
let backend: "webgpu" | "wasm" = "webgpu";

export async function getOrt(): Promise<OrtModule> {
  if (!ort) {
    ort = await import("onnxruntime-web/webgpu");
    ort.env.wasm.wasmPaths = { wasm: new URL(wasmUrl, location.href).href };
    ort.env.logLevel = "error";
  }
  return ort;
}

/** Creates a session on WebGPU, falling back to WASM (then every later session uses WASM too). */
export async function createSession(url: string): Promise<{ session: Ort.InferenceSession; backend: "webgpu" | "wasm" }> {
  const o = await getOrt();
  if (backend === "webgpu") {
    try { return { session: await o.InferenceSession.create(url, { executionProviders: ["webgpu"], graphOptimizationLevel: "all" }), backend }; }
    catch { backend = "wasm"; }
  }
  return { session: await o.InferenceSession.create(url, { executionProviders: ["wasm"], graphOptimizationLevel: "all" }), backend };
}
