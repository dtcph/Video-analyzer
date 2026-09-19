import type { BlobData, CameraMotionEstimate, Track, TrackPoint, TrackingSettings } from "../tracking/TrackTypes";
import { predictPosition, trackTrust, trackVelocity } from "../tracking/Track";
import { distance, intersectionOverUnion } from "../utils/geometry";

/**
 * Scores how confidently a detected blob continues an existing track,
 * as a weighted blend of five factors (each normalized to 0..1):
 *
 *  - position: how close the blob's center is to where the track's
 *    camera-compensated prediction says it should be next (not just its
 *    last point), scored as 1 - distance, falling to 0 at the track's
 *    current search radius (see predictionRadius) — which narrows as
 *    the track proves itself more trustworthy (Track.trackTrust) and
 *    widens back out on a frame flagged as sudden camera movement,
 *    rather than staying a single fixed distance for every track
 *    regardless of how established or erratic it is.
 *  - overlap: intersection-over-union between the track's predicted
 *    bounding box and the blob's box.
 *  - size: 1 - normalized absolute difference in area, compared against
 *    the track's own learned expectedSize (an EMA over its history) —
 *    not just its last frame's size — so one odd detection can't
 *    redefine what size this specific track's blob should be.
 *  - aspect: how close the blob's width/height ratio is to the track's
 *    expected ratio — independent of size/area, so a blob that's the
 *    right area but a very different shape still scores low here.
 *  - movement: how consistent the blob's implied displacement is with
 *    the track's recent velocity (direction + magnitude). A track with
 *    no velocity yet (its first extension) scores this neutrally at 1,
 *    since there is no prior motion to be consistent with.
 *
 * The five terms are combined via TrackingSettings.weight* so the
 * balance can be tuned without touching this formula. Weights need not
 * sum to 1 — they are normalized here.
 */
export function scoreMatch(
    track: Track,
    candidate: BlobData,
    settings: TrackingSettings,
    camera: CameraMotionEstimate | null
): number {
    const previous = track.blobs[track.blobs.length - 1];
    if (!previous) return 0;

    const predicted = predictPosition(track, 1, camera);
    const candidateCenter = { x: candidate.centerX, y: candidate.centerY };

    const radius = predictionRadius(track, settings, camera);
    const positionScore = proximityScore(distance(predicted, candidateCenter), radius);

    const overlapScore = intersectionOverUnion(
        { x: predicted.x, y: predicted.y, width: track.expectedSize.width, height: track.expectedSize.height },
        { x: candidate.centerX, y: candidate.centerY, width: candidate.width, height: candidate.height }
    );

    const candidateBoxArea = candidate.width * candidate.height;
    const sizeScore = symmetricRatioScore(track.expectedSize.area, candidateBoxArea);

    const expectedAspect = track.expectedSize.width / Math.max(track.expectedSize.height, 1e-6);
    const candidateAspect = candidate.width / Math.max(candidate.height, 1e-6);
    const aspectScore = symmetricRatioScore(expectedAspect, candidateAspect);

    const movementScore = movementConsistencyScore(track, previous, candidateCenter);

    const { weightPosition, weightOverlap, weightArea, weightAspect, weightMovement } = settings;
    const totalWeight = weightPosition + weightOverlap + weightArea + weightAspect + weightMovement;
    if (totalWeight <= 0) return 0;

    return (
        (positionScore * weightPosition +
            overlapScore * weightOverlap +
            sizeScore * weightArea +
            aspectScore * weightAspect +
            movementScore * weightMovement) /
        totalWeight
    );
}

/**
 * Symmetric ratio comparison: `50 -> 100` and `100 -> 50` score the
 * same, unlike a plain `abs(a-b)/max(a,b)` which is already symmetric
 * for a single pair but not scale-consistent — this compares the two
 * values' ratio against 1 in log-space so a doubling in either
 * direction is penalized equally. Used for both area and aspect-ratio
 * comparisons (see scoreMatch).
 */
function symmetricRatioScore(expected: number, actual: number): number {
    if (expected <= 1e-6 || actual <= 1e-6) return 0;
    const logRatio = Math.abs(Math.log(actual / expected));
    // logRatio of ~0.69 corresponds to a 2x difference either way;
    // treat that as fully dissimilar.
    return Math.max(0, 1 - logRatio / Math.LN2);
}

/** Base search radius (normalized frame units) before trust/camera-motion adjustments — how far off a fresh or erratic track's prediction is still given the benefit of the doubt. */
const BASE_PREDICTION_RADIUS = 0.25;

/**
 * How far from its predicted position a blob can be and still count
 * for this track this frame. Shrinks toward
 * BASE_PREDICTION_RADIUS * minRadiusFraction as the track's trust (see
 * Track.trackTrust) approaches 1 — a track that's proven steady stops
 * being eligible to jump to a coincidentally similar blob elsewhere in
 * frame — and widens back out by cameraShakeRadiusBoost on a frame
 * flagged as sudden camera movement, since a moving frame makes even a
 * physically stationary object's on-screen position swing around.
 * Capped at settings.maxAssociationDistance regardless of those
 * adjustments — this absolute ceiling is what makes "a track jumps
 * across a large portion of the frame" structurally impossible rather
 * than just unlikely.
 */
export function predictionRadius(
    track: Track,
    settings: TrackingSettings,
    camera: CameraMotionEstimate | null
): number {
    const trust = trackTrust(track);
    const tightened = BASE_PREDICTION_RADIUS * (1 - trust * settings.stabilityTightening);
    let radius = Math.max(BASE_PREDICTION_RADIUS * settings.minRadiusFraction, tightened);
    if (camera?.sudden) radius *= settings.cameraShakeRadiusBoost;
    return Math.min(radius, settings.maxAssociationDistance);
}

export function proximityScore(dist: number, radius: number = BASE_PREDICTION_RADIUS): number {
    return Math.max(0, 1 - dist / radius);
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
