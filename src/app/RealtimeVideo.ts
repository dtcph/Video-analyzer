import type { DetectResult } from "../inference/InferenceClient";
import { DetectionHold } from "../inference/DetectionHold";
import type { TimedDetections } from "../inference/DetectionHold";
import { FrameGate } from "../inference/FrameGate";
import type { FrameGateStats } from "../inference/FrameGate";
import { FrameSampler } from "../input/FrameSampler";
import type { CapturedFrame } from "../input/MediaTypes";
import type { VideoPlayer } from "../input/VideoPlayer";
import { RateMeter } from "../utils/RateMeter";

/** A <video>-backed source: a file (VideoSource) or a live camera (WebcamSource). */
export interface RealtimeSource {
    readonly element: HTMLVideoElement;
    readonly player: VideoPlayer;
    /** Live sources keep their clock running while paused and cannot seek. */
    readonly live: boolean;
    currentTime(): number;
    captureFrame(mediaTime: number): Promise<CapturedFrame>;
    captureDisplayedFrame(): Promise<CapturedFrame>;
}

export interface RealtimeVideoDeps {
    /** Runs detection with the current settings; resolves null when no model is available (frame already closed). */
    detect(frame: CapturedFrame): Promise<DetectResult | null>;
    /**
     * Detections of a frame sampled during forward playback, in capture order:
     * the tracker's input. Called before `onUpdate`. Paused-frame detections
     * are never passed here, so pausing or seeking cannot count an object twice.
     */
    onSampledResult(mediaTime: number, result: DetectResult): void;
    /** A seek started: the scene jumps, so tracks must be dropped. */
    onSeek(): void;
    /**
     * Live source only: playback resumed after a pause. Called once, just
     * before the first sampled result after resuming, with the stream time at
     * the pause and that result's time (the gap is the paused duration plus
     * up to one sampling interval).
     */
    onLiveResume?(pausedAt: number, resumedAt: number): void;
    /** A new result was accepted or the shown result was cleared (seek). */
    onUpdate(): void;
    onError(message: string): void;
}

export interface RealtimeStats extends FrameGateStats {
    /** Results per second actually achieved (sliding 2 s window). */
    effectiveFps: number;
    lastResult: DetectResult | null;
}

/**
 * Realtime detection alongside native playback (Phase 3) of a video file or,
 * since Phase 5, a live camera:
 * - while playing, presented frames are sampled at most `maxInferenceFps`
 *   per second (FrameSampler) and sent to the worker when it is idle
 *   (FrameGate): one frame in flight, the newest one waiting and sent as
 *   soon as the worker answers, older ones dropped and counted, so a slow
 *   device gets a lower inference rate, never a lagging backlog;
 * - each result is tagged with its frame's media time and held on screen
 *   (DetectionHold) until a newer one arrives;
 * - on pause, after a seek while paused, and at the end, the displayed frame
 *   itself is detected (never dropped), so "Current frame" counts match it;
 * - a seek clears the shown boxes at once and discards in-flight results
 *   from before the seek (epoch counter);
 * - results of frames sampled while playing go to the tracker
 *   (`onSampledResult`); paused-frame results only feed the display.
 */
interface SampledFrame {
    frame: CapturedFrame;
    mediaTime: number;
    epoch: number;
}

export class RealtimeVideo {
    readonly hold = new DetectionHold(0.5);
    private readonly gate = new FrameGate<SampledFrame>((sampled) => sampled.frame.close());
    private readonly meter = new RateMeter(2000);
    private readonly sampler: FrameSampler;
    private readonly disposers: (() => void)[] = [];
    private epoch = 0;
    private lastResult: DetectResult | null = null;
    /** Live source: stream time when it was paused, until the first sampled result after resuming. */
    private pausedAt: number | null = null;
    private resumed = false;

