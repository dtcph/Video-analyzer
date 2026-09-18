import { AnalysisEngine } from "../analysis/AnalysisEngine";
import type { CapturedFrame, WorkerRequest, WorkerResponse } from "./WorkerMessages";

/**
 * Runs frame analysis off the main thread. Captured frames (WebCodecs
 * VideoFrame or ImageBitmap, see FrameSampler) are transferred in,
 * downscaled to the configured analysis resolution via an
 * OffscreenCanvas, and handed to AnalysisEngine. Never touches the DOM.
 */
const engine = new AnalysisEngine();

let isAnalyzing = false;
let canvas: OffscreenCanvas | null = null;
let context: OffscreenCanvasRenderingContext2D | null = null;

function ensureCanvas(width: number, height: number): OffscreenCanvasRenderingContext2D {
    if (!canvas || canvas.width !== width || canvas.height !== height) {
        canvas = new OffscreenCanvas(width, height);
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("AnalysisWorker: could not acquire 2D context");
        context = ctx;
    }
    return context as OffscreenCanvasRenderingContext2D;
}

function processFrame(frame: CapturedFrame, frameNumber: number, timestamp: number): void {
    if (!isAnalyzing) {
        frame.close();
        const response: WorkerResponse = { type: "FRAME_DROPPED", frameNumber };
        self.postMessage(response);
        return;
    }

    const start = performance.now();
    const settings = engine.getSettings();
    const ctx = ensureCanvas(settings.analysisWidth, settings.analysisHeight);

    ctx.drawImage(frame as CanvasImageSource, 0, 0, settings.analysisWidth, settings.analysisHeight);
    frame.close();

    const imageData = ctx.getImageData(0, 0, settings.analysisWidth, settings.analysisHeight);
    const result = engine.analyzeFrame(frameNumber, timestamp, imageData);
    const processingTimeMs = performance.now() - start;

    const response: WorkerResponse = { type: "FRAME_ANALYZED", result, processingTimeMs };
    self.postMessage(response);
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
    const message = event.data;

    switch (message.type) {
        case "START_ANALYSIS":
            engine.updateSettings(message.settings);
            isAnalyzing = true;
            break;

        case "STOP_ANALYSIS":
            isAnalyzing = false;
            break;

        case "PROCESS_FRAME":
            processFrame(message.frame, message.frameNumber, message.timestamp);
            break;
    }
};
