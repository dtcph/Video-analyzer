import type { AnalysisSettings } from "../AnalysisTypes";
import { estimateGlobalMotion, NO_GLOBAL_MOTION } from "../GlobalMotionEstimator";
import type { GlobalMotion } from "../GlobalMotionEstimator";
import { estimateMotionField } from "../SceneMotionEstimator";
import type { AnalysisModeId } from "../../settings/AnalysisModes";
import { FIXED_SETTINGS } from "../../settings/SettingsSchema";
import type { AnalysisStrategy, CameraMotionContext } from "./AnalysisStrategy";

function withFixed(mode: AnalysisModeId, settings: AnalysisSettings): AnalysisSettings {
    return { ...settings, ...FIXED_SETTINGS[mode], mode };
}

/**
 * Static camera: the V1 motion-diff detector with camera compensation off.
 * Measured identical to V1's compensation-off output frame for frame on
 * steady.mp4 (and equal in every aggregate on steady-2.mp4) while skipping
 * the per-frame motion estimate entirely — see docs/v2/baseline.md. Also
 * what the webcam source will use.
 */
export class SteadyStrategy implements AnalysisStrategy {
    readonly id = "steady" as const;

    resolveSettings(settings: AnalysisSettings): AnalysisSettings {
        return withFixed(this.id, settings);
    }

    estimateCameraMotion(): GlobalMotion {
        return NO_GLOBAL_MOTION;
    }

    reset(): void {}
}

/**
 * Moving camera (handheld / drone / car). Phase 1: the three sub-modes
 * share the V1 compensation pipeline and differ only by preset, including
 * which estimator runs (AnalysisSettings.cameraMotionMode: block matching
 * or sparse optical flow). Phase 2 replaces estimateCameraMotion per
 * sub-mode (affine for handheld, homography for drone, a flow-field model
 * for car) — this class is the seam where that plugs in.
 */
export class MovingCameraStrategy implements AnalysisStrategy {
    constructor(readonly id: Exclude<AnalysisModeId, "steady">) {}

    resolveSettings(settings: AnalysisSettings): AnalysisSettings {
        return withFixed(this.id, settings);
    }

    estimateCameraMotion({ cv, previous, current, width, height, settings }: CameraMotionContext): GlobalMotion {
        return settings.cameraMotionMode === "motion-field"
            ? estimateMotionField(cv, previous, current, width, height, settings.detectorDebugEnabled)
            : estimateGlobalMotion(cv, previous, current, width, height, settings.detectorDebugEnabled);
    }

    reset(): void {}
}

export function createStrategy(mode: AnalysisModeId): AnalysisStrategy {
    return mode === "steady" ? new SteadyStrategy() : new MovingCameraStrategy(mode);
}