    constructor(
        private readonly source: RealtimeSource,
        private readonly deps: RealtimeVideoDeps,
        maxInferenceFps: number
    ) {
        const video = source.element;
        this.gate.setOpen(true);
        this.sampler = new FrameSampler(video, maxInferenceFps);
        this.sampler.onSample((mediaTime) => this.sample(mediaTime));

        this.disposers.push(
            source.player.onStateChange((state) => {
                if (state === "playing") {
                    if (this.pausedAt !== null) this.resumed = true;
                    this.sampler.start();
                } else {
                    this.sampler.stop();
                    if (source.live && state === "paused" && this.pausedAt === null) {
                        this.pausedAt = source.currentTime();
                    }
                    if (state === "paused" || state === "ready") void this.detectDisplayedFrame();
                }
            })
        );
        const onSeeking = () => {
            this.epoch++;
            this.gate.clearWaiting();
            this.hold.clear();
            this.deps.onSeek();
            this.deps.onUpdate();
        };
        const onSeeked = () => {
            if (video.paused) void this.detectDisplayedFrame();
        };
        video.addEventListener("seeking", onSeeking);
        video.addEventListener("seeked", onSeeked);
        this.disposers.push(() => {
            video.removeEventListener("seeking", onSeeking);
            video.removeEventListener("seeked", onSeeked);
        });
    }

    setMaxFps(maxFps: number): void {
        this.sampler.setMaxFps(maxFps);
    }

    /** The result to draw for the frame at `displayTime`. */
    resultAt(displayTime: number): TimedDetections | null {
        return this.hold.at(displayTime);
    }

    /** True once the paused frame's own detections are available. */
    hasExactResult(): boolean {
        return this.hold.isExact(this.source.currentTime());
    }

    /** Re-runs detection on the paused frame (e.g. after an IoU or input-size change). */
    redetect(): void {
        if (this.source.element.paused) void this.detectDisplayedFrame();
    }

    stats(): RealtimeStats {
        return { ...this.gate.getStats(), effectiveFps: this.meter.rate(), lastResult: this.lastResult };
    }

    dispose(): void {
        this.epoch++;
        this.sampler.stop();
        this.gate.setOpen(false);
        for (const dispose of this.disposers) dispose();
    }

    private sample(mediaTime: number): void {
        const epoch = this.epoch;
        // Captured even while a frame is in flight: it must be taken now, while it is the presented frame.
        void this.source.captureFrame(mediaTime).then(
            (frame) => {
                const sampled = { frame, mediaTime, epoch };
                if (this.gate.offer(sampled)) void this.run(sampled, true);
            },
            () => {} // a missed sample (no presented frame yet): the next one is sampled as usual
        );
    }

    private async detectDisplayedFrame(): Promise<void> {
        const epoch = this.epoch;
        const video = this.source.element;
        // Right after loading there may be metadata but no decoded frame yet.
        if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
            await new Promise<void>((resolve) => video.addEventListener("loadeddata", () => resolve(), { once: true }));
        }
        if (!(await this.gate.acquireWhenIdle())) return;
        if (epoch !== this.epoch || !video.paused || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
            this.finish();
            return;
        }
        const mediaTime = this.source.currentTime();
        let frame: CapturedFrame;
        try {
            frame = await this.source.captureDisplayedFrame();
        } catch (error) {
            this.finish();
            this.deps.onError(
                `Could not capture the video frame: ${error instanceof Error ? error.message : String(error)}`
            );
            return;
        }
        if (epoch !== this.epoch) {
            // A seek happened while waiting for the frame.
            frame.close();
            this.finish();
            return;
        }
        await this.run({ frame, mediaTime, epoch }, false);
    }

    private async run({ frame, mediaTime, epoch }: SampledFrame, sampled: boolean): Promise<void> {
        try {
            const result = await this.deps.detect(frame);
            if (!result || epoch !== this.epoch) return;
            this.lastResult = result;
            this.meter.record();
            this.hold.set({ mediaTime, detections: result.detections });
            if (sampled && this.resumed && this.pausedAt !== null && mediaTime > this.pausedAt) {
                this.deps.onLiveResume?.(this.pausedAt, mediaTime);
                this.pausedAt = null;
                this.resumed = false;
            }
            if (sampled) this.deps.onSampledResult(mediaTime, result);
            this.deps.onUpdate();
        } catch (error) {
            if (epoch === this.epoch) this.deps.onError(error instanceof Error ? error.message : String(error));
        } finally {
            this.finish();
        }
    }

    /** Frees the worker slot; a frame sampled meanwhile is sent right away. */
    private finish(): void {
        const next = this.gate.release();
        if (next) void this.run(next, true);
    }
}
