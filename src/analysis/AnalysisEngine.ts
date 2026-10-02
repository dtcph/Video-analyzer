import type { AnalysisSettings, FrameAnalysis } from "./AnalysisTypes";
import { DEFAULT_ANALYSIS_SETTINGS } from "./AnalysisTypes";
import { BlobDetector } from "./BlobDetector";
import type { DetectorFrameStats } from "./BlobDetector";
import { ExposureAnalyzer } from "./ExposureAnalyzer";
import type { AnalysisStrategy } from "./strategies/AnalysisStrategy";
import { createStrategy } from "./strategies/strategies";
import type { AnalysisModeId } from "../settings/AnalysisModes";
import { presetFor } from "../settings/SettingsSchema";

/**
 * Coordinates per-frame analysis (blob detection + exposure stats) for the
 * active AnalysisStrategy, chosen by AnalysisSettings.mode. Runs inside
 * AnalysisWorker, off the main thread (the main-thread instance in
 * AppState only holds shared settings). analyzeFrame is async because blob
 * detection awaits OpenCV.js's WASM runtime.
 */
export class AnalysisEngine {
    private settings: AnalysisSettings = { ...DEFAULT_ANALYSIS_SETTINGS, ...presetFor("steady") };
    private detector = new BlobDetector();
    private strategy: AnalysisStrategy = createStrategy(this.settings.mode);

    /** A `mode` change swaps the strategy and resets all detector state — the previous frame and persistence history belong to the old strategy's view of the scene. */
    updateSettings(partial: Partial<AnalysisSettings>): void {
        this.settings = { ...this.settings, ...partial };
        if (this.settings.mode !== this.strategy.id) {
            this.strategy = createStrategy(this.settings.mode);
            this.detector.reset();
        }
    }

    /** Restores the current mode's preset (keeping the per-video analysis resolution). */
    resetSettings(): void {
        const { analysisWidth, analysisHeight, mode } = this.settings;
        this.settings = { ...DEFAULT_ANALYSIS_SETTINGS, ...presetFor(mode), analysisWidth, analysisHeight };
    }

    /** Drops any per-video detector state (BlobDetector's remembered previous frame, persistence history, strategy state) — call whenever analysis starts on a (possibly new) video, so the first frame's motion diff is never computed against a leftover frame from a different clip. */
    reset(): void {
        this.detector.reset();
        this.strategy.reset();
    }

    getSettings(): AnalysisSettings {
        return this.settings;
    }

    getStrategyId(): AnalysisModeId {
        return this.strategy.id;
    }

    /** Detector instrumentation for the most recently analyzed frame — see DetectorFrameStats. Used by offline evaluation (scripts/evaluateClips.ts), not the UI. */
    getLastDetectorStats(): DetectorFrameStats | null {
        return this.detector.getLastFrameStats();
    }

    async analyzeFrame(frame: number, timestamp: number, imageData: ImageData): Promise<FrameAnalysis> {
        const settings = this.strategy.resolveSettings(this.settings);
        const { blobs, debug } = await this.detector.detect(imageData, settings, (context) => this.strategy.estimateCameraMotion(context));
        const { data: exposure, mask: exposureMask } = ExposureAnalyzer.analyze(imageData, settings);
        return {
            frame,
            timestamp,
            width: imageData.width,
            height: imageData.height,
            blobs,
            exposure,
            exposureMask,
            detectorDebug: debug
        };
    }
}
