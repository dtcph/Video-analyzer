/**
 * Axis-aligned box with a TOP-LEFT origin (canvas convention). Units are
 * whatever the caller uses consistently: pixels or normalized 0..1.
 */
export interface Box {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface Size {
    width: number;
    height: number;
}

export function boxArea(box: Box): number {
    return Math.max(0, box.width) * Math.max(0, box.height);
}

/** Intersection-over-union, 0..1 (1 = identical boxes). */
export function intersectionOverUnion(a: Box, b: Box): number {
    const overlapWidth = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
    const overlapHeight = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
    if (overlapWidth <= 0 || overlapHeight <= 0) return 0;

    const intersection = overlapWidth * overlapHeight;
    const union = boxArea(a) + boxArea(b) - intersection;
    return union <= 0 ? 0 : intersection / union;
}

/**
 * Scales a source size down to fit within a max size while preserving
 * aspect ratio (never upscales). Dimensions are rounded to even numbers,
 * which video encoders and some GPU paths prefer.
 */
export function fitWithinPreservingAspect(source: Size, max: Size): Size {
    const scale = Math.min(max.width / source.width, max.height / source.height, 1);
    return {
        width: Math.max(2, Math.round((source.width * scale) / 2) * 2),
        height: Math.max(2, Math.round((source.height * scale) / 2) * 2)
    };
}

/**
 * Where media of `media` size is drawn inside a `container` with CSS
 * `object-fit: contain`: scaled to fit, centered, letterboxed. Overlays use
 * this to map normalized media coordinates onto the stage, so boxes stay
 * aligned for any media aspect ratio.
 */
export function containRect(media: Size, container: Size): Box {
    if (media.width <= 0 || media.height <= 0) return { x: 0, y: 0, width: 0, height: 0 };
    const scale = Math.min(container.width / media.width, container.height / media.height);
    const width = media.width * scale;
    const height = media.height * scale;
    return { x: (container.width - width) / 2, y: (container.height - height) / 2, width, height };
}
