import { describe, expect, it } from "vitest";
import type { Detection } from "../../src/inference/postprocess";
import { DEFAULT_TUNING, Tracker } from "../../src/tracking/Tracker";
import type { TrackerOptions, TrackSnapshot } from "../../src/tracking/Tracker";

const DT = 1 / 30;
const PERSON = 0;
const CAR = 2;
const TRUCK = 7;
const DOG = 16;
const HORSE = 17;

function det(x: number, classId = CAR, score = 0.8, y = 0.4, size = 0.1): Detection {
    return { classId, score, box: { x, y, width: size, height: size } };
}

function tracker(options: Partial<TrackerOptions> = {}) {
    return new Tracker({ confirmationFrames: 3, lostBufferSeconds: 1, highScore: 0.25, ...options });
}

/** Feeds frames at 30 fps from `start`; returns all tracks confirmed on the way. */
function run(t: Tracker, frames: Detection[][], start = 0): TrackSnapshot[] {
    const confirmed: TrackSnapshot[] = [];
    frames.forEach((detections, i) => confirmed.push(...t.update(start + i * DT, detections).newlyConfirmed));
    return confirmed;
}

/** A car moving right at 0.15 per second, frames `from` to `to`. */
const moving = (from: number, to: number, classId = CAR) =>
    Array.from({ length: to - from }, (_, k) => [det(0.1 + 0.005 * (from + k), classId)]);

describe("Tracker: confirmation", () => {
    it("confirms after N consecutive frames and reports the track exactly once", () => {
        const t = tracker();
        const updates = moving(0, 10).map((frame, i) => t.update(i * DT, frame).newlyConfirmed);
        expect(updates.map((u) => u.length)).toEqual([0, 0, 1, 0, 0, 0, 0, 0, 0, 0]);
        expect(updates[2][0]).toMatchObject({ id: 1, classId: CAR, label: "car", state: "confirmed", hits: 3 });
        expect(t.stats()).toEqual({ tentative: 0, confirmed: 1, lost: 0 });
    });

    it("confirms immediately with N = 1", () => {
        const t = tracker({ confirmationFrames: 1 });
        expect(t.update(0, [det(0.5)]).newlyConfirmed).toHaveLength(1);
    });

    it("never confirms a one-frame false positive", () => {
        const t = tracker();
        const confirmed = run(t, [[det(0.5)], [], [], []]);
        expect(confirmed).toHaveLength(0);
        expect(t.snapshot()).toHaveLength(0);
    });

    it("drops a tentative track on its first miss, so confirmation needs consecutive frames", () => {
        const t = tracker();
        const confirmed = run(t, [[det(0.5)], [det(0.5)], [], [det(0.5)], [det(0.5)]]);
        expect(confirmed).toHaveLength(0);
        expect(t.snapshot()).toMatchObject([{ id: 2, state: "tentative", hits: 2 }]);
    });

    it("applies a changed confirmation setting from the next update", () => {
        const t = tracker({ confirmationFrames: 5 });
        run(t, moving(0, 3));
        t.setOptions({ confirmationFrames: 2 });
        expect(t.update(3 * DT, moving(3, 4)[0]).newlyConfirmed).toHaveLength(1);
    });
});

