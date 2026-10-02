import type { Box, Size } from "../utils/geometry";
import { containRect } from "../utils/geometry";

/** What every layer needs to draw one overlay frame. */
export interface OverlayView {
    /** Where the media is drawn on the canvas, in canvas pixels (letterboxed, object-fit: contain). */
    mediaRect: Box;
    /** Media time being displayed, seconds (0 for a still image). */
    timeSeconds: number;
    /** Canvas pixels per CSS pixel; scale line widths and fonts by it. */
    pixelRatio: number;
}

/** One visual layer (boxes, labels, debug views). Draws only; never computes detections. */
export interface OverlayLayer {
    render(ctx: CanvasRenderingContext2D, view: OverlayView): void;
}

export interface OverlaySource {
    /** Intrinsic media size, or null when nothing is loaded. */
    mediaSize(): Size | null;
    timeSeconds(): number;
}

/**
 * Draws registered layers onto one canvas laid over the media. The canvas
 * backing store follows its CSS size times devicePixelRatio, so boxes stay
 * sharp, and layers receive the letterboxed media rect so they can map
 * normalized coordinates without knowing about the stage.
 *
 * While a video plays, redraws per presented video frame (startVideoLoop);
 * startLoop is a plain requestAnimationFrame loop for other animated media.
 * Otherwise draws once on demand (renderOnce: pause, seek, new results).
 */
export class OverlayRenderer {
    private readonly ctx: CanvasRenderingContext2D;
    private readonly layers: OverlayLayer[] = [];
    private readonly beforeRender: ((view: OverlayView) => void)[] = [];
    private videoLoop: { video: HTMLVideoElement; handle: number } | null = null;
    private readonly resizeObserver: ResizeObserver;
    private rafHandle: number | null = null;

    constructor(
        private readonly canvas: HTMLCanvasElement,
        private readonly source: OverlaySource
    ) {
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("OverlayRenderer: could not acquire a 2D context");
        this.ctx = ctx;
        this.resizeObserver = new ResizeObserver(() => this.renderOnce());
        this.resizeObserver.observe(canvas);
    }

    addLayer(layer: OverlayLayer): void {
        this.layers.push(layer);
        this.renderOnce();
    }

    /** Called with each view right before the layers draw, e.g. to pick the detections for that media time. */
    onBeforeRender(hook: (view: OverlayView) => void): void {
        this.beforeRender.push(hook);
    }

    /**
     * Redraws whenever the video presents a new frame (requestVideoFrameCallback),
     * with that frame's exact media time: overlays stay in step with the picture
     * and nothing is redrawn between video frames.
     */
    startVideoLoop(video: HTMLVideoElement): void {
        this.stopLoop();
        const step = (_now: number, metadata: VideoFrameCallbackMetadata) => {
            if (!this.videoLoop) return;
            this.videoLoop.handle = video.requestVideoFrameCallback(step);
            this.renderOnce(metadata.mediaTime);
        };
        this.videoLoop = { video, handle: video.requestVideoFrameCallback(step) };
    }

    startLoop(): void {
        if (this.rafHandle !== null) return;
        const step = () => {
            this.renderOnce();
            this.rafHandle = requestAnimationFrame(step);
        };
        this.rafHandle = requestAnimationFrame(step);
    }

    stopLoop(): void {
        if (this.videoLoop) {
            this.videoLoop.video.cancelVideoFrameCallback(this.videoLoop.handle);
            this.videoLoop = null;
        }
        if (this.rafHandle === null) return;
        cancelAnimationFrame(this.rafHandle);
        this.rafHandle = null;
    }

    isLooping(): boolean {
        return this.rafHandle !== null || this.videoLoop !== null;
    }

    renderOnce(timeSeconds = this.source.timeSeconds()): void {
        this.syncCanvasSize();
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        const media = this.source.mediaSize();
        if (!media) return;

        const view: OverlayView = {
            mediaRect: containRect(media, { width: this.canvas.width, height: this.canvas.height }),
            timeSeconds,
            pixelRatio: window.devicePixelRatio || 1
        };
        for (const hook of this.beforeRender) hook(view);
        for (const layer of this.layers) {
            this.ctx.save();
            layer.render(this.ctx, view);
            this.ctx.restore();
        }
    }

    dispose(): void {
        this.stopLoop();
        this.resizeObserver.disconnect();
    }

    private syncCanvasSize(): void {
        const dpr = window.devicePixelRatio || 1;
        const width = Math.round(this.canvas.clientWidth * dpr);
        const height = Math.round(this.canvas.clientHeight * dpr);
        if (this.canvas.width !== width) this.canvas.width = width;
        if (this.canvas.height !== height) this.canvas.height = height;
    }
}
