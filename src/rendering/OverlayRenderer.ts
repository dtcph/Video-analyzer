import type { Box, Size } from "../utils/geometry";
import { containRect } from "../utils/geometry";

/** What every layer needs to draw one overlay frame. */
export interface OverlayView {
    /** Where the media is drawn on the canvas, in canvas pixels (letterboxed, object-fit: contain). */
    mediaRect: Box;
    /** Media time being displayed, seconds (0 for a still image). */
    timeSeconds: number;
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
 * Runs a requestAnimationFrame loop while media plays (startLoop) and draws
 * once on demand otherwise (renderOnce: pause, seek, new results).
 */
export class OverlayRenderer {
    private readonly ctx: CanvasRenderingContext2D;
    private readonly layers: OverlayLayer[] = [];
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

    startLoop(): void {
        if (this.rafHandle !== null) return;
        const step = () => {
            this.renderOnce();
            this.rafHandle = requestAnimationFrame(step);
        };
        this.rafHandle = requestAnimationFrame(step);
    }

    stopLoop(): void {
        if (this.rafHandle === null) return;
        cancelAnimationFrame(this.rafHandle);
        this.rafHandle = null;
    }

    isLooping(): boolean {
        return this.rafHandle !== null;
    }

    renderOnce(): void {
        this.syncCanvasSize();
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        const media = this.source.mediaSize();
        if (!media) return;

        const view: OverlayView = {
            mediaRect: containRect(media, { width: this.canvas.width, height: this.canvas.height }),
            timeSeconds: this.source.timeSeconds()
        };
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
