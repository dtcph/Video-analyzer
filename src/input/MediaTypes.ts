/**
 * A captured frame in transit to the inference worker. VideoFrame
 * (WebCodecs) where supported, ImageBitmap as the fallback. Both are
 * transferable and both must be closed by whoever ends up owning them.
 */
export type CapturedFrame = VideoFrame | ImageBitmap;

export interface VideoMetadata {
    fileName: string;
    fileSizeBytes: number;
    durationSeconds: number;
    width: number;
    height: number;
}

export type PlaybackState = "empty" | "loading" | "ready" | "playing" | "paused";
