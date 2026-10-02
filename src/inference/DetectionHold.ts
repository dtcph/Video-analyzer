import type { Detection } from "./postprocess";

export interface TimedDetections {
    /** Media time of the frame the detections belong to, seconds. */
    mediaTime: number;
    detections: Detection[];
}

/**
 * The latest inference result, held on screen between inferred frames.
 * Without tracking (Phase 4 adds Kalman-predicted boxes) boxes are held, not
 * interpolated. A result is shown only while it is plausibly current:
 * - not older than `maxHoldSeconds` of media time (inference stalled, slow device);
 * - not from the future (display jumped back, e.g. a backward seek not yet cleared).
 */
export class DetectionHold {
    private latest: TimedDetections | null = null;

    constructor(private readonly maxHoldSeconds = 0.5) {}

    /**
     * Always replaces: results arrive in capture order (one frame in flight),
     * and results from before a seek are discarded by the caller. A result
     * may carry an earlier media time than the one it replaces: the paused
     * video's currentTime can lie slightly before the last sampled frame's.
     */
    set(result: TimedDetections): void {
        this.latest = result;
    }

    clear(): void {
        this.latest = null;
    }

    /** The result to draw at `displayTime`, or null. */
    at(displayTime: number): TimedDetections | null {
        const latest = this.latest;
        if (!latest) return null;
        const age = displayTime - latest.mediaTime;
        if (age < -0.001 || age > this.maxHoldSeconds) return null;
        return latest;
    }

    /** True if the held result is for exactly this frame time (the paused frame was detected). */
    isExact(displayTime: number): boolean {
        return this.latest !== null && Math.abs(this.latest.mediaTime - displayTime) < 0.001;
    }
}
