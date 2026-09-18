export interface VideoMetadata {
    fileName: string;
    durationSeconds: number;
    width: number;
    height: number;
    frameRate: number;
}

export type PlaybackState = "empty" | "loading" | "ready" | "playing" | "paused";

export interface VideoFrameRef {
    frameIndex: number;
    timestampSeconds: number;
}
