import type { AnalysisSettings, FrameAnalysis } from "./AnalysisTypes";
import { DEFAULT_ANALYSIS_SETTINGS } from "./AnalysisTypes";
import { BlobDetector } from "./BlobDetector";
import { ExposureAnalyzer } from "./ExposureAnalyzer";

/**
 * Coordinates per-frame analysis (blob detection + exposure stats).
 * Runs inside AnalysisWorker, off the main thread. analyzeFrame is
 * async because blob detection awaits OpenCV.js's WASM runtime.
 */
export class AnalysisEngine {
    private settings: AnalysisSettings = { ...DEFAULT_ANALYSIS_SETTINGS };
    private detector = new BlobDetector();

    updateSettings(partial: Partial<AnalysisSettings>): void {
        this.settings = { ...this.settings, ...partial };
    }

    /** Restores every setting to its shipped default — used by the header reset button, distinct from clearing track/annotation data. */
    resetSettings(): void {
        this.settings = { ...DEFAULT_ANALYSIS_SETTINGS };
    }

    /** Drops any per-video detector state (BlobDetector's remembered previous frame) — call whenever analysis starts on a (possibly new) video, so the first frame's motion diff is never computed against a leftover frame from a different clip. */
    reset(): void {
        this.detector.reset();
    }

    getSettings(): AnalysisSettings {
        return this.settings;
    }

    async analyzeFrame(frame: number, timestamp: number, imageData: ImageData): Promise<FrameAnalysis> {
        const { blobs, debug } = await this.detector.detect(imageData, this.settings);
        const { data: exposure, mask: exposureMask } = ExposureAnalyzer.analyze(imageData, this.settings);
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
