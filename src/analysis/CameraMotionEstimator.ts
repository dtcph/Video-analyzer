import type { CameraMotionEstimate, Track, TrackingSettings } from "../tracking/TrackTypes";
import { trackVelocity } from "../tracking/Track";

/**
 * Estimates global (camera) motion for the current frame from the
 * displacement of every simultaneously active track: independent
 * objects rarely all move the same way at the same instant, so when
 * most tracks agree on a direction and magnitude, that's read as the
 * camera itself panning/shaking rather than coordinated object motion
 * (translation only — see the module doc in TrackTypes.CameraMotionEstimate
 * for why scale/rotation are out of scope for V1).
 *
 * `confidence` reflects both *how much* evidence there is (more
 * agreeing tracks -> higher) and *how consistent* it is (tight
 * agreement -> higher, scattered directions -> lower) — this is what
 * keeps a single fast-moving object from being mistaken for camera
 * motion, and what keeps the estimate from being trusted at all with
 * only one or two tracks in frame.
 *
 * `sudden` separately flags an abrupt spike against this estimator's
 * own running baseline — used to widen/nudge matching just for the
 * onset of a pan/shake; see Track.predictPosition and
 * TrackingConfidence.predictionRadius for how each side of this output
 * gets used.
 */
export class CameraMotionEstimator {
    private baselineMagnitude = 0;

    /** Call once per analyzed frame with the tracks that were active going into it (before this frame's own points are appended). */
    estimate(tracks: Track[], settings: TrackingSettings): CameraMotionEstimate {
        const velocities = tracks
            .map((track) => trackVelocity(track))
            .filter((v): v is { vx: number; vy: number } => v !== null);

        if (velocities.length < settings.cameraMotionMinTracks) {
            this.baselineMagnitude *= 1 - settings.cameraMotionSmoothing;
            return { dx: 0, dy: 0, confidence: 0, sudden: false };
        }

        const dx = median(velocities.map((v) => v.vx));
        const dy = median(velocities.map((v) => v.vy));
        const magnitude = Math.hypot(dx, dy);

        // Consistency: how tightly the individual tracks' velocities
        // cluster around the aggregate estimate (low spread -> high
        // agreement -> more likely to actually be camera motion rather
        // than a couple of objects coincidentally moving alike).
        const spread =
            velocities.reduce((sum, v) => sum + Math.hypot(v.vx - dx, v.vy - dy), 0) / velocities.length;
        const consistency = Math.max(0, 1 - spread / (magnitude + 1e-4));

        // Evidence: more agreeing tracks beyond the minimum -> more
        // confident, saturating rather than growing without bound.
        const evidence = Math.min(1, (velocities.length - settings.cameraMotionMinTracks + 1) / 3);

        const confidence = magnitude > settings.cameraMotionMinMagnitude ? consistency * evidence : 0;

        const sudden =
            this.baselineMagnitude > 1e-5 &&
            magnitude > settings.cameraMotionMinMagnitude &&
            magnitude > this.baselineMagnitude * settings.cameraMotionSensitivity &&
            confidence > 0.3;

        // Update the running baseline either way, but more slowly during
        // a detected spike so one shaky frame doesn't immediately raise
        // the bar and mask a shake that continues into the next frame.
        const smoothing = sudden ? settings.cameraMotionSmoothing * 0.3 : settings.cameraMotionSmoothing;
        this.baselineMagnitude += (magnitude - this.baselineMagnitude) * smoothing;

        return { dx, dy, confidence, sudden };
    }

    reset(): void {
        this.baselineMagnitude = 0;
    }
}

function median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
