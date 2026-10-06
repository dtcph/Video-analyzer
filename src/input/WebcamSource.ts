import type { Size } from "../utils/geometry";
import type { InputSource } from "./InputSource";
import type { CapturedFrame } from "./MediaTypes";
import { captureDisplayedVideoFrame, captureVideoFrame } from "./videoCapture";
import type { VideoPlayer } from "./VideoPlayer";
import type { CameraDevice } from "./webcam";
import { cameraDevices, webcamConstraints } from "./webcam";

/** What the camera actually delivers (it may differ from WEBCAM_CONFIG). */
export interface CameraMode {
    label: string;
    deviceId: string;
    width: number;
    height: number;
    frameRate: number | null;
}

/**
 * A live camera (getUserMedia), shown by the shared VideoPlayer. Frames are
 * captured like video files: `new VideoFrame(video)` inside
 * requestVideoFrameCallback (measured as fast as MediaStreamTrackProcessor
 * here, and it gives exactly the presented frame; docs/decisions.md §13).
 * Media time is the stream's clock in seconds; it keeps running while the
 * element is paused, which RealtimeVideo turns into a tracker skip.
 * dispose() stops every track, which releases the camera.
 */
export class WebcamSource implements InputSource {
    readonly kind = "webcam";
    /** A live stream: media time keeps running while paused, and there is no seeking. */
    readonly live = true;
    private readonly endedHandlers = new Set<() => void>();
    private disposed = false;

    private constructor(
        readonly player: VideoPlayer,
        private readonly stream: MediaStream
    ) {
        this.track.addEventListener("ended", this.onTrackEnded);
    }

    /**
     * Asks for the camera (permission prompt on first use). Not shown yet:
     * call show() once the caller still wants it (a slow permission prompt
     * may be overtaken by a file load). Throws getUserMedia's DOMException.
     */
    static async open(player: VideoPlayer, deviceId: string | null = null): Promise<WebcamSource> {
        const media = navigator.mediaDevices as MediaDevices | undefined;
        if (!media?.getUserMedia) {
            throw Object.assign(new Error("navigator.mediaDevices is not available"), { name: "NoMediaDevicesError" });
        }
        const stream = await media.getUserMedia(webcamConstraints(deviceId));
        return new WebcamSource(player, stream);
    }

    /** Attaches the stream to the player's <video> (paused; call player.play()). Releases the camera on failure. */
    async show(): Promise<void> {
        try {
            await this.player.attachStream(this.stream, this.track.label);
        } catch (error) {
            this.dispose();
            throw error;
        }
    }

    /** The cameras Chrome reports (labels appear once permission was granted). */
    static async listCameras(): Promise<CameraDevice[]> {
        const media = navigator.mediaDevices as MediaDevices | undefined;
        if (!media?.enumerateDevices) return [];
        return cameraDevices(await media.enumerateDevices());
    }

    get element(): HTMLVideoElement {
        return this.player.element;
    }

    private get track(): MediaStreamTrack {
        return this.stream.getVideoTracks()[0];
    }

    mode(): CameraMode {
        const settings = this.track.getSettings();
        return {
            label: this.track.label,
            deviceId: settings.deviceId ?? "",
            width: settings.width ?? this.element.videoWidth,
            height: settings.height ?? this.element.videoHeight,
            frameRate: settings.frameRate ?? null
        };
    }

    /** The camera went away (unplugged, revoked, taken by the system). Not called for dispose(). */
    onEnded(handler: () => void): () => void {
        this.endedHandlers.add(handler);
        return () => this.endedHandlers.delete(handler);
    }

    frameSize(): Size | null {
        const { videoWidth: width, videoHeight: height } = this.element;
        return width > 0 && height > 0 ? { width, height } : null;
    }

    currentTime(): number {
        return this.element.currentTime;
    }

    captureFrame(mediaTime = this.currentTime()): Promise<CapturedFrame> {
        return captureVideoFrame(this.element, mediaTime);
    }

    captureDisplayedFrame(): Promise<CapturedFrame> {
        return captureDisplayedVideoFrame(this.element);
    }

    /** Stops every track (the camera light goes off) and detaches the stream. */
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.track.removeEventListener("ended", this.onTrackEnded);
        for (const track of this.stream.getTracks()) track.stop();
        if (this.element.srcObject === this.stream) this.player.unload();
    }

    private readonly onTrackEnded = () => {
        if (this.disposed) return;
        for (const handler of this.endedHandlers) handler();
    };
}
