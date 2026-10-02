import type { BlobData } from "../tracking/TrackTypes";
import type { GlobalMotion } from "./GlobalMotionEstimator";
import type { AnalysisModeId } from "../settings/AnalysisModes";

export interface ExposureData {
    rgbClipRatio: number;

    redClipRatio: number;
    greenClipRatio: number;
    blueClipRatio: number;

    luminanceHighlightRatio: number;

    crushedBlackRatio: number;

    minLuminance: number;
    maxLuminance: number;
    meanLuminance: number;
}

/** Per-pixel exposure category bitmask, one byte per pixel at analysis resolution. */
export const enum ExposureMaskBit {
    Clip = 0b001,
    Highlight = 0b010,
    CrushedBlack = 0b100
}

/**
 * One motion candidate as reported for debug inspection — a deliberately
 * thin summary (normalized position/size, persistence, direction hint,
 * which path found it, and — only when rejected — why) rather than the
 * full internal MotionCandidate (density/compactness/magnitude etc. stay
 * internal to BlobDetector; nothing about "why" a shape looks the way it
 * does needs to leave the detection layer). See MotionCandidate.ts and
 * MotionCandidateFilter.ts for what actually produced these.
 */
export interface MotionCandidateDebug {
    x: number;
    y: number;
    width: number;
    height: number;
    persistence: number;
    directionConsistency: number;
    motionDx?: number;
    motionDy?: number;
    path: "normal" | "small";
    /** Present only for entries in DetectorDebugInfo.rejectedCandidates. */
    reason?: string;
}

/**
 * Detection-pipeline internals for the "Detector debug" view — only
 * populated when AnalysisSettings.detectorDebugEnabled is on, since
 * these are full-frame buffers that cost real time/memory to compute
 * and transfer for no benefit while nobody's looking at them. Lets the
 * debug overlay show exactly where in the pipeline (diff -> camera
 * compensation -> threshold -> morphology -> contours -> candidate
 * filtering) a given frame's result came from, rather than only the
 * final blob boxes.
 */
export interface DetectorDebugInfo {
    globalMotion: GlobalMotion;
    /** Grayscale (0..255) |current - previous|, before any camera compensation — one byte per pixel, row-major, same dimensions as width/height below. */
    rawDiff: Uint8Array;
    /** Grayscale |current - compensated(previous)| — identical to rawDiff whenever globalMotion.valid is false (nothing was compensated). */
    compensatedDiff: Uint8Array;
    /** The normal-path binary mask (0 or 255) after threshold + morphology, before candidate filtering — see BlobDetector's dual-path design for why this isn't the only mask. */
    motionMask: Uint8Array;
    width: number;
    height: number;
    /** Every candidate (both paths) that survived MotionCandidateFilter and became a blob this frame. */
    acceptedCandidates: MotionCandidateDebug[];
    /** Every candidate MotionCandidateFilter rejected this frame, with why — off the hot path entirely unless detectorDebugEnabled, and drawing them is a separate, further opt-in view toggle. */
    rejectedCandidates: MotionCandidateDebug[];
}

/** Result of analyzing one sampled frame, at analysis resolution. */
export interface FrameAnalysis {
    frame: number;
    timestamp: number;

    width: number;
    height: number;

    blobs: BlobData[];
    exposure: ExposureData;
    /** One ExposureMaskBit combination per pixel, row-major, same dimensions as width/height. */
    exposureMask: Uint8Array;
    /** See DetectorDebugInfo — undefined unless detectorDebugEnabled is on. */
    detectorDebug?: DetectorDebugInfo;
}

export interface AnalysisSettings {
    /**
     * Which AnalysisStrategy the worker runs (see src/analysis/strategies/).
     * Changing it swaps the strategy and resets detector state. The app's
     * per-mode defaults live in src/settings/SettingsSchema.ts (presetFor),
     * not in DEFAULT_ANALYSIS_SETTINGS below.
     */
    mode: AnalysisModeId;
    /** Motion (frame-to-frame grayscale difference) binarization threshold for blob detection, 0..1 (mapped to 0..255 for OpenCV) — see BlobDetector. Not a brightness cutoff: a blob is a region that changed since the previous analyzed frame, not a region of a particular intensity. */
    threshold: number;
    /** Minimum blob area, normalized as a fraction of total frame area. */
    minBlobArea: number;
    /** Maximum blob area, normalized as a fraction of total frame area. */
    maxBlobArea: number;
    /** Morphological open/close iterations applied to the threshold mask to remove noise, 0 = off. */
    morphologyStrength: number;
    /** Optional Gaussian blur kernel radius in px (at analysis resolution) applied before thresholding, 0 = off. */
    blurRadius: number;

