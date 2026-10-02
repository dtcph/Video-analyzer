import type { Detection } from "../inference/postprocess";
import type { RuntimeKind } from "./benchRuntime";
import type { LetterboxMode } from "../inference/preprocess";

export interface BenchInit {
    type: "init";
    runtime: RuntimeKind;
    modelUrl: string;
    numThreads: number;
}

export interface BenchRun {
    type: "run";
    image: ImageBitmap;
    inputSize: number;
    /** "rect" needs a dynamic-shape model. */
    letterbox: LetterboxMode;
    /** "raw": decode output0 [1, 84, N] + JS NMS; "nms": graph has NMS built in. */
    head: "raw" | "nms";
    warmup: number;
    iterations: number;
    confThreshold: number;
    iouThreshold: number;
}

export type BenchRequest = BenchInit | BenchRun;

export interface BenchReady {
    type: "ready";
    runtime: RuntimeKind;
    threads: number;
    crossOriginIsolated: boolean;
    fetchMs: number;
    sessionCreateMs: number;
    modelBytes: number;
}

export interface StageTimes {
    preprocess: number[];
    inference: number[];
    postprocess: number[];
}

export interface BenchResult {
    type: "result";
    /** First run (includes shader compilation / kernel setup). */
    firstRunMs: number;
    times: StageTimes;
    detections: Detection[];
}

export interface BenchError {
    type: "error";
    message: string;
}

export type BenchResponse = BenchReady | BenchResult | BenchError;
