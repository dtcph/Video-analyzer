import type { Track } from "../tracking/TrackTypes";
import type { TextAnnotation } from "../annotations/AnnotationTypes";
import { resolveAnnotationPosition } from "../annotations/TextAnnotation";

/** Label font size as a fraction of canvas width, clamped to a legible range regardless of source resolution. */
const FONT_SIZE_RATIO = 0.024;
const MIN_FONT_SIZE = 24;
const MAX_FONT_SIZE = 64;

/**
 * Draws dynamic text labels attached to tracks onto the annotation
 * canvas layer. Position is derived live from the track each frame —
 * annotations are never independently keyframed.
 */
export class AnnotationRenderer {
    constructor(private readonly ctx: CanvasRenderingContext2D) {}

    clear(): void {
        const { canvas } = this.ctx;
        this.ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    render(annotations: TextAnnotation[], tracksById: Map<number, Track>, frame: number): void {
        this.clear();
        const { canvas } = this.ctx;

        const fontSize = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, canvas.width * FONT_SIZE_RATIO));

        for (const annotation of annotations) {
            if (!annotation.text) continue;

            const track = tracksById.get(annotation.trackId);
            const position = resolveAnnotationPosition(annotation, track, frame);
            if (!position) continue;

            const x = position.x * canvas.width;
            const y = position.y * canvas.height;

            this.ctx.save();
            this.ctx.font = `bold ${fontSize}px sans-serif`;
            this.ctx.textAlign = "center";
            this.ctx.textBaseline = "middle";

            // A dark halo keeps the label legible against light or busy
            // video content, matching the tracking-layer label treatment.
            this.ctx.strokeStyle = "rgba(0, 0, 0, 0.85)";
            this.ctx.lineWidth = fontSize * 0.22;
            this.ctx.lineJoin = "round";
            this.ctx.strokeText(annotation.text, x, y);

            this.ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
            this.ctx.fillText(annotation.text, x, y);
            this.ctx.restore();
        }
    }
}