    /** When on, BlobDetector estimates global (camera) translation each frame (see GlobalMotionEstimator/SceneMotionEstimator, gated by cameraMotionMode) and compensates for it before diffing, so panning doesn't read as motion everywhere. Never applied when the estimate's own confidence is too low — this only ever removes motion the estimator actually trusts, it doesn't force compensation. */
    cameraCompensationEnabled: boolean;
    /**
     * Which motion-estimation path BlobDetector uses when
     * cameraCompensationEnabled is on: "legacy" is the original grid-based
     * block-matching translation + coarse 2x2 residual grid
     * (GlobalMotionEstimator); "motion-field" is the sparse-optical-flow
     * based estimator (SparseMotionEstimator + SceneMotionEstimator) built
     * to handle real 3D camera translation through a scene with depth
     * (drone footage, a camera moving through traffic) far better, via
     * ~10x more correspondences and a finer regional grid. Both report the
     * same GlobalMotion shape, so everything downstream (BlobDetector's
     * compensation, MotionCandidateFilter's parallax gate, the debug HUD)
     * works unchanged regardless of which produced it. Kept switchable
     * (rather than replacing the legacy path outright) specifically so
     * regression testing stays easy — see scripts/detectorScenarios.ts,
     * which exercises both.
     */
    cameraMotionMode: "legacy" | "motion-field";
    /** When on, BlobDetector computes and reports the extra per-frame buffers in DetectorDebugInfo (raw diff, compensated diff, final motion mask, candidates) for the debug view — real per-frame cost, left off by default. */
    detectorDebugEnabled: boolean;
    /** When on, BlobDetector runs a second, more sensitive detection pass (lower area floor, gentler morphology) alongside the normal one, specifically for small/distant objects the normal path's own minimum area would otherwise miss — gated by stricter persistence/direction requirements (see MotionCandidateFilter) precisely because more sensitivity alone would also catch far more noise. */
    smallObjectDetectionEnabled: boolean;

    /** Luminance at/above which a pixel counts as a crushed-black shadow, 0..1. */
    shadowThreshold: number;
    /** Luminance at/above which a pixel counts as a highlight, 0..1. */
    highlightThreshold: number;
    /** RGB channel value (normalized 0..1) at/above which that channel counts as clipped. */
    clipThreshold: number;

    /**
     * Resolution frames are downscaled to for analysis. Set per-loaded-video
     * (see fitWithinPreservingAspect) to match the source's aspect ratio
     * within ANALYSIS_RESOLUTION_BUDGET — never a fixed 16:9 stretch.
     */
    analysisWidth: number;
    analysisHeight: number;

    /** How many frames per second are sampled for analysis, independent of playback frame rate. */
    sampleFps: number;
}

/** Max analysis-canvas footprint; actual per-video dimensions are fit within this preserving aspect ratio. */
export const ANALYSIS_RESOLUTION_BUDGET = { width: 960, height: 540 };

/**
 * Detector-level defaults — what BlobDetector uses when driven directly
 * (scripts/detectorScenarios.ts) and the base the harness's V1 profiles
 * start from. The APP starts from the selected mode's preset instead
 * (SettingsSchema.presetFor), which e.g. turns camera compensation off for
 * the steady mode.
 */
export const DEFAULT_ANALYSIS_SETTINGS: AnalysisSettings = {
    mode: "steady",
    // These four were tuned for the old brightness-threshold detector
    // (a region above/below a fixed intensity cutoff, typically a solid
    // filled shape) and don't transfer to a motion-diff signal, whose
    // real, meaningful regions are often thin slivers (a slowly-moving
    // edge only differs from its background over a couple of pixels of
    // travel) rather than solid blobs:
    //  - threshold 0.5 (127/255) demanded a near-black-to-white change
    //    to register as "motion" at all — real, clearly-visible motion
    //    at ordinary contrast (e.g. a mid-gray object crossing a
    //    somewhat-lighter background) routinely falls well under that.
    //  - morphologyStrength 1 (an erosion-based open) reliably erases a
    //    motion sliver only 1-2px wide, i.e. exactly the signature of
    //    slow motion — see scripts/detectorScenarios.ts's slow-movement
    //    scenario, which only starts passing once morphology is off.
    //  - minBlobArea 0.0005 was sized for solid brightness regions and
    //    filters out exactly those same thin slivers even with
    //    morphology out of the way.
    // Verified against scripts/detectorScenarios.ts, not just reasoned
    // about — see the written report for what's still real-footage-only.
    threshold: 0.12,
    minBlobArea: 0.0002,
    maxBlobArea: 0.5,
    morphologyStrength: 0,
    blurRadius: 0,
    cameraCompensationEnabled: true,
    cameraMotionMode: "legacy",
    detectorDebugEnabled: false,
    smallObjectDetectionEnabled: true,
    shadowThreshold: 0.02,
    highlightThreshold: 0.85,
    clipThreshold: 0.98,
    analysisWidth: ANALYSIS_RESOLUTION_BUDGET.width,
    analysisHeight: ANALYSIS_RESOLUTION_BUDGET.height,
    sampleFps: 12
};
