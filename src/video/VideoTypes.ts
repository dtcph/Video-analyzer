export interface VideoMetadata {
    fileName: string;
    fileSizeBytes: number;
    durationSeconds: number;
    width: number;
    height: number;
    frameRate: number;
    frameRateDetected: boolean;
}

// "playing-reverse" was a manual reverse-scrub state (see VideoPlayer,
// backward playback disabled) — kept in the union for now but never set.
export type PlaybackState = "empty" | "loading" | "ready" | "playing" | "playing-reverse" | "paused";
