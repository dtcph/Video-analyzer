import { describe, expect, it } from "vitest";
import { staleness, trackingKey } from "../../src/analysis/analysisKeys";

const inference = {
    modelFile: "yolov8n.onnx",
    backend: "webgpu" as const,
    inputSize: 640,
    iouThreshold: 0.7,
    maxInferenceFps: 30
};
const mask = (...ids: number[]) => {
    const m = new Uint8Array(80);
    for (const id of ids) m[id] = 1;
    return m;
};
const settings = { confidenceThreshold: 0.25, confirmationFrames: 3, lostBufferSeconds: 2 };

describe("analysis keys", () => {
    it("lists enabled classes in the tracking key", () => {
        expect(trackingKey(settings, mask(16, 0, 2))).toEqual({ ...settings, classes: "0,2,16" });
    });

    it("classifies changes: none, tracking-only, full", () => {
        const cached = { inference, tracking: trackingKey(settings, mask(0, 2)) };
        expect(staleness(cached, { inference: { ...inference }, tracking: trackingKey(settings, mask(0, 2)) })).toBe(
            "none"
        );
        expect(
            staleness(cached, {
                inference,
                tracking: trackingKey({ ...settings, confidenceThreshold: 0.4 }, mask(0, 2))
            })
        ).toBe("tracking");
        expect(staleness(cached, { inference, tracking: trackingKey(settings, mask(0)) })).toBe("tracking");
        expect(
            staleness(cached, { inference, tracking: trackingKey({ ...settings, lostBufferSeconds: 1 }, mask(0, 2)) })
        ).toBe("tracking");
        expect(staleness(cached, { inference: { ...inference, inputSize: 320 }, tracking: cached.tracking })).toBe(
            "full"
        );
        expect(
            staleness(cached, {
                inference: { ...inference, backend: "wasm" },
                tracking: trackingKey({ ...settings, confidenceThreshold: 0.4 }, mask(0))
            })
        ).toBe("full");
    });
});
