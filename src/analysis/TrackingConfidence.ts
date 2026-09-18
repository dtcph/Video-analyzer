import type { BlobData, Track, TrackPoint, TrackingSettings } from "../tracking/TrackTypes";
import { predictNextPoint, trackVelocity } from "../tracking/Track";
import { distance, intersectionOverUnion } from "../utils/geometry";

/**
 * Scores how confidently a detected blob continues an existing track,
 * as a weighted blend of four factors (each normalized to 0..1):
 *
 *  - position: how close the blob's center is to where the track's
 *    velocity predicts it should be next (not just its last point —
 *    this is the "expected movement" term), scored as 1 - distance,
 *    falling to 0 at PREDICTION_MISS_DISTANCE away.
 *  - overlap: intersection-over-union between the track's last
 *    bounding box and the blob's box.
 *  - area: 1 - normalized absolute difference in blob area, so a
 *    same-sized blob scores 1 and a wildly different-sized one scores
 *    near 0.
 *  - movement: how consistent the blob's implied displacement is with
 *    the track's recent velocity (direction + magnitude). A track with
 *    no velocity yet (its first extension) scores this neutrally at 1,
 *    since there is no prior motion to be consistent with.
 *
 * The four terms are combined via TrackingSettings.weight* so the
 * balance can be tuned without touching this formula. Weights need not
 * sum to 1 — they are normalized here.
 */
export function scoreMatch(track: Track, candidate: BlobData, settings: TrackingSettings): number {
    const previous = track.blobs[track.blobs.length - 1];
    if (!previous) return 0;

    const predicted = predictNextPoint(track);
    const candidateCenter = { x: candidate.centerX, y: candidate.centerY };

    const positionScore = proximityScore(distance(predicted, candidateCenter));

    const overlapScore = intersectionOverUnion(
        { x: previous.x, y: previous.y, width: previous.width, height: previous.height },
        { x: candidate.centerX, y: candidate.centerY, width: candidate.width, height: candidate.height }
    );

    // Bounding-box area for both sides — candidate.area is the true
    // contour area (smaller than its bbox for non-rectangular blobs),
    // so comparing it against the track's bbox-only history would bias
    // the score down regardless of how similar the blobs actually are.
    const previousArea = previous.width * previous.height;
    const candidateBoxArea = candidate.width * candidate.height;
    const areaScore =
        1 - Math.min(1, Math.abs(previousArea - candidateBoxArea) / Math.max(previousArea, candidateBoxArea, 1e-6));

    const movementScore = movementConsistencyScore(track, previous, candidateCenter);

    const { weightPosition, weightOverlap, weightArea, weightMovement } = settings;
    const totalWeight = weightPosition + weightOverlap + weightArea + weightMovement;
    if (totalWeight <= 0) return 0;

    return (
        (positionScore * weightPosition +
            overlapScore * weightOverlap +
            areaScore * weightArea +
            movementScore * weightMovement) /
        totalWeight
    );
}

/** Distance (normalized frame units) beyond which position score bottoms out at 0. */
const PREDICTION_MISS_DISTANCE = 0.25;

function proximityScore(dist: number): number {
    return Math.max(0, 1 - dist / PREDICTION_MISS_DISTANCE);
}

function movementConsistencyScore(
    track: Track,
    previous: TrackPoint,
    candidateCenter: { x: number; y: number }
): number {
    const velocity = trackVelocity(track);
    if (!velocity) return 1;

    const impliedDx = candidateCenter.x - previous.x;
    const impliedDy = candidateCenter.y - previous.y;

    const velocityMagnitude = Math.hypot(velocity.vx, velocity.vy);
    const impliedMagnitude = Math.hypot(impliedDx, impliedDy);

    // A near-stationary track has no meaningful direction to compare
    // against; fall back to comparing magnitudes only.
    if (velocityMagnitude < 1e-4) {
        return proximityScore(impliedMagnitude);
    }

    const dot = (velocity.vx * impliedDx + velocity.vy * impliedDy) / (velocityMagnitude * (impliedMagnitude || 1e-6));
    const directionScore = Math.max(0, (dot + 1) / 2);

    const magnitudeScore =
        1 - Math.min(1, Math.abs(velocityMagnitude - impliedMagnitude) / Math.max(velocityMagnitude, impliedMagnitude, 1e-6));

    return directionScore * 0.6 + magnitudeScore * 0.4;
}
