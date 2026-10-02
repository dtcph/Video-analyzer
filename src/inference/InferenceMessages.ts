import type { CapturedFrame } from "../input/MediaTypes";
import type { BackendPreference, ModelSize } from "../settings/SettingsSchema";
import type { BackendKind } from "./ortRuntime";
import type { Detection } from "./postprocess";

export interface LoadModelRequest {
    type: "load";
    requestId: number;
    modelSize: ModelSize;
    backend: BackendPreference;
    numThreads: number;
    /** Absolute URL of public/models/ (with trailing slash). */
    modelBaseUrl: string;
}

export interface DetectRequest {
    type: "detect";
    requestId: number;
    /** Transferred; the worker closes it. */
    frame: CapturedFrame;
    /** Long side of the model input, px. */
    inputSize: number;
    iouThreshold: number;
    /** Lowest score returned; the user's threshold is applied on the main thread. */
    scoreFloor: number;
}

export type InferenceRequest = LoadModelRequest | DetectRequest;

export interface ModelInfo {
    backend: BackendKind;
    threads: number;
    file: string;
    modelSize: ModelSize;
    /** User-facing fallback explanations (no WebGPU, no FP16, WebGPU failure). */
    notes: string[];
    fromCache: boolean;
    downloadMs: number;
    sessionMs: number;
    crossOriginIsolated: boolean;
}

export interface StageTimings {
    preprocessMs: number;
    inferenceMs: number;
    postprocessMs: number;
}

export interface LoadProgress {
    type: "progress";
    requestId: number;
    stage: "runtime" | "download" | "session";
    loadedBytes: number;
    totalBytes: number;
}

export interface ModelLoaded {
    type: "loaded";
    requestId: number;
    info: ModelInfo;
}

export interface DetectionsReady {
    type: "detections";
    requestId: number;
    detections: Detection[];
    timings: StageTimings;
    inputWidth: number;
    inputHeight: number;
}

export interface InferenceFailed {
    type: "error";
    requestId: number;
    message: string;
}

export type InferenceResponse = LoadProgress | ModelLoaded | DetectionsReady | InferenceFailed;
