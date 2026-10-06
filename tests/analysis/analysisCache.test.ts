import { describe, expect, it } from "vitest";
import { InMemoryAnalysisCache, lastIndexAtOrBefore } from "../../src/analysis/AnalysisCache";

const det = (classId: number, score: number, x = 0.25) => ({
    classId,
    score,
    box: { x, y: 0.5, width: 0.125, height: 0.25 }
});

describe("InMemoryAnalysisCache", () => {
    it("stores samples compactly and returns them", () => {
        const cache = new InMemoryAnalysisCache();
        cache.add({ time: 0, detections: [det(2, 0.5), det(16, 0.75)] });
        cache.add({ time: 1 / 30, detections: [] });
        expect(cache.length).toBe(2);
        expect(cache.at(0)).toEqual({ time: 0, detections: [det(2, 0.5), det(16, 0.75)] });
        expect(cache.at(1).detections).toEqual([]);
        expect(cache.lastTime()).toBeCloseTo(1 / 30);
        expect(cache.byteSize()).toBe(2 * 8 + 2 * 6 * 4);
    });

    it("rejects samples out of order", () => {
        const cache = new InMemoryAnalysisCache();
        cache.add({ time: 1, detections: [] });
        expect(() => cache.add({ time: 1, detections: [] })).toThrow();
        expect(() => cache.add({ time: 0.5, detections: [] })).toThrow();
    });

    it("finds the sample shown at a display time, with a small tolerance", () => {
        const cache = new InMemoryAnalysisCache();
        for (const time of [0, 0.5, 1]) cache.add({ time, detections: [] });
        expect(cache.indexAtOrBefore(-0.1)).toBe(-1);
        expect(cache.indexAtOrBefore(0.7)).toBe(1);
        expect(cache.indexAtOrBefore(0.999)).toBe(2);
        expect(cache.indexAtOrBefore(5)).toBe(2);
    });

    it("binary search matches a linear scan", () => {
        const values = [0, 0.1, 0.1001, 0.3, 0.7, 2];
        for (const target of [-1, 0, 0.05, 0.1, 0.10005, 0.5, 2, 3]) {
            const linear = values.reduce((found, v, i) => (v <= target ? i : found), -1);
            expect(lastIndexAtOrBefore(values, target)).toBe(linear);
        }
    });
});
