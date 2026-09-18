import { AnalysisEngine } from "../analysis/AnalysisEngine";
import type { AnalysisSettings } from "../analysis/AnalysisTypes";

/**
 * Runs frame analysis off the main thread. Not yet wired up by
 * AnalysisEngine's default path — reserved for when per-frame
 * processing (OpenCV.js blob detection) becomes expensive enough
 * to block playback.
 */
const engine = new AnalysisEngine();

export interface AnalyzeFrameRequest {
    type: "analyze-frame";
    frame: number;
    imageData: ImageData;
    settings?: Partial<AnalysisSettings>;
}

export type WorkerRequest = AnalyzeFrameRequest;

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
    const message = event.data;

    if (message.type === "analyze-frame") {
        if (message.settings) engine.updateSettings(message.settings);
        const result = engine.analyzeFrame(message.frame, message.imageData);
        self.postMessage({ type: "analysis-result", result });
    }
};
