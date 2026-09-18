import type { FrameAnalysis } from "../analysis/AnalysisTypes";

/**
 * Draws exposure-analysis feedback (clipping / crushed-blacks
 * highlights) onto the analysis canvas layer.
 */
export class AnalysisOverlay {
    constructor(private readonly ctx: CanvasRenderingContext2D) {}

    clear(): void {
        const { canvas } = this.ctx;
        this.ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    render(result: FrameAnalysis | null): void {
        this.clear();
        if (!result) return;

        const { canvas } = this.ctx;
        const { exposure } = result;

        this.ctx.save();
        this.ctx.font = "12px monospace";
        this.ctx.fillStyle = "rgba(0, 255, 180, 0.9)";
        this.ctx.fillText(
            `clip ${(exposure.rgbClippedRatio * 100).toFixed(1)}%  crushed ${(exposure.crushedBlacksRatio * 100).toFixed(1)}%`,
            8,
            canvas.height - 8
        );
        this.ctx.restore();
    }
}
