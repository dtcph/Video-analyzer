import type { Track, TrackPoint, TrackStatus } from "./TrackTypes";

export function createTrack(id: number, firstPoint: TrackPoint): Track {
    return {
        id,
        blobs: [firstPoint],
        startFrame: firstPoint.frame,
        endFrame: firstPoint.frame,
        confidence: firstPoint.confidence,
        status: "active"
    };
}

export function appendTrackPoint(track: Track, point: TrackPoint): void {
    track.blobs.push(point);
    track.endFrame = point.frame;
    track.confidence = averageConfidence(track);
}

export function setTrackStatus(track: Track, status: TrackStatus): void {
    track.status = status;
}

export function latestPoint(track: Track): TrackPoint | undefined {
    return track.blobs[track.blobs.length - 1];
}

export function pointAtFrame(track: Track, frame: number): TrackPoint | undefined {
    return track.blobs.find((point) => point.frame === frame);
}

export function averageConfidence(track: Track): number {
    if (track.blobs.length === 0) return 0;
    const sum = track.blobs.reduce((acc, point) => acc + point.confidence, 0);
    return sum / track.blobs.length;
}

export function durationInFrames(track: Track): number {
    return track.endFrame - track.startFrame + 1;
}

/**
 * Per-frame velocity (normalized units/frame) derived from the track's
 * last two points, or null when there isn't enough history yet.
 */
export function trackVelocity(track: Track): { vx: number; vy: number } | null {
    const n = track.blobs.length;
    if (n < 2) return null;

    const previous = track.blobs[n - 2];
    const latest = track.blobs[n - 1];
    const frameDelta = latest.frame - previous.frame;
    if (frameDelta <= 0) return null;

    return {
        vx: (latest.x - previous.x) / frameDelta,
        vy: (latest.y - previous.y) / frameDelta
    };
}

/**
 * Where a track's center is expected next, extrapolated linearly from
 * its current velocity. Falls back to the last known point when the
 * track has no velocity yet (a single-point track).
 */
export function predictNextPoint(track: Track, framesAhead = 1): { x: number; y: number } {
    const latest = latestPoint(track);
    if (!latest) return { x: 0, y: 0 };

    const velocity = trackVelocity(track);
    if (!velocity) return { x: latest.x, y: latest.y };

    return {
        x: latest.x + velocity.vx * framesAhead,
        y: latest.y + velocity.vy * framesAhead
    };
}

/**
 * Average confidence over a track's most recent points — used to
 * detect a track that has recently become unreliable, independent of
 * its all-time average.
 */
export function recentConfidence(track: Track, sampleSize = 5): number {
    if (track.blobs.length === 0) return 0;
    const recent = track.blobs.slice(-sampleSize);
    const sum = recent.reduce((acc, point) => acc + point.confidence, 0);
    return sum / recent.length;
}
