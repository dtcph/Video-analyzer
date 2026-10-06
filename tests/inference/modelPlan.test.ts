import { describe, expect, it } from "vitest";
import { planModel, wasmFallback } from "../../src/inference/modelPlan";

const gpu = (available: boolean, shaderF16: boolean) => ({ available, shaderF16 });

describe("planModel", () => {
    it("uses WebGPU with FP16 files when the adapter supports shader-f16", () => {
        expect(planModel("n", "auto", gpu(true, true))).toEqual({
            backend: "webgpu",
            size: "n",
            file: "yolov8n-640-dyn-fp16.onnx",
            notes: []
        });
        expect(planModel("s", "webgpu", gpu(true, true)).file).toBe("yolov8s-640-dyn-fp16.onnx");
    });

    it("uses the FP32 nano file on adapters without shader-f16, and WASM for the small model", () => {
        expect(planModel("n", "auto", gpu(true, false))).toEqual({
            backend: "webgpu",
            size: "n",
            file: "yolov8n-640-dyn.onnx",
            notes: []
        });
        const s = planModel("s", "auto", gpu(true, false));
        expect([s.backend, s.file]).toEqual(["wasm", "yolov8s-640-dyn-fp16.onnx"]);
        expect(s.notes[0]).toContain("FP16");
    });

    it("falls back to WASM without WebGPU and explains why", () => {
        const auto = planModel("n", "auto", gpu(false, false));
        expect([auto.backend, auto.file]).toEqual(["wasm", "yolov8n-640-dyn-fp16.onnx"]);
        expect(auto.notes).toHaveLength(1);
        expect(planModel("n", "webgpu", gpu(false, false)).notes[0]).toContain("not available");
    });

    it("honors a forced WASM backend silently, even with a capable GPU", () => {
        expect(planModel("s", "wasm", gpu(true, true))).toEqual({
            backend: "wasm",
            size: "s",
            file: "yolov8s-640-dyn-fp16.onnx",
            notes: []
        });
    });

    it("builds a WASM retry plan after a WebGPU failure", () => {
        const retry = wasmFallback(planModel("n", "auto", gpu(true, false)), "n", "device lost");
        expect([retry.backend, retry.file]).toEqual(["wasm", "yolov8n-640-dyn-fp16.onnx"]);
        expect(retry.notes.at(-1)).toContain("device lost");
    });

    it('resolves "auto" to YOLOv8s on WebGPU with FP16 and to YOLOv8n everywhere else', () => {
        const webgpu = planModel("auto", "auto", gpu(true, true));
        expect([webgpu.backend, webgpu.size, webgpu.file]).toEqual(["webgpu", "s", "yolov8s-640-dyn-fp16.onnx"]);
        // No FP16: the nano FP32 file on WebGPU rather than the small model on the CPU.
        const noF16 = planModel("auto", "auto", gpu(true, false));
        expect([noF16.backend, noF16.size, noF16.file]).toEqual(["webgpu", "n", "yolov8n-640-dyn.onnx"]);
        expect(noF16.notes).toEqual([]);
        const noGpu = planModel("auto", "auto", gpu(false, false));
        expect([noGpu.backend, noGpu.size]).toEqual(["wasm", "n"]);
        const forced = planModel("auto", "wasm", gpu(true, true));
        expect([forced.backend, forced.size, forced.file]).toEqual(["wasm", "n", "yolov8n-640-dyn-fp16.onnx"]);
        const retry = wasmFallback(webgpu, "auto", "device lost");
        expect([retry.backend, retry.size, retry.file]).toEqual(["wasm", "n", "yolov8n-640-dyn-fp16.onnx"]);
    });
});
