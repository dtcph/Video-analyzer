import type { Size } from "../utils/geometry";
import type { CapturedFrame } from "./MediaTypes";

export type InputKind = "image" | "video" | "webcam";

/**
 * A media source the app can show on the stage and run detection on.
 * Implementations: ImageSource (Phase 2); video and webcam follow in
 * Phases 3 and 5.
 */
export interface InputSource {
    readonly kind: InputKind;
    /** The element shown on the stage. */
    readonly element: HTMLImageElement | HTMLVideoElement;
    /** Intrinsic frame size (orientation applied), or null until ready. */
    frameSize(): Size | null;
    /** Media time of the displayed frame, seconds (0 for a still image). */
    currentTime(): number;
    /** A copy of the displayed frame, ready to transfer to the worker. The caller owns (and must close) it. */
    captureFrame(): Promise<CapturedFrame>;
    /** Releases object URLs, bitmaps and streams. */
    dispose(): void;
}
