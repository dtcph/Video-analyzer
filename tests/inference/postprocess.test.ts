import { describe, expect, it } from "vitest";
import type { Candidate } from "../../src/inference/postprocess";
import {
    decodeYoloV8,
    decodeYoloV8Nms,
    filterDetections,
    nonMaxSuppression,
    toSourceDetections
} from "../../src/inference/postprocess";
import { letterboxTransform } from "../../src/inference/preprocess";

/** Builds a channel-major [4 + classes, anchors] head from per-anchor rows. */
function head(classes: number, anchors: { box: [number, number, number, number]; scores: number[] }[]): Float32Array {
    const n = anchors.length;
    const out = new Float32Array((4 + classes) * n);
    anchors.forEach((anchor, i) => {
        anchor.box.forEach((value, row) => (out[row * n + i] = value));
        anchor.scores.forEach((value, c) => (out[(4 + c) * n + i] = value));
    });
    return out;
}

function candidate(classId: number, score: number, x1: number, y1: number, x2: number, y2: number): Candidate {
    return { classId, score, x1, y1, x2, y2 };
}

describe("decodeYoloV8", () => {
    const output = head(3, [
        { box: [100, 50, 20, 10], scores: [0.1, 0.9, 0.3] },
        { box: [10, 10, 4, 4], scores: [0.2, 0.1, 0.24] },
        { box: [300, 300, 100, 50], scores: [0.6, 0.0, 0.7] }
    ]);

    it("keeps each anchor's best class above the threshold, as corner boxes", () => {
        expect(decodeYoloV8(output, 3, 0.25)).toEqual([
            candidate(1, expect.closeTo(0.9, 6) as unknown as number, 90, 45, 110, 55),
            candidate(2, expect.closeTo(0.7, 6) as unknown as number, 250, 275, 350, 325)
        ]);
    });

    it("drops anchors whose best class is disabled instead of relabeling them", () => {
        // Anchor 2's best class is 2 (0.7); with class 2 disabled it must vanish, not become class 0 (0.6).
        const onlyFirstTwo = decodeYoloV8(output, 3, 0.25, new Uint8Array([1, 1, 0]));
        expect(onlyFirstTwo.map((c) => c.classId)).toEqual([1]);
        const onlyLast = decodeYoloV8(output, 3, 0.25, new Uint8Array([0, 0, 1]));
        expect(onlyLast.map((c) => c.classId)).toEqual([2]);
    });

    it("rejects an output whose size does not match the class count", () => {
        expect(() => decodeYoloV8(new Float32Array(10), 3, 0.25)).toThrow();
    });
});

describe("decodeYoloV8Nms", () => {
    it("reads rows, applies threshold and class filter, skips padding", () => {
        const output = new Float32Array([1, 2, 3, 4, 0.9, 0, 5, 6, 7, 8, 0.3, 2, 9, 9, 9, 9, 0.8, 1, 0, 0, 0, 0, 0, 0]);
        expect(decodeYoloV8Nms(output, 0.5).map((c) => c.classId)).toEqual([0, 1]);
        expect(decodeYoloV8Nms(output, 0.2, new Uint8Array([0, 1, 1])).map((c) => c.classId)).toEqual([2, 1]);
    });
});

describe("nonMaxSuppression", () => {
    it("suppresses overlapping boxes of the same class, keeping the highest score", () => {
        const kept = nonMaxSuppression(
            [candidate(0, 0.8, 0, 0, 10, 10), candidate(0, 0.9, 1, 1, 11, 11), candidate(0, 0.7, 50, 50, 60, 60)],
            0.5
        );
        expect(kept.map((c) => c.score)).toEqual([0.9, 0.7]);
    });

    it("keeps overlapping boxes of different classes", () => {
        const kept = nonMaxSuppression([candidate(0, 0.8, 0, 0, 10, 10), candidate(1, 0.9, 0, 0, 10, 10)], 0.5);
        expect(kept).toHaveLength(2);
    });

    it("suppresses only above the IoU threshold", () => {
        // IoU of these two = 50 / 150 = 1/3.
        const boxes = [candidate(0, 0.9, 0, 0, 10, 10), candidate(0, 0.8, 5, 0, 15, 10)];
        expect(nonMaxSuppression(boxes, 0.34)).toHaveLength(2);
        expect(nonMaxSuppression(boxes, 0.33)).toHaveLength(1);
    });

    it("caps the number of detections", () => {
        const many = Array.from({ length: 10 }, (_, i) => candidate(0, i / 10, i * 20, 0, i * 20 + 10, 10));
        expect(nonMaxSuppression(many, 0.5, 3).map((c) => c.score)).toEqual([0.9, 0.8, 0.7]);
    });
});

describe("toSourceDetections", () => {
    it("undoes the letterbox and normalizes to the source frame", () => {
        const transform = letterboxTransform({ width: 1920, height: 1080 }, 640);
        // Input box (64, 140)-(320, 320) → source (192, 0)-(960, 540) of 1920x1080.
        const [detection] = toSourceDetections([candidate(2, 0.5, 64, 140, 320, 320)], transform);
        expect(detection.classId).toBe(2);
        expect(detection.box.x).toBeCloseTo(0.1);
        expect(detection.box.y).toBeCloseTo(0);
        expect(detection.box.width).toBeCloseTo(0.4);
        expect(detection.box.height).toBeCloseTo(0.5);
    });

    it("clips boxes to the frame and drops boxes entirely in the padding", () => {
        const transform = letterboxTransform({ width: 1920, height: 1080 }, 640);
        const result = toSourceDetections(
            [candidate(0, 0.5, -10, 100, 50, 200), candidate(0, 0.5, 0, 0, 100, 130)],
            transform
        );
        expect(result).toHaveLength(1);
        expect(result[0].box.x).toBe(0);
        expect(result[0].box.y).toBe(0);
    });
});

describe("filterDetections", () => {
    function seeded(seed: number) {
        let state = seed;
        return () => (state = (state * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32;
    }

    it("filtering after NMS at a low floor equals NMS on pre-filtered candidates", () => {
        const random = seeded(7);
        const transform = letterboxTransform({ width: 640, height: 640 }, 640);
        for (let trial = 0; trial < 200; trial++) {
            // Clustered boxes of 3 classes so suppression actually happens.
            const candidates = Array.from({ length: 30 }, () => {
                const x = Math.floor(random() * 4) * 100 + random() * 20;
                const y = random() * 20;
                return candidate(
                    Math.floor(random() * 3),
                    0.05 + random() * 0.95,
                    x,
                    y,
                    x + 60 + random() * 20,
                    y + 60
                );
            });
            const threshold = 0.05 + random() * 0.9;
            const mask = new Uint8Array([1, random() < 0.5 ? 1 : 0, 1]);

            const late = filterDetections(
                toSourceDetections(nonMaxSuppression(candidates, 0.5), transform),
                threshold,
                mask
            );
            const early = toSourceDetections(
                nonMaxSuppression(
                    candidates.filter((c) => c.score >= threshold && mask[c.classId] === 1),
                    0.5
                ),
                transform
            );
            expect(late).toEqual(early);
        }
    });
});
