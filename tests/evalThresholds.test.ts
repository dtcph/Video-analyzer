import { describe, expect, it } from "vitest";
import type { ClipSummary } from "../scripts/eval/metrics.ts";
import { evaluateRun, ruleForClip } from "../scripts/eval/thresholds.ts";
import type { RunEntry } from "../scripts/eval/thresholds.ts";

function summary(over: { blobsMean?: number; implausible?: number; motionMean?: number; motionP95?: number; msMean?: number; msP95?: number } = {}): ClipSummary {
    const d = (mean: number, p95 = mean) => ({ mean, p50: mean, p95, max: p95 });
    return {
        frames: 100,
        blobs: d(over.blobsMean ?? 2),
        blobsAbove: { 5: 0, 10: 0, 20: over.implausible ?? 0, 50: 0 },
        firstImplausibleTime: null,
        motionFraction: d(over.motionMean ?? 0.01, over.motionP95 ?? 0.02),
        motionAbove: { 0.05: 0, 0.1: 0, 0.25: 0 },
        compensationAppliedFraction: 1,
        meanCameraConfidence: 1,
        analyzeMs: d(over.msMean ?? 10, over.msP95 ?? 15),
        trackMs: d(0.1),
        maxActiveTracks: 1
    };
}

function entry(clip: string, profile: string, s: ClipSummary, extra: Partial<RunEntry> = {}): RunEntry {
    return { clip, profile, summary: s, tracks: { started: 10, confirmed: 10 }, framesHash: "h", labels: null, ...extra };
}

describe("ruleForClip", () => {
    it("maps the known clips to their approved rule and falls back by name", () => {
        expect(ruleForClip("moving_car.mp4")).toBe("gate");
        expect(ruleForClip("moving_handheld.mp4")).toBe("stretch");
        expect(ruleForClip("moving_handheld-2.mp4")).toBe("handheld-no-regression");
        expect(ruleForClip("steady-3.mp4")).toBe("steady");
        expect(ruleForClip("moving_car-2.mp4")).toBe("gate");
    });
});

describe("evaluateRun", () => {
    const baseline = [
        entry("moving_car.mp4", "v1-default", summary({ blobsMean: 36, implausible: 0.77, msMean: 50 }), {
            labels: { frames: 6, truePositives: 10, falsePositives: 90, moversHit: 5, movers: 18, precision: 0.1, recall: 0.28 }
        }),
        entry("steady.mp4", "v1-default", summary({ blobsMean: 2.5, msMean: 10 })),
        entry("steady.mp4", "v1-comp-off", summary({ blobsMean: 2.5, msMean: 7 }), { framesHash: "steady-ref" })
    ];

    it("fails the V1 car numbers and passes a run that meets every moving threshold", () => {
        expect(evaluateRun(baseline[0], baseline).pass).toBe(false);
        const good = entry("moving_car.mp4", "x", summary({ blobsMean: 6, implausible: 0.02, motionMean: 0.03, motionP95: 0.08, msMean: 40 }), {
            labels: { frames: 6, truePositives: 30, falsePositives: 10, moversHit: 6, movers: 18, precision: 0.75, recall: 0.33 }
        });
        const result = evaluateRun(good, baseline);
        expect(result.checks.filter((c) => !c.pass)).toEqual([]);
        expect(result.pass).toBe(true);
    });

    it("fails a moving run whose recall dropped below V1 even if precision is high", () => {
        const silent = entry("moving_car.mp4", "x", summary({ blobsMean: 0.1, msMean: 40 }), {
            labels: { frames: 6, truePositives: 1, falsePositives: 0, moversHit: 1, movers: 18, precision: 1, recall: 0.06 }
        });
        const result = evaluateRun(silent, baseline);
        expect(result.pass).toBe(false);
        expect(result.checks.find((c) => c.name.startsWith("keyframe recall"))?.pass).toBe(false);
    });

    it("passes a steady run identical to the comp-off reference without tolerance checks", () => {
        const result = evaluateRun(entry("steady.mp4", "steady", summary({ blobsMean: 2.5, msMean: 7 }), { framesHash: "steady-ref" }), baseline);
        expect(result.pass).toBe(true);
        expect(result.note).toBeUndefined();
    });

    it("flags a changed steady run and applies the tolerance band", () => {
        const result = evaluateRun(entry("steady.mp4", "steady", summary({ blobsMean: 3.5, msMean: 7 }), { framesHash: "other" }), baseline);
        expect(result.note).toBeDefined();
        expect(result.checks.find((c) => c.name === "blobs mean")?.pass).toBe(false);
        expect(result.pass).toBe(false);
    });

    it("never fails the overall run for a stretch clip, and enforces the p95 time budget everywhere", () => {
        const stretch = evaluateRun(entry("moving_handheld.mp4", "x", summary({ blobsMean: 30, implausible: 0.7 })), baseline);
        expect(stretch.pass).toBe(false);
        expect(stretch.gatePass).toBe(true);
        const slow = evaluateRun(entry("steady.mp4", "steady", summary({ msMean: 7, msP95: 90 }), { framesHash: "steady-ref" }), baseline);
        expect(slow.pass).toBe(false);
    });
});