describe("Tracker: association", () => {
    it("keeps one ID for a moving object", () => {
        const t = tracker();
        run(t, moving(0, 60));
        expect(t.snapshot().map((s) => s.id)).toEqual([1]);
    });

    it("keeps one ID at a low, variable sampling rate", () => {
        const t = tracker();
        const times = [0, 0.1, 0.15, 0.3, 0.33, 0.5, 0.7, 0.75, 0.9, 1.2];
        for (const time of times) t.update(time, [det(0.1 + 0.15 * time)]);
        expect(t.snapshot()).toMatchObject([{ id: 1, state: "confirmed", hits: times.length }]);
    });

    it("keeps IDs of two objects that cross (velocity carries them past each other)", () => {
        const t = tracker();
        const frames = Array.from({ length: 40 }, (_, i) => [
            det(0.2 + 0.01 * i, CAR, 0.8, 0.4),
            det(0.6 - 0.01 * i, CAR, 0.8, 0.42)
        ]);
        run(t, frames);
        const tracks = t.snapshot();
        expect(tracks.map((s) => s.id)).toEqual([1, 2]);
        // Track 1 started on the left and moved right.
        expect(tracks[0].box.x).toBeCloseTo(0.59, 1);
        expect(tracks[1].box.x).toBeCloseTo(0.21, 1);
    });

    it("keeps one track for an object whose class flickers, and classifies it by majority", () => {
        const t = tracker();
        const classes = [DOG, HORSE, DOG, DOG, HORSE, DOG, HORSE, DOG, DOG, DOG];
        const confirmed = run(
            t,
            classes.map((c) => [det(0.5, c)])
        );
        expect(confirmed).toHaveLength(1);
        expect(t.snapshot()).toMatchObject([{ id: 1, classId: DOG, hits: 10 }]);
    });

    it("counts a flickering object once and moves its count to the majority class when the vote changes", () => {
        const t = tracker();
        const confirmed = run(t, [[det(0.5, HORSE, 0.6)], [det(0.5, DOG, 0.5)], [det(0.5, HORSE, 0.6)]]);
        expect(confirmed).toMatchObject([{ classId: HORSE }]);
        // Dog votes accumulate (0.5 + 0.9 > 1.2) and win: exactly one move, never a second count.
        const moves: { from: number; to: number }[] = [];
        let counted = 0;
        for (let i = 0; i < 10; i++) {
            const update = t.update((3 + i) * DT, [det(0.5, DOG, 0.9)]);
            counted += update.newlyConfirmed.length;
            moves.push(...update.reclassified);
        }
        expect(counted).toBe(0);
        expect(moves).toEqual([{ id: 1, from: HORSE, to: DOG }]);
        expect(t.snapshot()).toMatchObject([{ id: 1, classId: DOG, counted: true }]);
    });

    it("does not move a count back and forth on an exact tie", () => {
        const t = tracker({ confirmationFrames: 1 });
        t.update(0, [det(0.5, DOG, 0.8)]);
        const moves = [DOG, HORSE, DOG, HORSE].flatMap(
            (c, i) => t.update((i + 1) * DT, [det(0.5, c, 0.8)]).reclassified
        );
        expect(moves).toHaveLength(0);
    });

    it("does not start a second track for a cross-class duplicate box on the same object", () => {
        const t = tracker();
        const frames = Array.from({ length: 10 }, () => [det(0.5, CAR, 0.8), det(0.502, TRUCK, 0.5)]);
        const confirmed = run(t, frames);
        expect(confirmed).toHaveLength(1);
        expect(t.snapshot()).toHaveLength(1);
    });

    it("still tracks two overlapping objects of the same class separately", () => {
        const t = tracker();
        const frames = Array.from({ length: 10 }, () => [det(0.5, CAR), det(0.52, CAR)]);
        expect(run(t, frames)).toHaveLength(2);
    });

    it("still tracks a person and a moderately overlapping vehicle separately", () => {
        const t = tracker();
        // Rider on a motorcycle: IoU of these boxes ≈ 0.43.
        const frames = Array.from({ length: 10 }, () => [
            det(0.5, PERSON, 0.8, 0.3, 0.1),
            { classId: 3, score: 0.7, box: { x: 0.49, y: 0.34, width: 0.12, height: 0.1 } }
        ]);
        expect(
            run(t, frames)
                .map((s) => s.classId)
                .sort()
        ).toEqual([PERSON, 3]);
    });
});

describe("Tracker: low-score detections", () => {
    it("extend a confirmed track but never create or confirm one", () => {
        const t = tracker();
        run(t, moving(0, 5));
        // The car fades to a low score (0.15): the track stays confirmed.
        const weak = Array.from({ length: 5 }, (_, k) => [det(0.1 + 0.005 * (5 + k), CAR, 0.15)]);
        run(t, weak, 5 * DT);
        expect(t.snapshot()).toMatchObject([{ id: 1, state: "confirmed", hits: 5, confidence: 0.8 }]);

        const fresh = tracker();
        expect(
            run(
                fresh,
                Array.from({ length: 10 }, () => [det(0.5, CAR, 0.15)])
            )
        ).toHaveLength(0);
        expect(fresh.snapshot()).toHaveLength(0);
    });

    it("ignores scores below the low floor", () => {
        const t = tracker();
        run(t, moving(0, 5));
        t.update(5 * DT, [det(0.125, CAR, 0.05)]);
        expect(t.stats()).toEqual({ tentative: 0, confirmed: 0, lost: 1 });
    });
});

