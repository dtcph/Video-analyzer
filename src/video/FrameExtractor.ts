import type { VideoFrameRef } from "./VideoTypes";

/**
 * Extracts raw pixel data from the current video frame via an
 * off-DOM canvas. Analysis modules consume ImageData; they never
 * touch the <video> element directly.
 */
export class FrameExtractor {
    private canvas: OffscreenCanvas | HTMLCanvasElement;
    private context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

    constructor(width: number, height: number) {
        if (typeof OffscreenCanvas !== "undefined") {
            this.canvas = new OffscreenCanvas(width, height);
        } else {
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            this.canvas = canvas;
        }

        const context = this.canvas.getContext("2d");
        if (!context) throw new Error("FrameExtractor: could not acquire 2D context");
        this.context = context as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
    }

    resize(width: number, height: number): void {
        this.canvas.width = width;
        this.canvas.height = height;
    }

    extract(video: HTMLVideoElement, frame: VideoFrameRef): { ref: VideoFrameRef; imageData: ImageData } {
        this.context.drawImage(video, 0, 0, this.canvas.width, this.canvas.height);
        const imageData = this.context.getImageData(0, 0, this.canvas.width, this.canvas.height);
        return { ref: frame, imageData };
    }
}
