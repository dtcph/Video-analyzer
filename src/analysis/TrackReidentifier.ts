import type { BlobData, CameraMotionEstimate, Track, TrackingSettings } from "../tracking/TrackTypes";
import { latestPoint, predictPosition } from "../tracking/Track";
import { distance } from "../utils/geometry";
import { trackerLogger } from "../tracking/TrackerLogger";
import type { BlobMatch } from "./BlobMatcher";

/** Minimum reidentification score to accept a revival — deliberately stricter than a fresh match, since a wrong revival silently rewrites an existing track's (possibly labeled) history rather than just starting a new one. */
const REIDENTIFY_THRESHOLD = 0.55;

/**
 * Tries to explain each of this frame's blobs that didn't match an
 * active track as the reappearance of a recently lost one, instead of
 * a brand new object. Scores position proximity to the lost track's
 * predicted position (extrapolated forward by however many frames it's
 * been gone, camera-compensated), size similarity against its learned
 * expectedSize, aspect ratio, and how recently it went lost (fresher
 * losses are trusted more) — a weighted blend, same spirit as
 * TrackingConfidence.scoreMatch but tuned for "is this the same track
 * coming back" rather than "does this continue the track we already
 * have this frame's data for".
 *
 * The search radius grows with elapsed lost frames (more time ->
 * more room for drift) but is capped at settings.maxReidentifyDistance
 * regardless — growing uncertainty must never let a track reconnect to
 * something clear across the frame.
 *
 * Greedy, single-pass, same strategy as GreedyBlobMatcher: each lost
 * track and each unmatched blob can be claimed at most once, highest
 * score first. (A full Hungarian assignment isn't used here the way
 * TrackAssociator uses one for the primary active-track matching pool —
 * lost-track revival is comparatively rare and one-directional, so the
 * greedy simplification costs little in practice.)
 */
export function reidentifyTracks(
    lostTracks: Track[],
    blobs: BlobData[],
    frame: number,
    settings: TrackingSettings,
    camera: CameraMotionEstimate | null
): BlobMatch[] {
    const candidates: BlobMatch[] = [];

    for (const track of lostTracks) {
        const last = latestPoint(track);
        if (!last) continue;

        const gap = frame - track.endFrame;
        if (gap <= 0 || gap > settings.reidentifyWindowFrames) continue;

        const predicted = predictPosition(track, gap, camera);
        const radius = reidentifyRadius(gap, settings);

        for (const blob of blobs) {
            const score = scoreReidentify(predicted, track, blob, gap, radius, settings);
            if (score >= REIDENTIFY_THRESHOLD) candidates.push({ track, blob, score });
        }
    }

    candidates.sort((a, b) => b.score - a.score);

    const claimedTracks = new Set<number>();
    const claimedBlobs = new Set<BlobData>();
    const result: BlobMatch[] = [];

    for (const candidate of candidates) {
        if (claimedTracks.has(candidate.track.id) || claimedBlobs.has(candidate.blob)) continue;
        claimedTracks.add(candidate.track.id);
        claimedBlobs.add(candidate.blob);
        result.push(candidate);

        if (trackerLogger.isEnabled()) {
            const predicted = predictPosition(candidate.track, frame - candidate.track.endFrame, camera);
            trackerLogger.reidentified(candidate.track.id, candidate.blob.id, {
                finalScore: candidate.score,
                predictedX: predicted.x,
                predictedY: predicted.y
            });
        }
    }

    return result;
}

/**
 * Search radius as a function of how long the track has been gone: it
 * starts at reidentifyDistance and grows linearly toward
 * maxReidentifyDistance over the course of the reidentification
 * window, reflecting growing positional uncertainty the longer a track
 * goes unobserved — but never exceeds that cap, no matter how long
 * it's been (see settings.maxReidentifyDistance).
 */
export function reidentifyRadius(gap: number, settings: TrackingSettings): number {
    const t = Math.min(1, gap / settings.reidentifyWindowFrames);
    const radius = settings.reidentifyDistance + (settings.maxReidentifyDistance - settings.reidentifyDistance) * t;
    return Math.min(radius, settings.maxReidentifyDistance);
}

function scoreReidentify(
    predicted: { x: number; y: number },
    track: Track,
    blob: BlobData,
    gap: number,
    radius: number,
    settings: TrackingSettings
): number {
    const dist = distance(predicted, { x: blob.centerX, y: blob.centerY });
    if (dist > radius) return 0;
    const positionScore = 1 - dist / radius;

    const blobArea = blob.width * blob.height;
    const areaScore = symmetricRatio(track.expectedSize.area, blobArea);

    const expectedAspect = track.expectedSize.width / Math.max(track.expectedSize.height, 1e-6);
    const blobAspect = blob.width / Math.max(blob.height, 1e-6);
    const aspectScore = symmetricRatio(expectedAspect, blobAspect);

    const recencyScore = 1 - gap / settings.reidentifyWindowFrames;

    return positionScore * 0.4 + areaScore * 0.25 + aspectScore * 0.15 + recencyScore * 0.2;
}

function symmetricRatio(expected: number, actual: number): number {
    if (expected <= 1e-6 || actual <= 1e-6) return 0;
    const logRatio = Math.abs(Math.log(actual / expected));
    return Math.max(0, 1 - logRatio / Math.LN2);
}
