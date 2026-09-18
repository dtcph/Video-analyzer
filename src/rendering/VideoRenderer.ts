import type { VideoPlayer } from "../video/VideoPlayer";
import type { TrackManager } from "../tracking/TrackManager";
import type { AnnotationManager } from "../annotations/AnnotationManager";
import { AnalysisOverlay } from "./AnalysisOverlay";
import { TrackingOverlay } from "./TrackingOverlay";
import { AnnotationRenderer } from "./AnnotationRenderer";
import type { FrameAnalysis } from "../analysis/AnalysisTypes";

export interface LayerVisibility {
    analysis: boolean;
    tracking: boolean;
    annotations: boolean;
}

/**
 * Coordinates the three overlay canvases against the video's playback
 * position. Drives a requestAnimationFrame loop while the video plays,
 * and renders once on seek/pause. Does not perform analysis itself —
 * it reads state from AnalysisEngine's latest result, TrackManager,
 * and AnnotationManager.
 */
export class VideoRenderer {
    private analysisOverlay: AnalysisOverlay;
    private trackingOverlay: TrackingOverlay;
    private annotationRenderer: AnnotationRenderer;

    private visibility: LayerVisibility = { analysis: true, tracking: true, annotations: true };
    private rafHandle: number | null = null;
    private latestFrameResult: FrameAnalysis | null = null;

    constructor(
        private readonly player: VideoPlayer,
        private readonly analysisCanvas: HTMLCanvasElement,
        private readonly trackingCanvas: HTMLCanvasElement,
        private readonly annotationCanvas: HTMLCanvasElement,
        private readonly trackManager: TrackManager,
        private readonly annotationManager: AnnotationManager,
        private readonly frameRate: number
    ) {
        const analysisCtx = this.analysisCanvas.getContext("2d");
        const trackingCtx = this.trackingCanvas.getContext("2d");
        const annotationCtx = this.annotationCanvas.getContext("2d");

        if (!analysisCtx || !trackingCtx || !annotationCtx) {
            throw new Error("VideoRenderer: could not acquire 2D context for one or more layers");
        }

        this.analysisOverlay = new AnalysisOverlay(analysisCtx);
        this.trackingOverlay = new TrackingOverlay(trackingCtx);
        this.annotationRenderer = new AnnotationRenderer(annotationCtx);

        this.player.onStateChange((state) => {
            if (state === "playing") this.startLoop();
            else this.stopLoop();
            if (state === "ready" || state === "paused") this.renderOnce();
        });
    }

    setLayerVisibility(visibility: Partial<LayerVisibility>): void {
        this.visibility = { ...this.visibility, ...visibility };
        this.renderOnce();
    }

    getLayerVisibility(): LayerVisibility {
        return this.visibility;
    }

    setLatestFrameResult(result: FrameAnalysis | null): void {
        this.latestFrameResult = result;
    }

    resizeToVideo(width: number, height: number): void {
        for (const canvas of [this.analysisCanvas, this.trackingCanvas, this.annotationCanvas]) {
            canvas.width = width;
            canvas.height = height;
        }
    }

    private startLoop(): void {
        if (this.rafHandle !== null) return;
        const step = () => {
            this.renderOnce();
            this.rafHandle = requestAnimationFrame(step);
        };
        this.rafHandle = requestAnimationFrame(step);
    }

    private stopLoop(): void {
        if (this.rafHandle === null) return;
        cancelAnimationFrame(this.rafHandle);
        this.rafHandle = null;
    }

    private currentFrameIndex(): number {
        return Math.round(this.player.getCurrentSeconds() * this.frameRate);
    }

    renderOnce(): void {
        const frame = this.currentFrameIndex();

        if (this.visibility.analysis) {
            this.analysisOverlay.render(this.latestFrameResult);
        } else {
            this.analysisOverlay.clear();
        }

        if (this.visibility.tracking) {
            this.trackingOverlay.render(this.trackManager.getAllTracks(), frame);
        } else {
            this.trackingOverlay.clear();
        }

        if (this.visibility.annotations) {
            const tracksById = new Map(this.trackManager.getAllTracks().map((t) => [t.id, t]));
            this.annotationRenderer.render(this.annotationManager.getAll(), tracksById, frame);
        } else {
            this.annotationRenderer.clear();
        }
    }
}
