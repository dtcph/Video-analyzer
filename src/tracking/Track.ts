import type { CameraMotionEstimate, Track, TrackEvent, TrackPoint, TrackStatus } from "./TrackTypes";

/** EMA smoothing factor for Track.expectedSize — how much weight a single new observation gets against the track's learned size. Low enough that one oddly-sized detection can't redefine what a track's blob "should" look like. */
const EXPECTED_SIZE_SMOOTHING = 0.25;
/** Recent lifecycle events kept per track — enough for debug inspection without an unbounded log. */
const MAX_EVENTS = 20;

export function createTrack(id: number, firstPoint: TrackPoint): Track {
    const size = sizeOf(firstPoint);
    return {
        id,
        blobs: [firstPoint],
        startFrame: firstPoint.frame,
        endFrame: firstPoint.frame,
        confidence: firstPoint.confidence,
        status: "tentative",
        consecutiveMatches: 1,
        lostFrames: 0,
        expectedSize: size,
        predictedPosition: { x: firstPoint.x, y: firstPoint.y },
        predictedSize: { width: firstPoint.width, height: firstPoint.height },
        searchRadius: 0,
        events: [{ frame: firstPoint.frame, type: "created", confidence: firstPoint.confidence }]
    };
}

export function appendTrackPoint(track: Track, point: TrackPoint): void {
    track.blobs.push(point);
    track.endFrame = point.frame;
    track.confidence = averageConfidence(track);
    track.lostFrames = 0;
    updateExpectedSize(track, point);
}

/**
 * Folds a new observation into the track's learned expected size via
 * exponential moving average, rather than just remembering the last
 * frame's size — see Track.expectedSize. Exported separately from
 * appendTrackPoint so a revival (TrackReidentifier) can update it too
 * without re-deriving the smoothing logic.
 */
export function updateExpectedSize(track: Track, point: TrackPoint, smoothing = EXPECTED_SIZE_SMOOTHING): void {
    const width = track.expectedSize.width + (point.width - track.expectedSize.width) * smoothing;
    const height = track.expectedSize.height + (point.height - track.expectedSize.height) * smoothing;
    track.expectedSize = { width, height, area: width * height };
}

function sizeOf(point: TrackPoint): { width: number; height: number; area: number } {
    return { width: point.width, height: point.height, area: point.width * point.height };
}

export function setTrackStatus(track: Track, status: TrackStatus): void {
    track.status = status;
}

/** Appends a lifecycle event, trimming the oldest once MAX_EVENTS is exceeded — see Track.events. */
export function recordEvent(track: Track, event: TrackEvent): void {
    track.events.push(event);
    if (track.events.length > MAX_EVENTS) track.events.splice(0, track.events.length - MAX_EVENTS);
}

export function latestPoint(track: Track): TrackPoint | undefined {
    return track.blobs[track.blobs.length - 1];
}

/**
 * How many frames a box/label may hold its last known position past
 * the nearest recorded point before being treated as gone. Covers
 * ordinary sampling gaps (points are only recorded at the analysis
 * sample rate, e.g. 12fps, well below native playback) and analysis
 * running a little behind the displayed frame — both routine and
 * usually well under this window. A real tracking gap (occlusion, a
 * track pending reidentification) runs much longer than this, so it
 * still reads as "gone" rather than frozen in place; see
 * TrackingSettings.reidentifyWindowFrames, which is deliberately much
 * larger, for how long such a gap stays eligible to be bridged at all.
 */
const POSITION_HOLD_FRAMES = 12;

/**
 * The track's position as of `frame`: its most recent recorded point
 * at or before that frame, provided that point isn't more than
 * POSITION_HOLD_FRAMES behind — otherwise the gap reads as an actual
 * loss (including the interior of a reidentified track's gap, not
 * just its tail) rather than a frozen box. This is frame-gap-based,
 * not `status`-based: a revived track's blobs array itself contains
 * the gap (extending it just appends a far-later point to the same
 * array), so status alone can't tell "recently sampled" from "holding
 * across a bridged loss" — only the actual distance to the nearest
 * recorded point can.
 *
 * Returns undefined before the track starts, which also means a lost
 * track's earlier, legitimately-tracked history still resolves
 * correctly when scrubbing back into it — track data is never deleted,
 * only appended to.
 */
