import type { BlobData, CameraMotionEstimate, Track, TrackingSettings } from "../tracking/TrackTypes";
import { predictPosition } from "../tracking/Track";
import { distance } from "../utils/geometry";
import { solveAssignment } from "../tracking/AssignmentSolver";
import { predictionRadius, scoreMatch } from "./TrackingConfidence";
import type { BlobMatch, BlobMatcher } from "./BlobMatcher";

/** Cost stand-in for a pair gated out entirely — large enough to always lose to any real candidate, but finite (the assignment solver's arithmetic needs finite values throughout the matrix). */
const GATED_OUT_COST = 1e6;

/**
 * Default association strategy: gates out impossible (track, blob)
 * pairs before scoring them at all (see isWithinGate), then finds the
 * cost-minimizing assignment across ALL surviving pairs at once via
 * Hungarian assignment (AssignmentSolver), rather than each track
 * greedily grabbing its own best blob.
 *
 * Gating is what structurally prevents a track from ever being offered
 * a blob clear across the frame — a passing overall score without it
 * is still possible if size/IoU/aspect happen to line up for a distant
 * coincidence, since only the position *term* would suffer, not the
 * pair's eligibility outright. The global assignment on top of that is
 * what prevents two nearby tracks from both being pulled toward
 * whichever blob happens to score highest for either of them in
 * isolation — the standard mechanism behind ID switches when tracks
 * cross paths.
 */
export class TrackAssociator implements BlobMatcher {
    match(tracks: Track[], blobs: BlobData[], settings: TrackingSettings, camera: CameraMotionEstimate | null): BlobMatch[] {
        if (tracks.length === 0 || blobs.length === 0) return [];

        const costMatrix: number[][] = tracks.map((track) => {
            const radius = predictionRadius(track, settings, camera);
            const predicted = predictPosition(track, 1, camera);

            return blobs.map((blob) => {
                if (!isWithinGate(predicted, blob, radius)) return GATED_OUT_COST;
                const score = scoreMatch(track, blob, settings, camera);
                if (score < settings.matchThreshold) return GATED_OUT_COST;
                return 1 - score;
            });
        });

        const assignment = solveAssignment(costMatrix);

        const result: BlobMatch[] = [];
        assignment.forEach((blobIndex, trackIndex) => {
            if (blobIndex === -1) return;
            const cost = costMatrix[trackIndex][blobIndex];
            // The solver must assign *something* to balance the matrix —
            // a gated-out pair chosen only because nothing better was
            // available for that row isn't a real match.
            if (cost >= GATED_OUT_COST) return;
            result.push({ track: tracks[trackIndex], blob: blobs[blobIndex], score: 1 - cost });
        });
        return result;
    }
}

/**
 * Cheap pre-check before the full multi-factor score: is this blob even
 * plausibly within the track's current search radius? This is the hard
 * cutoff described in scoreMatch's predictionRadius — rejecting a pair
 * here means it never reaches the assignment solver at all, rather
 * than merely scoring poorly on one term among several.
 */
function isWithinGate(predicted: { x: number; y: number }, blob: BlobData, radius: number): boolean {
    return distance(predicted, { x: blob.centerX, y: blob.centerY }) <= radius;
}