describe("Tracker: lost handling", () => {
    it("keeps the ID through an occlusion shorter than the lost buffer", () => {
        const t = tracker({ lostBufferSeconds: 1 });
        const frames = [...moving(0, 10), ...Array.from({ length: 15 }, () => []), ...moving(25, 35)];
        const confirmed = run(t, frames);
        expect(confirmed).toHaveLength(1);
        expect(t.snapshot()).toMatchObject([{ id: 1, state: "confirmed" }]);
    });

    it("re-associates a small lost object that reappears slightly off its prediction (buffered IoU)", () => {
        const t = tracker();
        const small = (x: number) => det(x, PERSON, 0.8, 0.4, 0.02);
        run(
            t,
            Array.from({ length: 5 }, () => [small(0.5)])
        );
        // Hidden for 0.3 s, then back 0.75 box widths away (a pan or a step): plain IoU 0.14, below the 0.2 gate.
        t.update(5 * DT, []);
        t.update(14 * DT, [small(0.515)]);
        expect(t.snapshot()).toMatchObject([{ id: 1, state: "confirmed" }]);

        const plain = new Tracker(
            { confirmationFrames: 3, lostBufferSeconds: 1, highScore: 0.25 },
            { ...DEFAULT_TUNING, lostBuffer: 0 }
        );
        run(
            plain,
            Array.from({ length: 5 }, () => [small(0.5)])
        );
        plain.update(5 * DT, []);
        plain.update(14 * DT, [small(0.515)]);
        expect(plain.snapshot().map((s) => s.id)).toEqual([1, 2]);
    });

    it("marks an unseen confirmed track lost, and hides it", () => {
        const t = tracker();
        run(t, moving(0, 5));
        t.update(5 * DT, []);
        expect(t.stats()).toEqual({ tentative: 0, confirmed: 0, lost: 1 });
        expect(t.visibleAt(5 * DT, 0.5)).toEqual([]);
    });

    it("counts an object again when it returns after the lost buffer (known limitation)", () => {
        const t = tracker({ lostBufferSeconds: 0.5 });
        const frames = [...moving(0, 10), ...Array.from({ length: 30 }, () => []), ...moving(40, 50)];
        const confirmed = run(t, frames);
        expect(confirmed.map((s) => s.id)).toEqual([1, 2]);
    });

    it("with a zero buffer, a track is removed after one missed frame", () => {
        const t = tracker({ lostBufferSeconds: 0 });
        run(t, [...moving(0, 5), []]);
        expect(t.stats().lost).toBe(1);
        t.update(6 * DT, []);
        expect(t.snapshot()).toHaveLength(0);
    });
});

describe("Tracker: time, reset and classes", () => {
    it("treats time going backwards as a seek: drops all tracks, keeps counting IDs up", () => {
        const t = tracker();
        run(t, moving(0, 5));
        const update = t.update(0.05, [det(0.3)]);
        expect(update.reset).toBe(true);
        expect(t.snapshot()).toMatchObject([{ id: 2, state: "tentative" }]);
    });

    it("ignores a repeated update for the same time", () => {
        const t = tracker();
        t.update(0, [det(0.5)]);
        t.update(0, [det(0.5)]);
        t.update(0, [det(0.5)]);
        expect(t.snapshot()).toMatchObject([{ hits: 1 }]);
    });

    it("clear(true) restarts IDs; clear() does not", () => {
        const t = tracker();
        run(t, [[det(0.2), det(0.6)]]);
        t.clear();
        t.update(1, [det(0.2)]);
        expect(t.snapshot()[0].id).toBe(3);
        t.clear(true);
        t.update(2, [det(0.2)]);
        expect(t.snapshot()[0].id).toBe(1);
    });

    it("drops the tracks of disabled classes", () => {
        const t = tracker();
        run(
            t,
            Array.from({ length: 4 }, () => [det(0.2, CAR), det(0.6, DOG)])
        );
        const enabled = new Uint8Array(80);
        enabled[CAR] = 1;
        t.dropDisabledClasses(enabled);
        expect(t.snapshot().map((s) => s.classId)).toEqual([CAR]);
    });
});

describe("Tracker: visibleAt", () => {
    it("extrapolates boxes to the display time", () => {
        const t = tracker();
        run(t, moving(0, 30));
        const last = 29 * DT;
        const [now] = t.visibleAt(last, 0.5);
        const [ahead] = t.visibleAt(last + 0.1, 0.5);
        expect(now).toMatchObject({ id: 1, classId: CAR, confirmed: true });
        expect(ahead.box.x - now.box.x).toBeCloseTo(0.015, 3);
    });

    it("shows tentative tracks as unconfirmed and nothing when the result is too old", () => {
        const t = tracker();
        t.update(0, [det(0.5)]);
        expect(t.visibleAt(0, 0.5)).toMatchObject([{ id: 1, confirmed: false }]);
        expect(t.visibleAt(0.6, 0.5)).toEqual([]);
        expect(t.visibleAt(-0.6, 0.5)).toEqual([]);
    });
});
