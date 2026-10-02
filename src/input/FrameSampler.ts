/**
 * Decides which presented video frames to sample, at most `maxFps` per
 * second of media time. A backward jump (seek, loop) restarts the schedule,
 * so sampling never stalls after seeking back. Pure; tested directly.
 */
export class SampleRateLimiter {
    private lastSampled = -Infinity;

    constructor(private maxFps: number) {}

    setMaxFps(maxFps: number): void {
        this.maxFps = maxFps;
    }

    reset(): void {
        this.lastSampled = -Infinity;
    }

    /** True if the frame at `mediaTime` should be sampled; records it if so. */
    shouldSample(mediaTime: number): boolean {
        if (mediaTime < this.lastSampled) this.lastSampled = -Infinity;
        // 4 ms of tolerance: frame times are quantized (29.97 fps → 33.37 ms), and a strict check
        // would make a 30 fps cap skip every other frame of 30 fps video.
        if (mediaTime - this.lastSampled < 1 / this.maxFps - 0.004) return false;
        this.lastSampled = mediaTime;
        return true;
    }
}

export type SampleHandler = (mediaTime: number) => void;

/**
 * Calls the handler for presented frames of a playing <video>, rate-capped
 * by SampleRateLimiter. Driven by requestVideoFrameCallback, so each call
 * happens right when that frame is on screen; the handler can capture it
 * synchronously (new VideoFrame(video)) and gets its exact media time.
 */
export class FrameSampler {
    private readonly limiter: SampleRateLimiter;
    private handle: number | null = null;
    private handler: SampleHandler | null = null;

    constructor(
        private readonly video: HTMLVideoElement,
        maxFps: number
    ) {
        this.limiter = new SampleRateLimiter(maxFps);
    }

    setMaxFps(maxFps: number): void {
        this.limiter.setMaxFps(maxFps);
    }

    onSample(handler: SampleHandler): void {
        this.handler = handler;
    }

    start(): void {
        if (this.handle !== null) return;
        this.limiter.reset();
        const step = (_now: number, metadata: VideoFrameCallbackMetadata) => {
            this.handle = this.video.requestVideoFrameCallback(step);
            if (this.limiter.shouldSample(metadata.mediaTime)) this.handler?.(metadata.mediaTime);
        };
        this.handle = this.video.requestVideoFrameCallback(step);
    }

    stop(): void {
        if (this.handle === null) return;
        this.video.cancelVideoFrameCallback(this.handle);
        this.handle = null;
    }
}
