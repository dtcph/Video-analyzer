import type { DetectResult } from "../inference/InferenceClient";
import { DetectionHold } from "../inference/DetectionHold";
import type { TimedDetections } from "../inference/DetectionHold";
import { FrameGate } from "../inference/FrameGate";
import type { FrameGateStats } from "../inference/FrameGate";
import { FrameSampler } from "../input/FrameSampler";
import type { CapturedFrame } from "../input/MediaTypes";
import type { VideoSource } from "../input/VideoSource";
import { RateMeter } from "../utils/RateMeter";

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
 * Realtime detection alongside native playback (Phase 3):
 * - while playing, presented frames are sampled at most `maxInferenceFps`
 *   per second (FrameSampler) and sent to the worker only if it is idle
 *   (FrameGate): one frame in flight, the rest dropped and counted, so a
 *   slow device gets a lower inference rate, never a lagging backlog;
 * - each result is tagged with its frame's media time and held on screen
 *   (DetectionHold) until a newer one arrives;
 * - on pause, after a seek while paused, and at the end, the displayed frame
 *   itself is detected (never dropped), so "Current frame" counts match it;
 * - a seek clears the shown boxes at once and discards in-flight results
 *   from before the seek (epoch counter);
 * - results of frames sampled while playing go to the tracker
 *   (`onSampledResult`); paused-frame results only feed the display.
 */
export class RealtimeVideo {
    readonly hold = new DetectionHold(0.5);
    private readonly gate = new FrameGate();
    private readonly meter = new RateMeter(2000);
    private readonly sampler: FrameSampler;
    private readonly disposers: (() => void)[] = [];
    private epoch = 0;
    private lastResult: DetectResult | null = null;

    constructor(
        private readonly source: VideoSource,
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
                    this.sampler.start();
                } else {
                    this.sampler.stop();
                    if (state === "paused" || state === "ready") void this.detectDisplayedFrame();
                }
            })
        );
        const onSeeking = () => {
            this.epoch++;
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

    resetStats(): void {
        this.gate.resetStats();
        this.meter.reset();
    }

    dispose(): void {
        this.epoch++;
        this.sampler.stop();
        this.gate.setOpen(false);
        for (const dispose of this.disposers) dispose();
    }

    private sample(mediaTime: number): void {
        if (!this.gate.tryAcquire()) return; // dropped: the previous frame is still in flight
        const epoch = this.epoch;
        void this.source.captureFrame(mediaTime).then(
            (frame) => this.run(frame, mediaTime, epoch, true),
            () => this.gate.release() // a missed sample, counted by the gate as accepted but never completed
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
            this.gate.release();
            return;
        }
        const mediaTime = this.source.currentTime();
        let frame: CapturedFrame;
        try {
            frame = await this.source.captureDisplayedFrame();
        } catch (error) {
            this.gate.release();
            this.deps.onError(
                `Could not capture the video frame: ${error instanceof Error ? error.message : String(error)}`
            );
            return;
        }
        if (epoch !== this.epoch) {
            // A seek happened while waiting for the frame.
            frame.close();
            this.gate.release();
            return;
        }
        await this.run(frame, mediaTime, epoch, false);
    }

    private async run(frame: CapturedFrame, mediaTime: number, epoch: number, sampled: boolean): Promise<void> {
        try {
            const result = await this.deps.detect(frame);
            if (!result || epoch !== this.epoch) return;
            this.lastResult = result;
            this.meter.record();
            this.hold.set({ mediaTime, detections: result.detections });
            if (sampled) this.deps.onSampledResult(mediaTime, result);
            this.deps.onUpdate();
        } catch (error) {
            if (epoch === this.epoch) this.deps.onError(error instanceof Error ? error.message : String(error));
        } finally {
            this.gate.release();
        }
    }
}
