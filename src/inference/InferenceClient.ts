import type { CapturedFrame } from "../input/MediaTypes";
import type { BackendPreference, ModelSize } from "../settings/SettingsSchema";
import type {
    DetectionsReady,
    InferenceRequest,
    InferenceResponse,
    LoadProgress,
    ModelInfo
} from "./InferenceMessages";
import { defaultThreadCount } from "./ortRuntime";

export type DetectResult = Omit<DetectionsReady, "type" | "requestId">;

interface Pending {
    resolve: (value: never) => void;
    reject: (error: Error) => void;
    onProgress?: (progress: LoadProgress) => void;
}

type WithoutId<T> = T extends unknown ? Omit<T, "requestId"> : never;

/**
 * Main-thread handle to the inference worker: promise-based requests with
 * typed messages. Frames are transferred (never copied). Rate limiting and
 * dropping frames are the caller's job (FrameGate).
 */
export class InferenceClient {
    private readonly worker: Worker;
    private readonly pending = new Map<number, Pending>();
    private nextId = 1;

    constructor(worker?: Worker) {
        this.worker = worker ?? new Worker(new URL("./inference.worker.ts", import.meta.url), { type: "module" });
        this.worker.onmessage = (event: MessageEvent<InferenceResponse>) => this.handle(event.data);
        this.worker.onerror = (event) => this.failAll(new Error(event.message || "The inference worker crashed."));
    }

    load(
        options: { modelSize: ModelSize; backend: BackendPreference; modelBaseUrl: string },
        onProgress?: (progress: LoadProgress) => void
    ): Promise<ModelInfo> {
        return this.request(
            { type: "load", numThreads: defaultThreadCount(navigator.hardwareConcurrency || 4), ...options },
            [],
            onProgress
        );
    }

    detect(
        frame: CapturedFrame,
        options: { inputSize: number; iouThreshold: number; scoreFloor: number }
    ): Promise<DetectResult> {
        return this.request({ type: "detect", frame, ...options }, [frame]);
    }

    dispose(): void {
        this.worker.terminate();
        this.failAll(new Error("The inference worker was stopped."));
    }

    private request<T>(
        message: WithoutId<InferenceRequest>,
        transfer: Transferable[],
        onProgress?: (p: LoadProgress) => void
    ): Promise<T> {
        const requestId = this.nextId++;
        return new Promise<T>((resolve, reject) => {
            this.pending.set(requestId, { resolve: resolve as (value: never) => void, reject, onProgress });
            this.worker.postMessage({ ...message, requestId } as InferenceRequest, transfer);
        });
    }

    private handle(message: InferenceResponse): void {
        const pending = this.pending.get(message.requestId);
        if (!pending) return;
        switch (message.type) {
            case "progress":
                pending.onProgress?.(message);
                return;
            case "loaded":
                this.pending.delete(message.requestId);
                pending.resolve(message.info as never);
                return;
            case "detections": {
                this.pending.delete(message.requestId);
                const { type: _type, requestId: _id, ...result } = message;
                pending.resolve(result as never);
                return;
            }
            case "error":
                this.pending.delete(message.requestId);
                pending.reject(new Error(message.message));
        }
    }

    private failAll(error: Error): void {
        for (const pending of this.pending.values()) pending.reject(error);
        this.pending.clear();
    }
}
