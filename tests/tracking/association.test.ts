import { describe, expect, it } from "vitest";
import { associate, associationScore, trackIdsFor } from "../../src/tracking/association";

const item = (x: number, classId = 2, width = 0.1) => ({ classId, box: { x, y: 0.5, width, height: 0.1 } });

describe("associationScore", () => {
    it("is the IoU for the same class and IoU minus the penalty across classes", () => {
        expect(associationScore(item(0.5), item(0.5), 0.2)).toBeCloseTo(1);
        expect(associationScore(item(0.5, 16), item(0.5, 17), 0.2)).toBeCloseTo(0.8);
        expect(associationScore(item(0.5), item(0.9), 0.2)).toBe(0);
    });
});

describe("buffered IoU", () => {
    it("enlarges both boxes by the row's buffer, so near-misses of small boxes can match", () => {
        // Same-size boxes one width apart: plain IoU 0; enlarged by 0.5 per side: 1/3.
        const track = { ...item(0.5), buffer: 0.5 };
        expect(associationScore(item(0.5), item(0.6), 0)).toBe(0);
        expect(associationScore(track, item(0.6), 0)).toBeCloseTo(1 / 3);
        expect(associationScore(track, item(0.5), 0)).toBeCloseTo(1);
    });
});

describe("associate", () => {
    it("matches across classes when that is the only plausible pairing (flicker)", () => {
        const result = associate([item(0.5, 16)], [item(0.51, 17)], 0.2, 0.2);
        expect(result.matches).toEqual([[0, 0]]);
    });

    it("prefers the same class when two detections overlap a track about equally", () => {
        const result = associate([item(0.5, 0)], [item(0.505, 3), item(0.51, 0)], 0.2, 0.2);
        expect(result.matches).toEqual([[0, 1]]);
        expect(result.unmatchedCols).toEqual([0]);
    });

    it("gates pairs below the minimum score, including penalized ones", () => {
        // IoU of boxes shifted by 0.05 with width 0.1: 0.05/0.15 = 0.333.
        expect(associate([item(0.5)], [item(0.55)], 0.2, 0.2).matches).toHaveLength(1);
        const crossClass = associate([item(0.5, 16)], [item(0.55, 17)], 0.2, 0.2);
        expect(crossClass.matches).toHaveLength(0);
        expect(crossClass.unmatchedRows).toEqual([0]);
        expect(crossClass.unmatchedCols).toEqual([0]);
    });

    it("finds the global optimum, not a greedy one", () => {
        // Greedy would give track 0 the detection at 0.52 (its best), leaving track 1 with nothing.
        const tracks = [item(0.5), item(0.56)];
        const detections = [item(0.52), item(0.47)];
        const result = associate(tracks, detections, 0.2, 0.2);
        expect(result.matches.sort()).toEqual([
            [0, 1],
            [1, 0]
        ]);
    });

    it("handles empty sides", () => {
        expect(associate([], [item(0.5)], 0.2, 0.2)).toEqual({ matches: [], unmatchedRows: [], unmatchedCols: [0] });
        expect(associate([item(0.5)], [], 0.2, 0.2)).toEqual({ matches: [], unmatchedRows: [0], unmatchedCols: [] });
    });
});

describe("trackIdsFor", () => {
    it("labels detections with the overlapping track's ID, one-to-one", () => {
        const detections = [item(0.5), item(0.9), item(0.51)];
        const tracks = [{ ...item(0.505), id: 7 }];
        expect(trackIdsFor(detections, tracks)).toEqual([7, undefined, undefined]);
    });
});
