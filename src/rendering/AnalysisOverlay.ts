import type { FrameAnalysis } from "../analysis/AnalysisTypes";
import { ExposureMaskBit } from "../analysis/AnalysisTypes";

export interface ExposureVisibility {
    clip: boolean;
    highlight: boolean;
    crushedBlacks: boolean;
}

const CLIP_COLOR = [255, 60, 60, 170] as const;
const HIGHLIGHT_COLOR = [255, 220, 0, 130] as const;
const CRUSHED_COLOR = [70, 100, 255, 140] as const;

/**
 * Draws per-pixel exposure-analysis feedback (RGB clipping, luminance
 * highlights, crushed blacks) onto the analysis canvas layer, built
 * from the worker's per-pixel category mask at analysis resolution
 * and scaled up to the video's native size. The original video frame
 * is never touched — this is a separate canvas layered on top of it.
 */
export class AnalysisOverlay {
    private readonly maskCanvas = document.createElement("canvas");
    private readonly maskCtx: CanvasRenderingContext2D;

    constructor(private readonly ctx: CanvasRenderingContext2D) {
        const maskCtx = this.maskCanvas.getContext("2d");
        if (!maskCtx) throw new Error("AnalysisOverlay: could not acquire 2D context for mask canvas");
        this.maskCtx = maskCtx;
    }

    clear(): void {
        const { canvas } = this.ctx;
        this.ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    render(result: FrameAnalysis | null, visibility: ExposureVisibility): void {
        this.clear();
        if (!result) return;
        if (!visibility.clip && !visibility.highlight && !visibility.crushedBlacks) return;

        const { canvas } = this.ctx;
        const { width, height, exposureMask } = result;

        this.maskCanvas.width = width;
        this.maskCanvas.height = height;
        const maskImage = this.maskCtx.createImageData(width, height);

        for (let p = 0; p < exposureMask.length; p++) {
            const bits = exposureMask[p];
            let color: readonly [number, number, number, number] | null = null;

            if (visibility.clip && bits & ExposureMaskBit.Clip) color = CLIP_COLOR;
            else if (visibility.highlight && bits & ExposureMaskBit.Highlight) color = HIGHLIGHT_COLOR;
            else if (visibility.crushedBlacks && bits & ExposureMaskBit.CrushedBlack) color = CRUSHED_COLOR;

            if (!color) continue;
            const o = p * 4;
            maskImage.data[o] = color[0];
            maskImage.data[o + 1] = color[1];
            maskImage.data[o + 2] = color[2];
            maskImage.data[o + 3] = color[3];
        }

        this.maskCtx.putImageData(maskImage, 0, 0);
        this.ctx.imageSmoothingEnabled = false;
        this.ctx.drawImage(this.maskCanvas, 0, 0, width, height, 0, 0, canvas.width, canvas.height);
    }
}
