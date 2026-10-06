import { describe, expect, it } from "vitest";
import { containRect, fitWithinPreservingAspect, intersectionOverUnion } from "../../src/utils/geometry";

describe("intersectionOverUnion", () => {
    it("is 1 for identical boxes and 0 for disjoint or touching ones", () => {
        const box = { x: 10, y: 10, width: 20, height: 20 };
        expect(intersectionOverUnion(box, box)).toBe(1);
        expect(intersectionOverUnion(box, { x: 30, y: 10, width: 20, height: 20 })).toBe(0);
        expect(intersectionOverUnion(box, { x: 100, y: 100, width: 5, height: 5 })).toBe(0);
    });

    it("computes partial overlap", () => {
        // Overlap 10x10 = 100, union 400 + 400 - 100 = 700.
        const iou = intersectionOverUnion(
            { x: 0, y: 0, width: 20, height: 20 },
            { x: 10, y: 10, width: 20, height: 20 }
        );
        expect(iou).toBeCloseTo(100 / 700);
    });

    it("handles containment and degenerate boxes", () => {
        expect(intersectionOverUnion({ x: 0, y: 0, width: 10, height: 10 }, { x: 0, y: 0, width: 5, height: 5 })).toBe(
            0.25
        );
        expect(intersectionOverUnion({ x: 0, y: 0, width: 0, height: 0 }, { x: 0, y: 0, width: 0, height: 0 })).toBe(0);
    });
});

describe("fitWithinPreservingAspect", () => {
    it("downscales preserving aspect, to even dimensions", () => {
        expect(fitWithinPreservingAspect({ width: 1920, height: 1080 }, { width: 640, height: 640 })).toEqual({
            width: 640,
            height: 360
        });
        expect(fitWithinPreservingAspect({ width: 1080, height: 1920 }, { width: 640, height: 640 })).toEqual({
            width: 360,
            height: 640
        });
    });

    it("never upscales", () => {
        expect(fitWithinPreservingAspect({ width: 320, height: 240 }, { width: 640, height: 640 })).toEqual({
            width: 320,
            height: 240
        });
    });
});

describe("containRect", () => {
    it("pillarboxes a narrow medium in a wide container", () => {
        expect(containRect({ width: 1080, height: 1920 }, { width: 1600, height: 900 })).toEqual({
            x: (1600 - 506.25) / 2,
            y: 0,
            width: 506.25,
            height: 900
        });
    });

    it("letterboxes a wide medium in a tall container", () => {
        expect(containRect({ width: 1920, height: 1080 }, { width: 960, height: 1000 })).toEqual({
            x: 0,
            y: (1000 - 540) / 2,
            width: 960,
            height: 540
        });
    });

    it("returns an empty rect for empty media", () => {
        expect(containRect({ width: 0, height: 0 }, { width: 100, height: 100 })).toEqual({
            x: 0,
            y: 0,
            width: 0,
            height: 0
        });
    });
});
