import { describe, expect, it } from "vitest";
import type { AnalysisSample } from "../../src/analysis/AnalysisCache";
import { TrackingRun } from "../../src/analysis/TrackingRun";

const DT = 1 / 30;
const enabled = (...ids: number[]) => {
    const m = new Uint8Array(80);
    for (const id of ids) m[id] = 1;
    return m;
};
const settings = { confidenceThreshold: 0.25, enabled: enabled(0, 2, 16), confirmationFrames: 3, lostBufferSeconds: 2 };

/** A car moving right, a dog standing still, a one-frame false person, a disabled-class frisbee. */
function clip(frames = 60): AnalysisSample[] {
    return Array.from({ length: frames }, (_, i) => ({
        time: i * DT,
        detections: [
            { classId: 2, score: 0.8, box: { x: 0.1 + 0.004 * i, y: 0.4, width: 0.1, height: 0.1 } },
            { classId: 16, score: 0.7, box: { x: 0.7, y: 0.6, width: 0.1, height: 0.15 } },
            ...(i === 10 ? [{ classId: 0, score: 0.9, box: { x: 0.4, y: 0.1, width: 0.05, height: 0.2 } }] : []),
            { classId: 29, score: 0.9, box: { x: 0.5, y: 0.5, width: 0.05, height: 0.05 } }
        ]
    }));
}

describe("TrackingRun", () => {
    it("counts unique confirmed tracks of enabled classes", () => {
        const run = TrackingRun.over(clip(), settings);
        expect(run.totals().map((c) => [c.label, c.count])).toEqual([
            ["car", 1],
            ["dog", 1]
        ]);
        expect(run.length).toBe(60);
    });

    it("is deterministic: the same samples and settings give the same result", () => {
        const a = TrackingRun.over(clip(), settings);
        const b = TrackingRun.over(clip(), settings);
        expect(b.totals()).toEqual(a.totals());
        expect(b.tracksAt(1, 0.5)).toEqual(a.tracksAt(1, 0.5));
    });

    it("gives the same result incrementally, with a Stop/Start in between, as in one pass", () => {
        const samples = clip();
        const incremental = new TrackingRun(settings);
        for (const s of samples.slice(0, 25)) incremental.push(s);
        // ...stopped here, then resumed:
        for (const s of samples.slice(25)) incremental.push(s);
        const once = TrackingRun.over(samples, settings);
        expect(incremental.totals()).toEqual(once.totals());
        expect(incremental.tracksAt(1.5, 0.5)).toEqual(once.tracksAt(1.5, 0.5));
    });

    it("re-runs with other settings over the same samples", () => {
        const samples = clip();
        const strict = TrackingRun.over(samples, { ...settings, confidenceThreshold: 0.75 });
        expect(strict.totals().map((c) => c.label)).toEqual(["car"]);
        const lenient = TrackingRun.over(samples, { ...settings, confirmationFrames: 1 });
        expect(lenient.totals().map((c) => [c.label, c.count])).toContainEqual(["person", 1]);
    });

    it("returns the tracks drawn at a display time, and nothing past maxAge", () => {
        const run = TrackingRun.over(clip(), settings);
        const frame = run.tracksAt(10 * DT + 0.01, 0.5);
        expect(frame?.time).toBeCloseTo(10 * DT);
        expect(frame?.tracks.map((t) => t.classId).sort((a, b) => a - b)).toEqual([0, 2, 16]);
        expect(run.tracksAt(-1, 0.5)).toBeNull();
        expect(run.tracksAt(5, 0.5)).toBeNull();
    });
});
