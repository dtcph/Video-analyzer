import type { Box } from "../utils/geometry";
import type { LetterboxTransform } from "./preprocess";

/** A detection in model-input pixels, corner format. Intermediate only. */
export interface Candidate {
    classId: number;
    score: number;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
}

/** A final detection: box normalized 0..1 of the SOURCE frame, top-left origin. */
export interface Detection {
    classId: number;
    score: number;
    box: Box;
}

/**
 * Decodes a raw YOLOv8 detection head, output0 [1, 4 + C, N] (channel-major):
 * rows 0..3 are cx, cy, w, h in input pixels, rows 4.. are per-class scores
 * (already sigmoid). Keeps each anchor's best class if its score reaches
 * `confThreshold`.
 *
 * `enabledClasses` (1 = enabled, per class id) is applied AFTER the argmax,
 * like Ultralytics' `classes=` filter: an anchor whose best class is disabled
 * is dropped, not relabeled with its runner-up. Otherwise disabling "car"
 * would turn cars into low-scoring "truck" detections and inflate counts.
 */
export function decodeYoloV8(
    output: Float32Array,
    numClasses: number,
    confThreshold: number,
    enabledClasses?: Uint8Array | null
): Candidate[] {
    const anchors = output.length / (4 + numClasses);
    if (!Number.isInteger(anchors))
        throw new Error(`decodeYoloV8: output length ${output.length} is not (4 + ${numClasses}) * N`);

    // Walk class rows in memory order (sequential reads) and keep a running best per anchor.
    const bestScore = new Float32Array(anchors);
    const bestClass = new Int16Array(anchors).fill(-1);
    for (let c = 0; c < numClasses; c++) {
        const row = (4 + c) * anchors;
        for (let i = 0; i < anchors; i++) {
            const score = output[row + i];
            if (score > bestScore[i]) {
                bestScore[i] = score;
                bestClass[i] = c;
            }
        }
    }

    const candidates: Candidate[] = [];
    for (let i = 0; i < anchors; i++) {
        if (bestClass[i] < 0 || bestScore[i] < confThreshold) continue;
        if (enabledClasses && !enabledClasses[bestClass[i]]) continue;
        const cx = output[i];
        const cy = output[anchors + i];
        const halfW = output[2 * anchors + i] / 2;
        const halfH = output[3 * anchors + i] / 2;
        candidates.push({
            classId: bestClass[i],
            score: bestScore[i],
            x1: cx - halfW,
            y1: cy - halfH,
            x2: cx + halfW,
            y2: cy + halfH
        });
    }
    return candidates;
}

/**
 * Decodes a graph with NMS built in, output0 [1, R, 6]: x1, y1, x2, y2, score,
 * class per row (input pixels), zero-padded. Rows are already suppressed.
 */
export function decodeYoloV8Nms(
    output: Float32Array,
    confThreshold: number,
    enabledClasses?: Uint8Array | null
): Candidate[] {
    const candidates: Candidate[] = [];
    for (let r = 0; r + 6 <= output.length; r += 6) {
        const score = output[r + 4];
        const classId = Math.round(output[r + 5]);
        if (score < confThreshold || (enabledClasses && !enabledClasses[classId])) continue;
        candidates.push({ classId, score, x1: output[r], y1: output[r + 1], x2: output[r + 2], y2: output[r + 3] });
    }
    return candidates;
}

function cornerIou(a: Candidate, b: Candidate): number {
    const w = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1);
    const h = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
    if (w <= 0 || h <= 0) return 0;
    const inter = w * h;
    const union = (a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - inter;
    return union <= 0 ? 0 : inter / union;
}

/**
 * Class-aware greedy NMS: highest score first; a candidate is dropped when it
 * overlaps an already kept box OF THE SAME CLASS by more than `iouThreshold`.
 * Same rule as Ultralytics' default (non-agnostic) NMS. Returns at most
 * `maxDetections`, sorted by score.
 */
export function nonMaxSuppression(
    candidates: readonly Candidate[],
    iouThreshold: number,
    maxDetections = 300
): Candidate[] {
    const sorted = [...candidates].sort((a, b) => b.score - a.score);
    const keptByClass = new Map<number, Candidate[]>();
    const kept: Candidate[] = [];
    for (const candidate of sorted) {
        const sameClass = keptByClass.get(candidate.classId);
        if (sameClass?.some((other) => cornerIou(candidate, other) > iouThreshold)) continue;
        if (sameClass) sameClass.push(candidate);
        else keptByClass.set(candidate.classId, [candidate]);
        kept.push(candidate);
        if (kept.length >= maxDetections) break;
    }
    return kept;
}

/** Undoes the letterbox: input pixels → source-normalized boxes, clipped to the frame. */
export function toSourceDetections(candidates: readonly Candidate[], transform: LetterboxTransform): Detection[] {
    const { scale, offsetX, offsetY, sourceWidth, sourceHeight } = transform;
    const detections: Detection[] = [];
    for (const c of candidates) {
        const x1 = clamp01((c.x1 - offsetX) / scale / sourceWidth);
        const y1 = clamp01((c.y1 - offsetY) / scale / sourceHeight);
        const x2 = clamp01((c.x2 - offsetX) / scale / sourceWidth);
        const y2 = clamp01((c.y2 - offsetY) / scale / sourceHeight);
        if (x2 <= x1 || y2 <= y1) continue;
        detections.push({ classId: c.classId, score: c.score, box: { x: x1, y: y1, width: x2 - x1, height: y2 - y1 } });
    }
    return detections;
}

function clamp01(value: number): number {
    return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * Applies the user's confidence threshold and class selection to detections
 * produced at a lower score floor. Equivalent to filtering before NMS: NMS is
 * class-aware (removing a class cannot change another class's boxes) and
 * greedy by score (a box above the threshold is only ever suppressed by a
 * higher-scoring box, which also passes). Tested in postprocess.test.ts.
 */
export function filterDetections(
    detections: readonly Detection[],
    confThreshold: number,
    enabledClasses: Uint8Array
): Detection[] {
    return detections.filter((d) => d.score >= confThreshold && enabledClasses[d.classId] === 1);
}
