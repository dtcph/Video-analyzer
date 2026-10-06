import type { ClassCount } from "../counting/countDetections";
import { TotalCounter } from "../counting/TotalCounter";
import type { TrackerOptions, TrackerTuning, VisibleTrack } from "../tracking/Tracker";
import { DEFAULT_TUNING, Tracker } from "../tracking/Tracker";
import type { AnalysisSample } from "./AnalysisCache";
import { lastIndexAtOrBefore } from "./AnalysisCache";

/** Settings that only affect tracking and counting: changing them re-runs tracking over the cache. */
export interface TrackingSettings {
    confidenceThreshold: number;
    /** 1 = enabled, per class id. */
    enabled: Uint8Array;
    confirmationFrames: number;
    lostBufferSeconds: number;
}

/** The tracks shown at one analyzed sample (tentative and confirmed, as in realtime). */
export interface TrackedSample {
    time: number;
    tracks: VisibleTrack[];
}

/**
 * The tracker and the totals over analyzed samples, in order: the same rules
 * as realtime (forward frames only, count at confirmation, counts follow the
 * majority class). Pure and deterministic: the same samples and settings give
 * the same tracks and totals every time. Incremental, so it can follow a
 * running analysis and continue after Stop / Start.
 */
export class TrackingRun {
    private readonly tracker: Tracker;
    private readonly counter = new TotalCounter();
    private readonly times: number[] = [];
    private readonly frames: TrackedSample[] = [];

    constructor(
        readonly settings: Readonly<TrackingSettings>,
        tuning: Readonly<TrackerTuning> = DEFAULT_TUNING
    ) {
        const options: TrackerOptions = {
            confirmationFrames: settings.confirmationFrames,
            lostBufferSeconds: settings.lostBufferSeconds,
            highScore: settings.confidenceThreshold
        };
        this.tracker = new Tracker(options, tuning);
    }

    /** Re-runs tracking over existing samples (e.g. after a confidence or class change). */
    static over(samples: Iterable<AnalysisSample>, settings: TrackingSettings): TrackingRun {
        const run = new TrackingRun(settings);
        for (const sample of samples) run.push(sample);
        return run;
    }

    push(sample: AnalysisSample): void {
        const { enabled } = this.settings;
        const low = DEFAULT_TUNING.lowScore;
        const detections = sample.detections.filter((d) => enabled[d.classId] === 1 && d.score >= low);
        const update = this.tracker.update(sample.time, detections);
        for (const track of update.newlyConfirmed) this.counter.add(track.classId);
        for (const change of update.reclassified) this.counter.move(change.from, change.to);
        this.times.push(sample.time);
        this.frames.push({ time: sample.time, tracks: this.tracker.visibleAt(sample.time, 0) });
    }

    get length(): number {
        return this.frames.length;
    }

    /** The tracks of the last analyzed sample at or before `time` that is at most `maxAge` older, or null. */
    tracksAt(time: number, maxAge: number): TrackedSample | null {
        const index = lastIndexAtOrBefore(this.times, time + 0.002);
        if (index < 0) return null;
        const frame = this.frames[index];
        return time - frame.time <= maxAge ? frame : null;
    }

    /** Per-class totals; classes disabled in `enabled` are marked inactive. */
    totals(enabled?: Uint8Array): ClassCount[] {
        return this.counter.totals(enabled);
    }
}
