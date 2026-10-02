import type { CapturedFrame } from "./MediaTypes";

export type FrameSampleHandler = (frame: CapturedFrame, timestampSeconds: number) => void;

/**
 * Captures frames from a playing <video> for inference, at most
 * `maxFps` per second. Driven by requestVideoFrameCallback, so capture
 * follows actually-presented frames rather than a timer. The handler
 * owns each frame and must close it (or transfer it).
 *
 * This only rate-limits capture; dropping frames while the worker is
 * busy is FrameGate's job.
 */
export class FrameSampler {
    private maxFps = 15;
    private callbackHandle: number | null = null;
    private lastSampleSeconds = -Infinity;
    private capturing = false;
    private handler: FrameSampleHandler | null = null;

    constructor(private readonly video: HTMLVideoElement) {}

    setMaxFps(maxFps: number): void {
        this.maxFps = maxFps;
    }

    onFrame(handler: FrameSampleHandler): void {
        this.handler = handler;
    }

    start(): void {
        this.stop();
        // Reset on every start: after a full playthrough this would otherwise
        // still hold a time near the end and reject samples on replay.
        this.lastSampleSeconds = -Infinity;
        const step = () => {
            this.maybeSample();
            this.callbackHandle = this.video.requestVideoFrameCallback(step);
        };
        this.callbackHandle = this.video.requestVideoFrameCallback(step);
    }

    stop(): void {
        if (this.callbackHandle === null) return;
        this.video.cancelVideoFrameCallback(this.callbackHandle);
        this.callbackHandle = null;
    }

    /** One capture that ignores the rate cap, for the paused frame after a seek. */
    async captureNow(): Promise<void> {
        this.lastSampleSeconds = this.video.currentTime;
        await this.captureAndEmit();
    }

    private maybeSample(): void {
        if (this.capturing) return;
        if (this.video.currentTime - this.lastSampleSeconds < 1 / this.maxFps) return;
        this.lastSampleSeconds = this.video.currentTime;
        void this.captureAndEmit();
    }

    private async captureAndEmit(): Promise<void> {
        if (!this.handler) return;
        this.capturing = true;
        try {
            const seconds = this.video.currentTime;
            const frame: CapturedFrame =
                typeof VideoFrame !== "undefined"
                    ? new VideoFrame(this.video, { timestamp: Math.round(seconds * 1_000_000) })
                    : await createImageBitmap(this.video);
            this.handler(frame, seconds);
        } finally {
            this.capturing = false;
        }
    }
}
