import type { AnalysisSettings, FrameAnalysis } from "./AnalysisTypes";
import type { CapturedFrame, WorkerRequest, WorkerResponse } from "../workers/WorkerMessages";

export interface AnalysisStats {
    framesQueued: number;
    framesProcessed: number;
    framesDropped: number;
    lastProcessingTimeMs: number;
    processingFps: number;
}

const INITIAL_STATS: AnalysisStats = {
    framesQueued: 0,
    framesProcessed: 0,
    framesDropped: 0,
    lastProcessingTimeMs: 0,
    processingFps: 0
};

export type AnalysisResultHandler = (result: FrameAnalysis) => void;
export type AnalysisStatsHandler = (stats: AnalysisStats) => void;

/**
 * Main-thread handle to AnalysisWorker. Keeps at most one frame in
 * flight — a sampled frame that arrives while the worker is still busy
 * is dropped (and closed) rather than queued, so the pipeline never
 * builds a backlog that would make playback catch-up feel laggy.
 */
export class AnalysisWorkerClient {
    private readonly worker: Worker;
    private inFlight = false;
    private running = false;

    private resultHandler: AnalysisResultHandler | null = null;
    private statsHandler: AnalysisStatsHandler | null = null;
    private stats: AnalysisStats = { ...INITIAL_STATS };

    constructor() {
        this.worker = new Worker(new URL("../workers/AnalysisWorker.ts", import.meta.url), { type: "module" });
        this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => this.handleMessage(event.data);
    }

    start(settings: AnalysisSettings): void {
        this.running = true;
        this.post({ type: "START_ANALYSIS", settings });
    }

    stop(): void {
        this.running = false;
        this.post({ type: "STOP_ANALYSIS" });
    }

    isRunning(): boolean {
        return this.running;
    }

    submitFrame(frame: CapturedFrame, frameNumber: number, timestamp: number): void {
        if (!this.running || this.inFlight) {
            frame.close();
            this.stats = { ...this.stats, framesDropped: this.stats.framesDropped + 1 };
            this.emitStats();
            return;
        }

        this.inFlight = true;
        this.stats = { ...this.stats, framesQueued: this.stats.framesQueued + 1 };
        const message: WorkerRequest = { type: "PROCESS_FRAME", frame, frameNumber, timestamp };
        this.worker.postMessage(message, [frame]);
    }

    onFrameAnalyzed(handler: AnalysisResultHandler): void {
        this.resultHandler = handler;
    }

    onStatsUpdate(handler: AnalysisStatsHandler): void {
        this.statsHandler = handler;
    }

    getStats(): AnalysisStats {
        return this.stats;
    }

    terminate(): void {
        this.worker.terminate();
    }

    private post(message: WorkerRequest): void {
        this.worker.postMessage(message);
    }

    private handleMessage(message: WorkerResponse): void {
        this.inFlight = false;

        if (message.type === "FRAME_ANALYZED") {
            this.stats = {
                ...this.stats,
                framesProcessed: this.stats.framesProcessed + 1,
                lastProcessingTimeMs: message.processingTimeMs,
                processingFps: message.processingTimeMs > 0 ? 1000 / message.processingTimeMs : 0
            };
            this.resultHandler?.(message.result);
        } else {
            this.stats = { ...this.stats, framesDropped: this.stats.framesDropped + 1 };
        }

        this.emitStats();
    }

    private emitStats(): void {
        this.statsHandler?.(this.stats);
    }
}
