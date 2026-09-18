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
