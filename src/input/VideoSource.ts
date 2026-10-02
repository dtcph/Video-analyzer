import type { Size } from "../utils/geometry";
import type { InputSource } from "./InputSource";
import type { CapturedFrame } from "./MediaTypes";
import type { VideoPlayer } from "./VideoPlayer";

/** An uploaded video file, played by VideoPlayer. Frames are captured as WebCodecs VideoFrames. */
export class VideoSource implements InputSource {
    readonly kind = "video";

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

    /**
     * The frame currently shown by the <video>, as a WebCodecs VideoFrame,
     * created synchronously: call it inside a requestVideoFrameCallback to get
     * exactly the frame with that media time.
     *
     * Throws ("Invalid source state") while no frame has been presented yet,
     * e.g. right after loading or seeking a paused video; use
     * captureDisplayedFrame for that case.
     */
    captureFrame(mediaTime = this.currentTime()): Promise<CapturedFrame> {
        try {
            return Promise.resolve(
                new VideoFrame(this.player.element, { timestamp: Math.round(mediaTime * 1_000_000) })
            );
        } catch (error) {
            return Promise.reject(error);
        }
    }

    /**
     * The paused frame on screen. Chrome only has a capturable frame once it
     * has been presented (measured: even at readyState 4 right after loading,
     * both VideoFrame and createImageBitmap fail), so on failure this waits
     * for the next presented frame (requestVideoFrameCallback also fires for a
     * paused video after load or seek) and retries.
     */
    async captureDisplayedFrame(attempts = 3): Promise<CapturedFrame> {
        for (let attempt = 1; ; attempt++) {
            try {
                return await this.captureFrame();
            } catch (error) {
                if (attempt >= attempts) throw error;
                await this.nextPresentedFrame(1000);
            }
        }
    }

    private nextPresentedFrame(timeoutMs: number): Promise<void> {
        const video = this.player.element;
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                video.cancelVideoFrameCallback(handle);
                resolve();
            }, timeoutMs);
            const handle = video.requestVideoFrameCallback(() => {
                clearTimeout(timer);
                resolve();
            });
        });
    }

    dispose(): void {
        this.player.unload();
    }
}
