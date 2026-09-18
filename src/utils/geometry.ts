export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export function rectArea(rect: Rect): number {
    return rect.width * rect.height;
}

export function rectCenter(rect: Rect): { x: number; y: number } {
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

export function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Intersection-over-union of two rects given as center-based x/y (as
 * used by BlobData/TrackPoint) plus width/height. Returns 0..1, where
 * 1 means the rects are identical.
 */
export function intersectionOverUnion(a: Rect, b: Rect): number {
    const aLeft = a.x - a.width / 2;
    const aRight = a.x + a.width / 2;
    const aTop = a.y - a.height / 2;
    const aBottom = a.y + a.height / 2;

    const bLeft = b.x - b.width / 2;
    const bRight = b.x + b.width / 2;
    const bTop = b.y - b.height / 2;
    const bBottom = b.y + b.height / 2;

    const overlapWidth = Math.max(0, Math.min(aRight, bRight) - Math.max(aLeft, bLeft));
    const overlapHeight = Math.max(0, Math.min(aBottom, bBottom) - Math.max(aTop, bTop));
    const intersection = overlapWidth * overlapHeight;
    if (intersection <= 0) return 0;

    const union = rectArea(a) + rectArea(b) - intersection;
    return union <= 0 ? 0 : intersection / union;
}

/**
 * Scales sourceWidth/sourceHeight down to fit within maxWidth/maxHeight
 * while preserving aspect ratio (never upscales). Used to size the
 * analysis canvas so a non-16:9 source isn't stretched to match a
 * fixed-aspect budget.
 */
export function fitWithinPreservingAspect(
    sourceWidth: number,
    sourceHeight: number,
    maxWidth: number,
    maxHeight: number
): { width: number; height: number } {
    const scale = Math.min(maxWidth / sourceWidth, maxHeight / sourceHeight, 1);
    return {
        width: Math.max(2, Math.round((sourceWidth * scale) / 2) * 2),
        height: Math.max(2, Math.round((sourceHeight * scale) / 2) * 2)
    };
}
