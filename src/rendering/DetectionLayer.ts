import { COCO_CLASSES } from "../inference/cocoClasses";
import type { Detection } from "../inference/postprocess";
import { LABEL_TEXT_COLOR, classColor } from "./classColors";
import type { OverlayLayer, OverlayView } from "./OverlayRenderer";

/** A box to draw: a detection, optionally with the ID of the track it belongs to. */
export interface DrawnBox extends Detection {
    trackId?: number;
}

/**
 * Draws detection boxes with "class NN%" labels in the class color. Raw
 * detections (Debug: everything the model returned, before the user's
 * threshold and class filter) are drawn as thin dashed boxes underneath.
 * With `showTrackIds`, labels start with the box's track ID ("#12 car 87%").
 * Draws only; never computes detections or tracks.
 */
export class DetectionLayer implements OverlayLayer {
    private detections: readonly DrawnBox[] = [];
    private raw: readonly Detection[] | null = null;
    private showTrackIds = false;

    set(detections: readonly DrawnBox[], raw: readonly Detection[] | null = null, showTrackIds = false): void {
        this.detections = detections;
        this.raw = raw;
        this.showTrackIds = showTrackIds;
    }

    clear(): void {
        this.set([]);
    }

    render(ctx: CanvasRenderingContext2D, view: OverlayView): void {
        const { mediaRect: rect, pixelRatio: dpr } = view;
        const toCanvas = (d: Detection) => ({
            x: rect.x + d.box.x * rect.width,
            y: rect.y + d.box.y * rect.height,
            w: d.box.width * rect.width,
            h: d.box.height * rect.height
        });

        if (this.raw) {
            ctx.lineWidth = dpr;
            ctx.setLineDash([4 * dpr, 3 * dpr]);
            for (const d of this.raw) {
                const b = toCanvas(d);
                ctx.strokeStyle = classColor(d.classId);
                ctx.strokeRect(b.x, b.y, b.w, b.h);
            }
            ctx.setLineDash([]);
        }

        const fontSize = Math.round(12 * dpr);
        const pad = Math.round(3 * dpr);
        const labelHeight = fontSize + pad * 2;
        ctx.font = `600 ${fontSize}px system-ui, sans-serif`;
        ctx.textBaseline = "top";
        ctx.lineWidth = 2 * dpr;
        for (const d of this.detections) {
            const b = toCanvas(d);
            const color = classColor(d.classId);
            ctx.strokeStyle = color;
            ctx.strokeRect(b.x, b.y, b.w, b.h);

            const id = this.showTrackIds && d.trackId !== undefined ? `#${d.trackId} ` : "";
            const label = `${id}${COCO_CLASSES[d.classId] ?? d.classId} ${Math.round(d.score * 100)}%`;
            const labelWidth = ctx.measureText(label).width + pad * 2;
            // Above the box when there is room, else inside its top edge; never off-canvas horizontally.
            const lx = Math.min(Math.max(b.x - ctx.lineWidth / 2, 0), ctx.canvas.width - labelWidth);
            const ly = b.y - labelHeight >= 0 ? b.y - labelHeight : b.y;
            ctx.fillStyle = color;
            ctx.fillRect(lx, ly, labelWidth, labelHeight);
            ctx.fillStyle = LABEL_TEXT_COLOR;
            ctx.fillText(label, lx + pad, ly + pad);
        }
    }
}