export function pointAtOrBeforeFrame(track: Track, frame: number): TrackPoint | undefined {
    if (frame < track.startFrame) return undefined;

    let result: TrackPoint | undefined;
    for (const point of track.blobs) {
        if (point.frame > frame) break;
        result = point;
    }
    if (!result || frame - result.frame > POSITION_HOLD_FRAMES) return undefined;
    return result;
}

/** Whether a point sits within `margin` (normalized) of the frame boundary — used to tell "probably left the frame" from "briefly occluded" when a track goes lost. */
export function isNearFrameEdge(point: TrackPoint, margin: number): boolean {
    const left = point.x - point.width / 2;
    const right = point.x + point.width / 2;
    const top = point.y - point.height / 2;
    const bottom = point.y + point.height / 2;
    return left <= margin || top <= margin || right >= 1 - margin || bottom >= 1 - margin;
}

/**
 * Folds `drop`'s recorded points into `keep`, as if they'd always been
 * the same track, and discards `drop`'s own history — used when two
 * tracks turn out to be the same object (see
 * TrackManager.mergeDuplicateActiveTracks and BlobTracker's
 * reidentification path). On a frame both recorded, `keep`'s own point
 * wins rather than an arbitrary pick.
 */
export function mergeInto(keep: Track, drop: Track): void {
    const byFrame = new Map<number, TrackPoint>();
    for (const point of drop.blobs) byFrame.set(point.frame, point);
    for (const point of keep.blobs) byFrame.set(point.frame, point);

    keep.blobs = Array.from(byFrame.values()).sort((a, b) => a.frame - b.frame);
    keep.startFrame = Math.min(keep.startFrame, drop.startFrame);
    keep.endFrame = Math.max(keep.endFrame, drop.endFrame);
    keep.confidence = averageConfidence(keep);
    // A currently-matched status (active/uncertain/tentative) on either
    // side wins over one that had already drifted toward lost/abandoned
    // — the merge itself proves the object is present this frame.
    // "active" beats "uncertain" beats "tentative" when both sides are
    // still-matched.
    const rank: Record<TrackStatus, number> = { lost: 0, abandoned: 0, tentative: 1, uncertain: 2, active: 3 };
    if (rank[drop.status] > rank[keep.status]) keep.status = drop.status;
    keep.lostFrames = 0;
    recordEvent(keep, { frame: keep.endFrame, type: "merged" });
}

export function averageConfidence(track: Track): number {
    if (track.blobs.length === 0) return 0;
    const sum = track.blobs.reduce((acc, point) => acc + point.confidence, 0);
    return sum / track.blobs.length;
}

export function durationInFrames(track: Track): number {
    return track.endFrame - track.startFrame + 1;
}

const VELOCITY_SAMPLE_SIZE = 6;

/**
 * Velocity (normalized units/frame), averaged over the track's recent
 * frame-to-frame deltas and weighted toward the most recent — not just
 * the last two points. A single noisy detection (blob edge jitter,
 * a slightly off contour) shouldn't be able to swing the prediction
 * this is used for on its own; smoothing over a short window damps
 * that out while still tracking real changes in motion. Returns null
 * when there isn't at least two points' worth of history yet.
 */
export function trackVelocity(track: Track, sampleSize = VELOCITY_SAMPLE_SIZE): { vx: number; vy: number } | null {
    const points = track.blobs.slice(-sampleSize);
    if (points.length < 2) return null;

    let vxSum = 0;
    let vySum = 0;
    let weightSum = 0;
    for (let i = 1; i < points.length; i++) {
        const frameDelta = points[i].frame - points[i - 1].frame;
        if (frameDelta <= 0) continue;
        const weight = i; // later deltas (closer to "now") count more
        vxSum += ((points[i].x - points[i - 1].x) / frameDelta) * weight;
        vySum += ((points[i].y - points[i - 1].y) / frameDelta) * weight;
        weightSum += weight;
    }
    if (weightSum === 0) return null;

    return { vx: vxSum / weightSum, vy: vySum / weightSum };
}

