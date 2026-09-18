import type { BlobData, TrackPoint } from "../tracking/TrackTypes";

/**
 * Scores how confidently a detected blob continues an existing track,
 * based on positional and size similarity to the track's last point.
 */
export function scoreMatch(previous: TrackPoint, candidate: BlobData): number {
    const dx = previous.x - candidate.x;
    const dy = previous.y - candidate.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    const sizeDelta =
        Math.abs(previous.width - candidate.width) + Math.abs(previous.height - candidate.height);

    const positionScore = Math.max(0, 1 - distance * 4);
    const sizeScore = Math.max(0, 1 - sizeDelta * 4);

    return positionScore * 0.7 + sizeScore * 0.3;
}
