import type { Track, TrackPoint } from "../tracking/TrackTypes";
import { pointAtFrame } from "../tracking/Track";
import type { TextAnnotation } from "./AnnotationTypes";

/**
 * Resolves an annotation's current screen position from its track.
 * Returns null when the track has no data for the given frame or has
 * been marked lost — annotations disappear rather than freeze.
 */
export function resolveAnnotationPosition(
    annotation: TextAnnotation,
    track: Track | undefined,
    frame: number
): { x: number; y: number } | null {
    if (!annotation.visible || !track || track.status === "lost") return null;

    const point: TrackPoint | undefined = pointAtFrame(track, frame);
    if (!point) return null;

    return {
        x: point.x + annotation.offsetX,
        y: point.y + annotation.offsetY
    };
}
