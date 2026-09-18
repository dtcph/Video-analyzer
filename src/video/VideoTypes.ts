export interface VideoMetadata {
    fileName: string;
    fileSizeBytes: number;
    durationSeconds: number;
    width: number;
    height: number;
    frameRate: number;
    frameRateDetected: boolean;
}

export type PlaybackState = "empty" | "loading" | "ready" | "playing" | "paused";

export interface VideoFrameRef {
    frameIndex: number;
    timestampSeconds: number;
}
