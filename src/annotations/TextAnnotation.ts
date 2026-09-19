import type { Track, TrackPoint } from "../tracking/TrackTypes";
import { pointAtOrBeforeFrame } from "../tracking/Track";
import type { TextAnnotation } from "./AnnotationTypes";

/**
 * Resolves an annotation's current screen position from its track.
 * Returns null when the given frame falls outside the track's known
 * range (before it started, or after its last recorded point) —
 * that's what makes the label disappear once a track is lost, without
 * relying on the track's current `status`. Status alone can't gate
 * this: it reflects whether the track is *currently* being matched,
 * not whether historical data exists at `frame`, so a track lost later
 * in the video must still resolve correctly when scrubbing back into
 * frames it was actively tracked at.
 */
export function resolveAnnotationPosition(
    annotation: TextAnnotation,
    track: Track | undefined,
    frame: number
): { x: number; y: number } | null {
    if (!annotation.visible || !track) return null;

    const point: TrackPoint | undefined = pointAtOrBeforeFrame(track, frame);
    if (!point) return null;

    return {
        x: point.x + annotation.offsetX,
        y: point.y + annotation.offsetY
    };
}
