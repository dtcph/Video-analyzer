import type { Input, InputVideoTrack } from "mediabunny";
import type { DetectResult } from "../inference/InferenceClient";
import { SampleRateLimiter } from "../input/FrameSampler";
import type { AnalysisCache } from "./AnalysisCache";
import type { TrackingRun } from "./TrackingRun";

export interface AnalysisProgress {
    /** Samples analyzed so far (all runs). */
    framesDone: number;
    /** Estimated samples in the whole video at the sampling rate. */
    framesTotal: number;
    /** Media time reached, seconds. */
    mediaTime: number;
    duration: number;
    /** Wall time spent analyzing, all runs, ms. */
    elapsedMs: number;
    /** Estimated wall time left, ms (null until there is a rate to go by). */
    etaMs: number | null;
}

export interface VideoInfo {
    duration: number;
    /** Clockwise rotation the file asks for (portrait phone videos); frames are analyzed as displayed. */
    rotation: number;
    /** Average frame rate of the file. */
    frameRate: number;
    /** Estimated samples at the sampling rate. */
    framesTotal: number;
}

/** Thrown when the file cannot be decoded with WebCodecs here; realtime mode still works for it. */
export class UndecodableVideoError extends Error {
    constructor(detail: string) {
        super(`This video cannot be pre-analyzed in this browser (${detail}). Realtime mode still works.`);
        this.name = "UndecodableVideoError";
    }
}

/**
 * Decodes a video file with WebCodecs (demuxed by mediabunny: MP4/MOV, WebM,
 * MKV) and runs detection on every sample in order, without dropping: the
 * next frame is decoded while the current one is detected, and nothing is
 * skipped except by the sampling cap (max inference rate, as in realtime).
 * No DOM. Measured ~100–110 samples/s on the M4 Max with WebGPU for 720p to
 * 4K clips (docs/decisions.md §14), ~25× faster than seeking a <video>.
 *
 * Results go into an AnalysisCache and a TrackingRun. A run can be stopped
 * between samples and resumed later from the last cached sample.
 */
export class PreAnalysisRunner {
    private input: Input | null = null;
    private track: InputVideoTrack | null = null;
    private info: VideoInfo | null = null;
    private stopRequested = false;
    private running = false;
    private elapsedMs = 0;

    constructor(
        private readonly file: File,
        private readonly maxFps: number,
        private readonly detect: (frame: VideoFrame) => Promise<DetectResult | null>
    ) {}

    /** Opens the file and checks it can be decoded. Throws UndecodableVideoError if not. */
    async prepare(): Promise<VideoInfo> {
        if (this.info) return this.info;
        if (typeof VideoDecoder === "undefined") throw new UndecodableVideoError("no WebCodecs");
        // Loaded on first use: only pre-analysis needs the demuxer (~400 KB), so the app's first load stays small.
        const { ALL_FORMATS, BlobSource, Input } = await import("mediabunny");
        const input = new Input({ source: new BlobSource(this.file), formats: ALL_FORMATS });
        this.input = input;
        if (!(await input.canRead())) throw new UndecodableVideoError("unknown container");
        const track = await input.getPrimaryVideoTrack();
        if (!track) throw new UndecodableVideoError("no video track");
        if (!(await track.canDecode())) throw new UndecodableVideoError(`codec ${track.codec ?? "unknown"}`);
        this.track = track;
        const [duration, stats] = await Promise.all([track.computeDuration(), track.computePacketStats()]);
        const frameRate = stats.averagePacketRate;
        const framesTotal =
            frameRate > this.maxFps ? Math.ceil(duration * this.maxFps) : Math.max(stats.packetCount, 1);
        this.info = { duration, rotation: track.rotation, frameRate, framesTotal };
        return this.info;
    }

    isRunning(): boolean {
        return this.running;
    }

    /** Asks a run to end after the sample in flight. */
    stop(): void {
        this.stopRequested = true;
    }

    /**
     * Analyzes from after the last cached sample to the end (or until stop()).
     * Resolves "finished" or "stopped".
     */
    async run(
        cache: AnalysisCache,
        tracking: TrackingRun,
        onProgress: (progress: AnalysisProgress) => void
    ): Promise<"finished" | "stopped"> {
        const info = await this.prepare();
        const track = this.track as InputVideoTrack;
        if (this.running) throw new Error("PreAnalysisRunner: already running");
        this.running = true;
        this.stopRequested = false;

        const limiter = new SampleRateLimiter(this.maxFps);
        const resumeAfter = cache.lastTime();
        if (resumeAfter !== null) limiter.shouldSample(resumeAfter); // continue the sampling schedule
        const { VideoSampleSink } = await import("mediabunny");
        const sink = new VideoSampleSink(track);
        const segmentStart = performance.now();
        const segmentStartFrames = cache.length;
        const progress = (mediaTime: number): AnalysisProgress => {
            const elapsed = this.elapsedMs + (performance.now() - segmentStart);
            const doneThisRun = cache.length - segmentStartFrames;
            const rate = doneThisRun > 0 ? doneThisRun / (performance.now() - segmentStart) : 0;
            const left = Math.max(info.framesTotal - cache.length, 0);
            return {
                framesDone: cache.length,
                framesTotal: Math.max(info.framesTotal, cache.length),
                mediaTime,
                duration: info.duration,
                elapsedMs: elapsed,
                etaMs: rate > 0 ? left / rate : null
            };
        };

        let outcome: "finished" | "stopped" = "finished";
        try {
            onProgress(progress(resumeAfter ?? 0));
            for await (const sample of sink.samples(resumeAfter ?? undefined)) {
                const time = sample.timestamp;
                if ((resumeAfter !== null && time <= resumeAfter) || !limiter.shouldSample(time)) {
                    sample.close();
                    continue;
                }
                const decoded = sample.toVideoFrame();
                // Decoded frames are in coded orientation; tag the file's rotation so the worker draws the
                // frame as the <video> displays it (measured: same pixels as new VideoFrame(video)).
                const frame =
                    sample.rotation === 0 && !sample.flip
                        ? decoded
                        : new VideoFrame(decoded, orientation(sample.rotation, sample.flip));
                if (frame !== decoded) decoded.close();
                sample.close();
                const result = await this.detect(frame);
                if (!result) throw new Error("The model is not loaded.");
                const analyzed = { time, detections: result.detections };
                cache.add(analyzed);
                tracking.push(analyzed);
                onProgress(progress(time));
                if (this.stopRequested) {
                    outcome = "stopped";
                    break;
                }
            }
        } finally {
            this.elapsedMs += performance.now() - segmentStart;
            this.running = false;
        }
        if (outcome === "finished") onProgress({ ...progress(info.duration), etaMs: 0 });
        return outcome;
    }

    dispose(): void {
        this.stopRequested = true;
        this.input?.dispose();
        this.input = null;
        this.track = null;
    }
}

/**
 * VideoFrameInit with the WebCodecs `rotation` / `flip` members (Chrome supports them, verified in
 * Chrome 154; TypeScript 6's DOM types do not list them yet).
 */
function orientation(rotation: number, flip: boolean): VideoFrameInit {
    const init: VideoFrameInit & { rotation: number; flip: boolean } = { rotation, flip };
    return init;
}
