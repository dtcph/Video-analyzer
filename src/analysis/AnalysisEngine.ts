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

    getSettings(): AnalysisSettings {
        return this.settings;
    }

    async analyzeFrame(frame: number, timestamp: number, imageData: ImageData): Promise<FrameAnalysis> {
        const blobs = await this.detector.detect(imageData, this.settings);
        const { data: exposure, mask: exposureMask } = ExposureAnalyzer.analyze(imageData, this.settings);
        return { frame, timestamp, width: imageData.width, height: imageData.height, blobs, exposure, exposureMask };
    }
}
