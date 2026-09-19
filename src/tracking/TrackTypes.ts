/** All spatial values are normalized 0..1 against frame width/height. */
export interface BlobData {
    id: number;

    /** Top-left corner of the bounding box. Use centerX/centerY for the blob's center. */
    x: number;
    y: number;

    width: number;
    height: number;

    centerX: number;
    centerY: number;

    area: number;
}

export interface TrackPoint {
    frame: number;

    /** Center of the bounding box (unlike BlobData.x/y, which is top-left). */
    x: number;
    y: number;

    width: number;
    height: number;

    confidence: number;
}

/**
 * DETECTED -> TENTATIVE -> ACTIVE -> UNCERTAIN -> LOST -> (REIDENTIFIED ->) ACTIVE
 *                                                     \-> ABANDONED
 *
 * "tentative": just created from an unmatched blob; not confirmed yet.
 *   Requires `confirmationFrames` consecutive matches before it's
 *   trusted as "active" — filters out one-frame detection noise from
 *   ever becoming a persistent, visualized track.
 * "active": confirmed and being matched frame to frame with healthy
 *   confidence.
 * "uncertain": still being matched each frame (same matching pool as
 *   "active"), but its recent match confidence has dipped — a soft
 *   warning state before it actually goes unmatched, rendered/scored
 *   with reduced trust but not yet handed to the reidentifier.
 * "lost": no longer matched at all, but recently enough (within
 *   TrackingSettings.reidentifyWindowFrames) that a new blob appearing
 *   near its predicted position can revive it under the same id — see
 *   BlobTracker/TrackReidentifier.
 * "abandoned": given up on permanently — either its reidentify window
 *   expired with no match, its confidence was too low to trust a
 *   revival, or its predicted trajectory crossed the frame edge (most
 *   likely left the frame rather than being briefly occluded). Its
 *   data and any label stay put for scrubbing back to, but it will
 *   never be revived.
 */
export type TrackStatus = "tentative" | "active" | "uncertain" | "lost" | "abandoned";

/**
 * This frame's estimate of global (camera) motion, in normalized
 * units/frame — see CameraMotionEstimator. `confidence` (0..1) reflects
 * how much and how consistently the supporting tracks agreed; a low
 * value means "not enough evidence", and consumers should discount the
 * vector accordingly rather than trusting it outright. `sudden` flags a
 * spike well above the recent baseline (an abrupt pan/shake starting),
 * which is specifically when prediction needs a one-off correction —
 * steady ongoing pans are already absorbed into each track's own
 * smoothed velocity and need no special handling.
 */
export interface CameraMotionEstimate {
    dx: number;
    dy: number;
    confidence: number;
    sudden: boolean;
}

/** A lifecycle transition worth remembering for debugging/visualization — see TrackLifecycle. */
export interface TrackEvent {
    frame: number;
    type: "created" | "confirmed" | "uncertain" | "lost" | "reidentified" | "abandoned" | "merged";
    confidence?: number;
}

export interface Track {
    id: number;

    /** Every recorded observation, in frame order. Called "points" in tracking literature generally; kept as `blobs` here since that name is already used throughout the rendering/UI layers. */
    blobs: TrackPoint[];

    startFrame: number;
    endFrame: number;

    confidence: number;

    status: TrackStatus;

    /** Consecutive accepted matches since creation — once it reaches TrackingSettings.confirmationFrames, status leaves "tentative" for "active". Stops incrementing (but isn't reset) once confirmed; only meaningful while tentative. */
    consecutiveMatches: number;

    /** Frames since this track was last matched (0 while active/tentative/uncertain and being matched every frame; grows while "lost"). Distinct from `endFrame`'s absolute frame number — this is the gap itself, which is what gating/search-radius growth is driven by. */
    lostFrames: number;

    /**
     * Smoothed expected size, updated by an exponential moving average
     * on every accepted observation (see Track.updateExpectedSize) —
     * deliberately not just "the last frame's size", so one bad
     * detection (e.g. a contour briefly merging with noise) can't
     * suddenly redefine what size a blob is expected to be. This is
     * what re-identification and gating compare a candidate blob's size
     * against, per-track rather than against one global threshold.
     */
    expectedSize: { width: number; height: number; area: number };

    /** This track's predicted position/size for the frame currently being processed — set by BlobTracker just before matching, and left in place afterward for debug visualization and inspection. */
    predictedPosition: { x: number; y: number };
    predictedSize: { width: number; height: number };
    /** The matching/reidentification search radius (normalized frame units) used this frame — see TrackingConfidence.predictionRadius / TrackReidentifier.reidentifyRadius. Stored as plain data purely so the rendering layer can draw the gating region in debug mode without importing tracking/analysis logic itself (see the CV/rendering separation in the project README). */
    searchRadius: number;

    /** Lifecycle history — see TrackEvent. Kept short (see TrackLifecycle.MAX_EVENTS); not a full audit log. */
    events: TrackEvent[];
}

