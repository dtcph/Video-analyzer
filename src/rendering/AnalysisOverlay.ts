import type { FrameAnalysis } from "../analysis/AnalysisTypes";
import { ExposureMaskBit } from "../analysis/AnalysisTypes";

export interface AnalysisVisibility {
    clip: boolean;
    highlight: boolean;
    crushedBlacks: boolean;
    blobs: boolean;
}

const CLIP_COLOR = [255, 60, 60, 170] as const;
const HIGHLIGHT_COLOR = [255, 220, 0, 130] as const;
const CRUSHED_COLOR = [70, 100, 255, 140] as const;
const BLOB_COLOR = "rgba(255, 165, 0, 0.9)";

/**
 * Draws per-pixel exposure-analysis feedback (RGB clipping, luminance
 * highlights, crushed blacks) plus the current frame's raw blob
 * detections (bounding box, center point, temporary per-frame ID) onto
 * the analysis canvas layer. The exposure mask is built from the
 * worker's per-pixel category mask at analysis resolution and scaled
 * up to the video's native size; blob boxes are drawn directly at
 * native size from FrameAnalysis.blobs' normalized coordinates. The
 * original video frame is never touched — this is a separate canvas
 * layered on top of it. Blob IDs here are per-frame detection
 * identifiers only, not persistent tracking IDs (see TrackingOverlay
 * for those).
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

    render(result: FrameAnalysis | null, visibility: AnalysisVisibility): void {
        this.clear();
        if (!result) return;

        if (visibility.clip || visibility.highlight || visibility.crushedBlacks) {
            this.renderExposureMask(result, visibility);
        }

        if (visibility.blobs) {
            this.renderBlobs(result);
        }
    }

    private renderExposureMask(result: FrameAnalysis, visibility: AnalysisVisibility): void {
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

    private renderBlobs(result: FrameAnalysis): void {
        const { canvas } = this.ctx;

        for (const blob of result.blobs) {
            const x = blob.x * canvas.width;
            const y = blob.y * canvas.height;
            const w = blob.width * canvas.width;
            const h = blob.height * canvas.height;
            const cx = blob.centerX * canvas.width;
            const cy = blob.centerY * canvas.height;

            this.ctx.save();
            this.ctx.strokeStyle = BLOB_COLOR;
            this.ctx.lineWidth = 3;
            this.ctx.strokeRect(x, y, w, h);

            this.ctx.fillStyle = BLOB_COLOR;
            this.ctx.beginPath();
            this.ctx.arc(cx, cy, 4.5, 0, Math.PI * 2);
            this.ctx.fill();

            this.ctx.font = "bold 16px monospace";
            this.ctx.fillText(`BLOB ${String(blob.id).padStart(2, "0")}`, x, y + h + 18);
            this.ctx.restore();
        }
    }
}