/**
 * Where a track's center is expected next, extrapolated linearly from
 * its (smoothed) velocity. Falls back to the last known point when the
 * track has no velocity yet (a single-point track) — which is also
 * exactly right for a track that's been holding still: near-zero
 * smoothed velocity predicts next-to-no movement, i.e. "expect it
 * around the same spot," with no separate stationary-case logic needed.
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
 * predictNextPoint, with a one-off correction on a frame flagged as
 * sudden camera movement (`camera.sudden`): the track's own smoothed
 * velocity necessarily still reflects motion from *before* the camera
 * moved, so it under- or over-shoots for exactly this frame. The
 * correction is how much the camera's estimated delta exceeds what the
 * track's velocity already assumes, scaled by how confident that
 * camera estimate is. A steady, ongoing pan needs no such correction —
 * it's already captured in the track's own velocity once a couple of
 * frames have gone by — so this only fires on the spike itself.
 */
export function predictPosition(
    track: Track,
    framesAhead: number,
    camera: CameraMotionEstimate | null
): { x: number; y: number } {
    const base = predictNextPoint(track, framesAhead);
    if (!camera || !camera.sudden) return base;

    const velocity = trackVelocity(track) ?? { vx: 0, vy: 0 };
    return {
        x: base.x + (camera.dx - velocity.vx) * camera.confidence * framesAhead,
        y: base.y + (camera.dy - velocity.vy) * camera.confidence * framesAhead
    };
}

const STABILITY_SAMPLE_SIZE = 8;
/** Variance (normalized units^2) in recent frame-to-frame velocity at or above which motion is treated as fully erratic (positionStability bottoms out at 0). */
const STABILITY_VARIANCE_SCALE = 0.0004;
/** How many recorded points a track needs before its stability is trusted at face value — see trackTrust. */
const TRUST_MATURITY_POINTS = 8;

/**
 * How consistent a track's recent frame-to-frame motion has been, 0
 * (erratic — velocity keeps changing direction/magnitude) to 1
 * (steady, whether that's moving smoothly or sitting still). Distinct
 * from just "is the average velocity small": a track jittering equally
 * left and right averages out to near-zero velocity but is not stable.
 * Needs at least 3 recent points (2 velocity samples) to judge; returns
 * 0 (untrusted) below that rather than guessing.
 */
export function positionStability(track: Track, sampleSize = STABILITY_SAMPLE_SIZE): number {
    const points = track.blobs.slice(-sampleSize);
    if (points.length < 3) return 0;

    const deltas: { vx: number; vy: number }[] = [];
    for (let i = 1; i < points.length; i++) {
        const frameDelta = points[i].frame - points[i - 1].frame;
        if (frameDelta <= 0) continue;
        deltas.push({
            vx: (points[i].x - points[i - 1].x) / frameDelta,
            vy: (points[i].y - points[i - 1].y) / frameDelta
        });
    }
    if (deltas.length < 2) return 0;

    const meanVx = deltas.reduce((sum, d) => sum + d.vx, 0) / deltas.length;
    const meanVy = deltas.reduce((sum, d) => sum + d.vy, 0) / deltas.length;
    const variance =
        deltas.reduce((sum, d) => sum + (d.vx - meanVx) ** 2 + (d.vy - meanVy) ** 2, 0) / deltas.length;

    return Math.max(0, 1 - variance / STABILITY_VARIANCE_SCALE);
}

/**
 * How much a track's next position should be trusted to predict
 * tightly, combining how consistent its recent motion has been
 * (positionStability) with how much history backs that up — a track
 * only a couple of points old ramps in gradually rather than being
 * fully trusted the instant it happens to look steady. This is what
 * TrackingConfidence.scoreMatch narrows its search radius by: a fresh
 * or erratic track keeps a wide, forgiving radius while it finds its
 * footing, and a long-running steady one narrows down, so it stops
 * being pulled onto a coincidentally similar blob elsewhere in frame.
 */
export function trackTrust(track: Track): number {
    const maturity = Math.min(1, track.blobs.length / TRUST_MATURITY_POINTS);
    return positionStability(track) * maturity;
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
