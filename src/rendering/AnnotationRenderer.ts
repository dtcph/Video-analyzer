import type { Track } from "../tracking/TrackTypes";
import type { TextAnnotation } from "../annotations/AnnotationTypes";
import { resolveAnnotationPosition } from "../annotations/TextAnnotation";

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

        for (const annotation of annotations) {
            const track = tracksById.get(annotation.trackId);
            const position = resolveAnnotationPosition(annotation, track, frame);
            if (!position) continue;

            const x = position.x * canvas.width;
            const y = position.y * canvas.height;

            this.ctx.save();
            this.ctx.font = "13px sans-serif";
            this.ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
            this.ctx.fillText(annotation.text, x, y);
            this.ctx.restore();
        }
    }
}
