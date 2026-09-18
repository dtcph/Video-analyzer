import type { AnalysisSettings, FrameAnalysis } from "./AnalysisTypes";
import { DEFAULT_ANALYSIS_SETTINGS } from "./AnalysisTypes";
import { BlobDetector } from "./BlobDetector";
import { ExposureAnalyzer } from "./ExposureAnalyzer";

/**
 * Coordinates per-frame analysis (blob detection + exposure stats).
 * Runs synchronously on the main thread for now; the heavy per-pixel
 * work is intended to move into AnalysisWorker once profiling shows
 * it's needed.
 */
export class AnalysisEngine {
    private settings: AnalysisSettings = { ...DEFAULT_ANALYSIS_SETTINGS };
    private detector = new BlobDetector();

    updateSettings(partial: Partial<AnalysisSettings>): void {
        this.settings = { ...this.settings, ...partial };
    }

    getSettings(): AnalysisSettings {
        return this.settings;
    }

    analyzeFrame(frame: number, timestamp: number, imageData: ImageData): FrameAnalysis {
        const blobs = this.detector.detect(imageData, this.settings);
        const exposure = ExposureAnalyzer.analyze(imageData, this.settings);
        return { frame, timestamp, width: imageData.width, height: imageData.height, blobs, exposure };
    }
}
