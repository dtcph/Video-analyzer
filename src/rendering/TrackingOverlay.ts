import type { Track } from "../tracking/TrackTypes";
import { pointAtFrame } from "../tracking/Track";

const ACTIVE_COLOR = "rgba(0, 255, 180, 0.9)";
const LOST_COLOR = "rgba(255, 80, 80, 0.6)";
const PATH_COLOR = "rgba(0, 255, 180, 0.35)";

/**
 * Draws bounding boxes, IDs, and motion paths for tracks onto the
 * tracking canvas layer. Reads Track data only — never mutates it.
 */
export class TrackingOverlay {
    constructor(private readonly ctx: CanvasRenderingContext2D) {}

    clear(): void {
        const { canvas } = this.ctx;
        this.ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    render(tracks: Track[], frame: number): void {
        this.clear();
        const { canvas } = this.ctx;

        for (const track of tracks) {
            const point = pointAtFrame(track, frame);
            if (!point) continue;

            const color = track.status === "active" ? ACTIVE_COLOR : LOST_COLOR;
            const x = point.x * canvas.width;
            const y = point.y * canvas.height;
            const w = point.width * canvas.width;
            const h = point.height * canvas.height;

            this.ctx.save();
            this.ctx.strokeStyle = color;
            this.ctx.lineWidth = 1.5;
            this.ctx.strokeRect(x - w / 2, y - h / 2, w, h);

            this.ctx.fillStyle = color;
            this.ctx.font = "11px monospace";
            this.ctx.fillText(
                `#${track.id} ${(point.confidence * 100).toFixed(0)}%`,
                x - w / 2,
                y - h / 2 - 4
            );
            this.ctx.restore();

            this.renderPath(track, frame, canvas.width, canvas.height);
        }
    }

    private renderPath(track: Track, frame: number, width: number, height: number): void {
        const pathPoints = track.blobs.filter((p) => p.frame <= frame);
        if (pathPoints.length < 2) return;

        this.ctx.save();
        this.ctx.strokeStyle = PATH_COLOR;
        this.ctx.lineWidth = 1;
        this.ctx.beginPath();
        pathPoints.forEach((point, index) => {
            const x = point.x * width;
            const y = point.y * height;
            if (index === 0) this.ctx.moveTo(x, y);
            else this.ctx.lineTo(x, y);
        });
        this.ctx.stroke();
        this.ctx.restore();
    }
}
