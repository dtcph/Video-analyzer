import { describe, expect, it } from "vitest";
import { letterboxTransform, rgbaToPlanarRgb } from "../../src/inference/preprocess";

describe("letterboxTransform", () => {
    it("fits landscape 1080p into 640 with bars top and bottom", () => {
        expect(letterboxTransform({ width: 1920, height: 1080 }, 640)).toEqual({
            inputWidth: 640,
            inputHeight: 640,
            sourceWidth: 1920,
            sourceHeight: 1080,
            scale: 1 / 3,
            offsetX: 0,
            offsetY: 140,
            drawWidth: 640,
            drawHeight: 360
        });
    });

    it("fits portrait media with bars left and right", () => {
        const t = letterboxTransform({ width: 720, height: 1280 }, 416);
        expect(t.scale).toBeCloseTo(416 / 1280);
        expect([t.drawWidth, t.drawHeight, t.offsetX, t.offsetY]).toEqual([234, 416, 91, 0]);
    });

    it("rect mode pads the short side only to the next multiple of 32", () => {
        const t = letterboxTransform({ width: 1920, height: 1080 }, 640, "rect");
        expect([t.inputWidth, t.inputHeight, t.drawWidth, t.drawHeight, t.offsetX, t.offsetY]).toEqual([
            640, 384, 640, 360, 0, 12
        ]);
        const portrait = letterboxTransform({ width: 1080, height: 1920 }, 416, "rect");
        expect([portrait.inputWidth, portrait.inputHeight, portrait.offsetX]).toEqual([256, 416, 11]);
    });

    it("upscales small media to fill the input", () => {
        const t = letterboxTransform({ width: 320, height: 320 }, 640);
        expect([t.scale, t.drawWidth, t.drawHeight, t.offsetX, t.offsetY]).toEqual([2, 640, 640, 0, 0]);
    });
});

describe("rgbaToPlanarRgb", () => {
    it("converts interleaved RGBA bytes to planar RGB floats and drops alpha", () => {
        const rgba = new Uint8ClampedArray([255, 0, 51, 7, 0, 255, 102, 9]);
        const planar = Array.from(rgbaToPlanarRgb(rgba));
        [1, 0, 0, 1, 0.2, 0.4].forEach((expected, i) => expect(planar[i]).toBeCloseTo(expected, 6));
    });

    it("reuses the provided buffer and rejects a wrong size", () => {
        const out = new Float32Array(3);
        expect(rgbaToPlanarRgb(new Uint8ClampedArray([0, 0, 255, 255]), out)).toBe(out);
        expect(() => rgbaToPlanarRgb(new Uint8ClampedArray(8), new Float32Array(3))).toThrow();
    });
});