/**
 * Configurable knobs for blob-to-track association and track lifecycle.
 * See TrackingConfidence.scoreMatch for how the weights combine into a
 * single match score, TrackAssociator for gating and the Hungarian
 * assignment step, and TrackManager/TrackLifecycle for the state
 * machine the thresholds below drive.
 */
export interface TrackingSettings {
    /** Minimum score (see scoreMatch) required to associate a blob with an existing track. */
    matchThreshold: number;
    /** A track is marked "lost" once its recent confidence drops below this value. */
    lossThreshold: number;
    /** A track is marked "lost" after this many consecutive frames with no accepted match. */
    maxFramesLost: number;

    /** Relative weight of predicted-position proximity in the match score. */
    weightPosition: number;
    /** Relative weight of bounding-box overlap (IoU) in the match score. */
    weightOverlap: number;
    /** Relative weight of blob-area similarity in the match score. */
    weightArea: number;
    /** Relative weight of movement-direction/magnitude consistency in the match score. */
    weightMovement: number;
    /** Relative weight of width/height aspect-ratio similarity in the match score. */
    weightAspect: number;

    /** Consecutive accepted matches a newly created track needs before it leaves "tentative" for "active" and starts being treated as a trusted, visualized track. */
    confirmationFrames: number;

    /**
     * How many frames after going lost a track stays eligible for
     * reidentification — an unmatched blob appearing near its
     * predicted position within this window revives it under the same
     * id rather than starting a new track. Past this window it's
     * abandoned.
     */
    reidentifyWindowFrames: number;
    /** Max normalized distance between a lost track's predicted position and a new blob for reidentification to consider them the same object, at the moment it's lost — this is a starting radius that grows with elapsed lost frames (see maxReidentifyDistance), not a fixed one. */
    reidentifyDistance: number;
    /** Absolute cap on the reidentification search radius no matter how long a track has been lost — prevents growing uncertainty from eventually letting a track jump anywhere in frame. */
    maxReidentifyDistance: number;
    /** Normalized distance from a frame's edge within which a track going lost there is assumed to have left the frame, and is abandoned immediately rather than held open for reidentification. */
    edgeMargin: number;
    /** Normalized distance below which two simultaneously active tracks are considered duplicates of the same object and merged into one. */
    mergeDistance: number;

    /**
     * How much a fully trusted track's matching search radius shrinks
     * relative to a fresh/erratic one (0 = no tightening ever, 1 = can
     * shrink almost to the floor below). See Track.trackTrust — trust
     * ramps up with both a track's recent motion consistency and how
     * much history it has, so this only kicks in once a track has
     * proven itself.
     */
    stabilityTightening: number;
    /** Floor on the search radius as a fraction of the base radius, so even a maximally trusted track keeps some room for legitimate motion. */
    minRadiusFraction: number;
    /** Absolute cap on the matching search radius (normalized frame units) regardless of trust/camera adjustments — this is what stops a track from ever being eligible to jump across a large portion of the frame in one step. */
    maxAssociationDistance: number;
    /** Multiplier applied to matching/reidentification search radii on a frame flagged as sudden camera movement — a stable object's on-screen position stops being predictable the moment the frame itself moves. See CameraMotionEstimator. */
    cameraShakeRadiusBoost: number;
    /** Minimum number of simultaneously active tracks needed before their aggregate motion is trusted as a camera-movement signal at all. */
    cameraMotionMinTracks: number;
    /** How many times above its recent running-average magnitude a frame's aggregate track motion must spike to be flagged as sudden camera movement. */
    cameraMotionSensitivity: number;
    /** Minimum aggregate motion magnitude (normalized units/frame) before a spike is even considered — filters out noise when everything is nearly still. */
    cameraMotionMinMagnitude: number;
    /** Smoothing factor (0..1) for the running-average baseline the sensitivity spike is measured against; higher adapts to new motion levels faster. */
    cameraMotionSmoothing: number;
}

export const DEFAULT_TRACKING_SETTINGS: TrackingSettings = {
    matchThreshold: 0.4,
    lossThreshold: 0.25,
    maxFramesLost: 5,
    weightPosition: 0.4,
    weightOverlap: 0.25,
    weightArea: 0.15,
    weightMovement: 0.2,
    weightAspect: 0.1,
    confirmationFrames: 3,
    reidentifyWindowFrames: 45,
    reidentifyDistance: 0.12,
    maxReidentifyDistance: 0.3,
    edgeMargin: 0.03,
    mergeDistance: 0.06,
    stabilityTightening: 0.7,
    minRadiusFraction: 0.3,
    maxAssociationDistance: 0.35,
    cameraShakeRadiusBoost: 1.8,
    cameraMotionMinTracks: 2,
    cameraMotionSensitivity: 2.2,
    cameraMotionMinMagnitude: 0.01,
    cameraMotionSmoothing: 0.25
};
