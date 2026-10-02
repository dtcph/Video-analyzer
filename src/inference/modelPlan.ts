import type { BackendPreference, ModelSize } from "../settings/SettingsSchema";
import type { BackendKind } from "./ortRuntime";

/** public/models/manifest.json, written by scripts/export_models.py. */
export interface ModelManifest {
    files: Record<string, { model: string; inputSize: number; variant: string; bytes: number; sha256: string }>;
}

export interface GpuCapabilities {
    /** navigator.gpu returned an adapter. */
    available: boolean;
    /** The adapter supports the "shader-f16" feature (FP16 models on WebGPU). */
    shaderF16: boolean;
}

export interface ModelPlan {
    backend: BackendKind;
    file: string;
    /** User-facing explanations of any fallback taken. */
    notes: string[];
}

const FP16_FILE: Record<ModelSize, string> = { n: "yolov8n-640-dyn-fp16.onnx", s: "yolov8s-640-dyn-fp16.onnx" };
const FP32_FILE_N = "yolov8n-640-dyn.onnx";

/**
 * Chooses backend and model file (docs/decisions.md, sections 1 and 2):
 * WebGPU when wanted and available; FP16 files except on WebGPU adapters
 * without shader-f16, where YOLOv8n uses its FP32 file and YOLOv8s falls back
 * to WASM (no FP32 YOLOv8s is shipped). WASM always uses the FP16 file
 * (ORT computes in FP32 there; same speed, half the download).
 */
export function planModel(size: ModelSize, preference: BackendPreference, gpu: GpuCapabilities): ModelPlan {
    const notes: string[] = [];
    if (preference !== "wasm") {
        if (!gpu.available) {
            notes.push(
                preference === "webgpu"
                    ? "WebGPU is not available in this browser, so WASM is used instead."
                    : "WebGPU is not available in this browser; running on WASM (CPU), which is slower."
            );
        } else if (gpu.shaderF16) {
            return { backend: "webgpu", file: FP16_FILE[size], notes };
        } else if (size === "n") {
            return { backend: "webgpu", file: FP32_FILE_N, notes };
        } else {
            notes.push("This GPU does not support FP16, so the accurate model runs on WASM (CPU), which is slower.");
        }
    }
    return { backend: "wasm", file: FP16_FILE[size], notes };
}

/** The plan to retry with when a WebGPU session cannot be created. */
export function wasmFallback(plan: ModelPlan, size: ModelSize, reason: string): ModelPlan {
    return {
        backend: "wasm",
        file: FP16_FILE[size],
        notes: [...plan.notes, `WebGPU failed (${reason}); running on WASM (CPU) instead.`]
    };
}
