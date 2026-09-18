import type { CapturedFrame } from "../workers/WorkerMessages";

export type FrameSampleHandler = (frame: CapturedFrame, frameNumber: number, timestampSeconds: number) => void;

const webCodecsSupported = typeof VideoFrame !== "undefined";

async function captureFrame(video: HTMLVideoElement): Promise<CapturedFrame> {
    if (webCodecsSupported) {
        return new VideoFrame(video, { timestamp: video.currentTime * 1_000_000 });
    }
    return createImageBitmap(video);
}

/**
 * Extracts frames from the video independently of playback/UI updates.
 * While playing, samples at a configurable rate (via
 * requestVideoFrameCallback where supported, so extraction is tied to
 * actually-decoded frames rather than a fixed timer) capped well below
 * the source frame rate. captureNow() bypasses the rate cap for a
 * single on-demand capture, used to keep scrub feedback immediate.
 */
export class FrameSampler {
    private sampleFps = 12;
    private playbackFrameRate = 30;

    private rvfcHandle: number | null = null;
    private intervalHandle: number | null = null;
    private lastSampleSeconds = -Infinity;
    private capturing = false;
    private handler: FrameSampleHandler | null = null;

    constructor(private readonly video: HTMLVideoElement) {}

    configure(sampleFps: number, playbackFrameRate: number): void {
        this.sampleFps = sampleFps;
        this.playbackFrameRate = playbackFrameRate;
    }

    onFrame(handler: FrameSampleHandler): void {
        this.handler = handler;
    }

    start(): void {
        this.stop();

        if (typeof this.video.requestVideoFrameCallback === "function") {
            const step = () => {
                this.maybeSample();
                this.rvfcHandle = this.video.requestVideoFrameCallback(step);
            };
            this.rvfcHandle = this.video.requestVideoFrameCallback(step);
        } else {
            this.intervalHandle = window.setInterval(() => this.maybeSample(), 1000 / this.sampleFps);
        }
    }

    stop(): void {
        if (this.rvfcHandle !== null) {
            this.video.cancelVideoFrameCallback(this.rvfcHandle);
            this.rvfcHandle = null;
        }
        if (this.intervalHandle !== null) {
            window.clearInterval(this.intervalHandle);
            this.intervalHandle = null;
        }
    }

    /** On-demand capture that ignores the sample-rate cap, for scrub/seek feedback while paused. */
    async captureNow(): Promise<void> {
        this.lastSampleSeconds = this.video.currentTime;
        await this.captureAndEmit();
    }

    private maybeSample(): void {
        const minIntervalSeconds = 1 / this.sampleFps;
        if (this.video.currentTime - this.lastSampleSeconds < minIntervalSeconds) return;
        if (this.capturing) return;

        this.lastSampleSeconds = this.video.currentTime;
        void this.captureAndEmit();
    }

    private async captureAndEmit(): Promise<void> {
        if (!this.handler) return;

        this.capturing = true;
        try {
            const seconds = this.video.currentTime;
            const frame = await captureFrame(this.video);
            const frameNumber = Math.round(seconds * this.playbackFrameRate);
            this.handler(frame, frameNumber, seconds);
        } finally {
            this.capturing = false;
        }
    }
}
