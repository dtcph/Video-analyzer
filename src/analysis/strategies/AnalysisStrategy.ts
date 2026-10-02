import type { AnalysisSettings } from "../AnalysisTypes";
import type { CvMat, OpenCv } from "../BlobDetector";
import type { GlobalMotion } from "../GlobalMotionEstimator";
import type { AnalysisModeId } from "../../settings/AnalysisModes";

/** Everything a strategy needs to estimate background (camera) motion between two consecutive analyzed frames. Mats are owned by the caller — a strategy must not delete or keep them. */
export interface CameraMotionContext {
    cv: OpenCv;
    /** Previous analyzed frame, grayscale (post-blur). */
    previous: CvMat;
    /** Current analyzed frame, grayscale (post-blur). */
    current: CvMat;
    width: number;
    height: number;
    settings: AnalysisSettings;
}

/**
 * One analysis mode's detection behavior, plugged into BlobDetector by
 * AnalysisEngine. Runs in the worker only (CV code); the mode's metadata
 * — label, preset, which settings apply — lives in src/settings/ so the
 * UI never imports this.
 *
 * Swapping strategy resets all detector state (AnalysisEngine does this),
 * so a strategy may keep its own per-video state and clear it in reset().
 */
export interface AnalysisStrategy {
    readonly id: AnalysisModeId;
    /** The settings the detector should actually use: the incoming values with this strategy's fixed settings (SettingsSchema.FIXED_SETTINGS) enforced, so a stray UPDATE_SETTINGS can't e.g. turn compensation on in steady mode. */
    resolveSettings(settings: AnalysisSettings): AnalysisSettings;
    /** Background-motion estimate between the two frames; return NO_GLOBAL_MOTION for "assume a static camera". */
    estimateCameraMotion(context: CameraMotionContext): GlobalMotion;
    /** Drop any per-video state. */
    reset(): void;
}
