import { describe, expect, it } from "vitest";
import { clipModeFromName, containsWithMargin, distribution, fractionAbove, percentileSorted, scoreLabels, summarize } from "../scripts/eval/metrics.ts";
import type { FrameRecord } from "../scripts/eval/metrics.ts";

function record(index: number, blobs: number, motionFraction: number | null, analyzeMs = 10): FrameRecord {
    return {
        index,
        time: index / 12,
        blobs,
        motionFraction,
        compensationApplied: index % 2 === 0,
        cameraConfidence: 0.5,
        analyzeMs,
        trackMs: 1,
        activeTracks: blobs,
        boxes: []
    };
}

describe("percentileSorted", () => {
    it("interpolates linearly between ranks", () => {
        expect(percentileSorted([0, 10], 0.5)).toBe(5);
        expect(percentileSorted([1, 2, 3, 4, 5], 0.5)).toBe(3);
        expect(percentileSorted([1, 2, 3, 4, 5], 1)).toBe(5);
    });
    it("handles empty and single-value input", () => {
        expect(percentileSorted([], 0.95)).toBe(0);
        expect(percentileSorted([7], 0.95)).toBe(7);
    });
});

describe("distribution / fractionAbove", () => {
    it("computes mean, median, p95 and max", () => {
        const d = distribution([3, 1, 2]);
        expect(d.mean).toBe(2);
        expect(d.p50).toBe(2);
        expect(d.max).toBe(3);
    });
    it("counts strictly greater values only", () => {
        expect(fractionAbove([5, 10, 20, 21], 20)).toBe(0.25);
        expect(fractionAbove([], 20)).toBe(0);
    });
});

describe("summarize", () => {
    it("excludes the unmeasured first frame from every statistic, including timing", () => {
        const records = [record(0, 0, null, 5000), record(1, 4, 0.02), record(2, 30, 0.3), record(3, 2, 0.01)];
        const s = summarize(records, 20);
        expect(s.frames).toBe(3);
        expect(s.analyzeMs.max).toBe(10);
        expect(s.blobs.max).toBe(30);
        expect(s.blobsAbove[20]).toBeCloseTo(1 / 3);
        expect(s.motionAbove[0.25]).toBeCloseTo(1 / 3);
        expect(s.firstImplausibleTime).toBeCloseTo(2 / 12);
    });
    it("reports no implausible frame when every count is at or under the cutoff", () => {
        expect(summarize([record(0, 0, null), record(1, 20, 0.1)], 20).firstImplausibleTime).toBeNull();
    });
    it("includes a custom implausible cutoff alongside the fixed ones", () => {
        const s = summarize([record(0, 0, null), record(1, 8, 0.1)], 7);
        expect(s.blobsAbove[7]).toBe(1);
        expect(s.blobsAbove[10]).toBe(0);
    });
});

describe("clipModeFromName", () => {
    it("accepts both the specified hyphen and the actual underscore naming", () => {
        expect(clipModeFromName("test-vid/moving_car.mp4")).toBe("moving-car");
        expect(clipModeFromName("moving-drone-2.mp4")).toBe("moving-drone");
        expect(clipModeFromName("moving_handheld-2.mp4")).toBe("moving-handheld");
        expect(clipModeFromName("steady-2.mp4")).toBe("steady");
        expect(clipModeFromName("random.mp4")).toBe("unknown");
    });
});

describe("scoreLabels", () => {
    const withBoxes = (index: number, boxes: [number, number, number, number][]): FrameRecord => ({ ...record(index, boxes.length, 0.01), boxes });

    it("counts blobs on movers as true positives (fragments individually) and other blobs as false positives", () => {
        const labels = [{ index: 1, movers: [[0.1, 0.1, 0.2, 0.2]] as [number, number, number, number][], ignore: [] }];
        // two fragments of one mover + one blob on static background
        const records = [withBoxes(1, [[0.12, 0.12, 0.05, 0.05], [0.2, 0.2, 0.05, 0.05], [0.7, 0.7, 0.05, 0.05]])];
        const s = scoreLabels(labels, records);
        expect(s.truePositives).toBe(2);
        expect(s.falsePositives).toBe(1);
        expect(s.precision).toBeCloseTo(2 / 3);
        expect(s.recall).toBe(1);
    });

    it("skips blobs in ignore regions and outside the roi", () => {
        const labels = [{ index: 1, roi: [0, 0.5, 1, 0.5] as [number, number, number, number], movers: [], ignore: [[0.6, 0.6, 0.1, 0.1]] as [number, number, number, number][] }];
        const records = [withBoxes(1, [[0.1, 0.1, 0.02, 0.02], [0.62, 0.62, 0.02, 0.02], [0.3, 0.8, 0.02, 0.02]])];
        const s = scoreLabels(labels, records);
        expect(s.truePositives).toBe(0);
        expect(s.falsePositives).toBe(1);
        expect(s.precision).toBe(0);
        expect(s.recall).toBeNull();
    });

    it("tolerates a small offset around a labeled box, but not a large one", () => {
        const box: [number, number, number, number] = [0.5, 0.5, 0.1, 0.1];
        expect(containsWithMargin(box, 0.615, 0.55)).toBe(true);
        expect(containsWithMargin(box, 0.7, 0.55)).toBe(false);
    });

    it("reports null precision when nothing was detected, and skips frames missing from the run", () => {
        const labels = [{ index: 5, movers: [[0.1, 0.1, 0.1, 0.1]] as [number, number, number, number][], ignore: [] }, { index: 99, movers: [], ignore: [] }];
        const s = scoreLabels(labels, [withBoxes(5, [])]);
        expect(s.frames).toBe(1);
        expect(s.precision).toBeNull();
        expect(s.recall).toBe(0);
    });
});
