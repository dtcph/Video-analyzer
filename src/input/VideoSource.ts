import type { Size } from "../utils/geometry";
import type { InputSource } from "./InputSource";
import type { CapturedFrame } from "./MediaTypes";
import { captureDisplayedVideoFrame, captureVideoFrame } from "./videoCapture";
import type { VideoPlayer } from "./VideoPlayer";

/** An uploaded video file, played by VideoPlayer. Frames are captured as WebCodecs VideoFrames. */
export class VideoSource implements InputSource {
    readonly kind = "video";
    /** A file: media time stops while paused and can be sought. */
    readonly live = false;

    private constructor(readonly player: VideoPlayer) {}

    static async load(file: File, player: VideoPlayer): Promise<VideoSource> {
        await player.load(file);
        return new VideoSource(player);
    }

    get element(): HTMLVideoElement {
        return this.player.element;
    }

    frameSize(): Size | null {
        const { videoWidth: width, videoHeight: height } = this.player.element;
        return width > 0 && height > 0 ? { width, height } : null;
    }

    currentTime(): number {
        return this.player.getCurrentSeconds();
    }

    /** The frame on screen with this media time (call inside requestVideoFrameCallback). See captureVideoFrame. */
    captureFrame(mediaTime = this.currentTime()): Promise<CapturedFrame> {
        return captureVideoFrame(this.player.element, mediaTime);
    }

    /** The paused frame on screen, waiting for it to be presented if needed. See captureDisplayedVideoFrame. */
    captureDisplayedFrame(): Promise<CapturedFrame> {
        return captureDisplayedVideoFrame(this.player.element);
    }

    dispose(): void {
        this.player.unload();
    }
}
