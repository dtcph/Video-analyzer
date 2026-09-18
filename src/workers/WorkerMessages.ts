import type { AnalysisSettings, FrameAnalysis } from "../analysis/AnalysisTypes";

/**
 * A captured video frame in transit to the worker. VideoFrame (WebCodecs)
 * is used where the browser supports it; ImageBitmap is the fallback.
 * Both are transferable and both expose close().
 */
export type CapturedFrame = VideoFrame | ImageBitmap;

export interface ProcessFrameMessage {
    type: "PROCESS_FRAME";
    frame: CapturedFrame;
    frameNumber: number;
    timestamp: number;
}

export interface StartAnalysisMessage {
    type: "START_ANALYSIS";
    settings: AnalysisSettings;
}

export interface StopAnalysisMessage {
    type: "STOP_ANALYSIS";
}

export interface UpdateSettingsMessage {
    type: "UPDATE_SETTINGS";
    settings: Partial<AnalysisSettings>;
}

export type WorkerRequest = ProcessFrameMessage | StartAnalysisMessage | StopAnalysisMessage | UpdateSettingsMessage;

export interface FrameAnalyzedMessage {
    type: "FRAME_ANALYZED";
    result: FrameAnalysis;
    processingTimeMs: number;
}

export interface FrameDroppedMessage {
    type: "FRAME_DROPPED";
    frameNumber: number;
}

export type WorkerResponse = FrameAnalyzedMessage | FrameDroppedMessage;
