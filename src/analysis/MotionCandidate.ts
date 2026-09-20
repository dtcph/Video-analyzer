/** Which detection pass produced a candidate — see BlobDetector's dual-path design. */
export type MotionPath = "normal" | "small";

/**
 * An internal, pre-tracking measurement of one connected motion region —
 * the unit CandidateExtractor produces, MotionPersistenceTracker enriches
 * frame to frame, and MotionCandidateFilter accepts or rejects before
 * anything becomes a `BlobData` the tracker ever sees. All spatial
 * fields are in analysis-resolution PIXELS (unlike BlobData, which is
 * normalized 0..1) — this type never leaves BlobDetector except as
 * optional summary fields on BlobData/DetectorDebugInfo, so there's no
 * need to normalize it internally.
 *
 * This is deliberately not a classification — nothing here says what
 * moved, only measurable properties of the region and its short
 * history, which is what the candidate-quality filtering is built on.
 */
export interface MotionCandidate {
    x: number;
    y: number;
    width: number;
    height: number;
    centerX: number;
    centerY: number;

    /** Contour area in px^2 (may be noticeably less than width*height for a non-rectangular or thin region). */
    area: number;

    /** How many mask pixels within the bounding box are actually "on". */
    motionPixelCount: number;
    /** motionPixelCount / (width*height) — low density inside a large box is the signature of a thin/sparse region (an edge sliver), not a filled silhouette. */
    motionDensity: number;

    /** Mean/median frame-difference magnitude (0..255) over the region's motion pixels — how strong the change was, not just whether it crossed the threshold. */
    meanMagnitude: number;
    medianMagnitude: number;

    /** 4*pi*area/perimeter^2 — 1.0 for a perfect circle, low for thin/irregular/jagged shapes. */
    compactness: number;
    /** max(width,height)/min(width,height), >= 1 — how stretched the bounding box is. */
    elongation: number;

    /** Consecutive analyzed frames (including this one) a spatially-coherent region has been seen for — see MotionPersistenceTracker. Starts at 1 for a brand-new region. This is detection-level confidence, entirely separate from Track lifecycle/status. */
    persistence: number;
    /** Frame-to-frame centroid displacement (px), from the same persistence matching — null until a region has matched across at least two frames. */
    displacementX: number | null;
    displacementY: number | null;
    /** 0..1 smoothed measure of how consistent recent displacement direction has been — high for something moving steadily one way, low for something jittering randomly (wind-shaken foliage) even if it keeps reappearing in roughly the same place. 0.5 (neutral — not yet evidence either way) until a region has at least two matched observations. */
    directionConsistency: number;

    path: MotionPath;

    /**
     * Scene-motion context, attached by `enrichWithSceneMotion` (see
     * MotionCandidateExtractor.ts) only when a GlobalMotion estimate is
     * available — i.e. always alongside `path`/`persistence`, but their
     * MEANING depends on which estimator produced the GlobalMotion (see
     * GlobalMotion.model): under the motion-field path these describe
     * this candidate's relationship to the finer regional flow grid, not
     * just the legacy 2x2 parallax gate MotionCandidateFilter already
     * consumes directly (`isParallaxBackgroundResidual`). Present so a
     * FUTURE filtering pass — or the debug HUD — can distinguish
     * "high-confidence independent motion" from "possible depth/parallax
     * motion" without recomputing the regional lookup; MotionCandidateFilter
     * itself does not currently read these beyond its existing
     * regionalCellFor gate.
     */
    /** Magnitude (px) of this candidate's own regional cell's residual motion — near zero means the scene-motion model already explains this part of the frame; large means this region carries real leftover motion the global fit doesn't. 0 when no coherent cell covers this candidate's position. */
    localMotionResidual?: number;
    /** GlobalMotion.confidence at the time this candidate was measured — how much to trust the scene-motion estimate at all this frame. */
    sceneMotionConfidence?: number;
    /** 0..1 — how well-supported this candidate's regional cell is: 1 for a cell with many tightly-agreeing correspondences (a real depth layer), 0 for one with too few samples or too much internal disagreement to mean anything. */
    motionLayerConfidence?: number;
    /** 0..1 inverse of the regional cell's own dispersion, capped — a direct "do this cell's correspondences actually agree with each other" reading, independent of sample count (unlike motionLayerConfidence, which folds both together). */
    spatialCoherence?: number;
}
