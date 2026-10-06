import type { Size } from "../utils/geometry";

/**
 * How a source frame maps into the model input: scaled so its longer side
 * is `inputSize` (aspect preserved), centered, padded with LETTERBOX_FILL.
 * Same scheme as Ultralytics' LetterBox, so detections match the reference.
 *
 * - "square": input is inputSize x inputSize (static-shape models).
 * - "rect": the short side is padded only up to the next multiple of the
 *   model stride (32), e.g. 640x384 for 16:9. Needs a dynamic-shape model;
 *   same detail as square, fewer pixels. Ultralytics' predict does the same.
 */
export type LetterboxMode = "square" | "rect";

/** YOLOv8's largest feature-map stride; input sides must be multiples of it. */
export const MODEL_STRIDE = 32;

export interface LetterboxTransform {
    /** Model input size, pixels. Equal for "square". */
    inputWidth: number;
    inputHeight: number;
    sourceWidth: number;
    sourceHeight: number;
    scale: number;
    /** Top-left of the drawn image inside the input square, input pixels. */
    offsetX: number;
    offsetY: number;
    drawWidth: number;
    drawHeight: number;
}

/** Ultralytics pads with gray 114. */
export const LETTERBOX_FILL = "rgb(114, 114, 114)";

export function letterboxTransform(
    source: Size,
    inputSize: number,
    mode: LetterboxMode = "square"
): LetterboxTransform {
    const scale = Math.min(inputSize / source.width, inputSize / source.height);
    const drawWidth = Math.round(source.width * scale);
    const drawHeight = Math.round(source.height * scale);
    const inputWidth = mode === "rect" ? Math.ceil(drawWidth / MODEL_STRIDE) * MODEL_STRIDE : inputSize;
    const inputHeight = mode === "rect" ? Math.ceil(drawHeight / MODEL_STRIDE) * MODEL_STRIDE : inputSize;
    return {
        inputWidth,
        inputHeight,
        sourceWidth: source.width,
        sourceHeight: source.height,
        scale,
        offsetX: Math.floor((inputWidth - drawWidth) / 2),
        offsetY: Math.floor((inputHeight - drawHeight) / 2),
        drawWidth,
        drawHeight
    };
}

/**
 * Interleaved RGBA bytes (ImageData) → planar float32 RGB in 0..1, the
 * [1, 3, H, W] layout YOLOv8 expects. Writes into `out` when given so the
 * caller can reuse one buffer across frames.
 */
export function rgbaToPlanarRgb(rgba: Uint8ClampedArray | Uint8Array, out?: Float32Array): Float32Array {
    const pixels = rgba.length >> 2;
    const tensor = out ?? new Float32Array(pixels * 3);
    if (tensor.length !== pixels * 3)
        throw new Error(`rgbaToPlanarRgb: expected ${pixels * 3} floats, got ${tensor.length}`);
    const inv = 1 / 255;
    const green = pixels;
    const blue = pixels * 2;
    for (let i = 0, p = 0; i < pixels; i++, p += 4) {
        tensor[i] = rgba[p] * inv;
        tensor[green + i] = rgba[p + 1] * inv;
        tensor[blue + i] = rgba[p + 2] * inv;
    }
    return tensor;
}
