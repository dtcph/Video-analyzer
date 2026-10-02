/**
 * Pure summary statistics for scripts/evaluateClips.ts — no I/O, no
 * OpenCV, so they're unit-tested directly (tests/evalMetrics.test.ts).
 */

/** One analyzed sample, as recorded by the harness. */
export interface FrameRecord {
    /** Sample index (0-based, at the harness's sample rate). */
    index: number;
    /** Seconds into the clip. */
    time: number;
    blobs: number;
    /** Normal-path motion-mask coverage, 0..1 (see DetectorFrameStats.motionFraction). Null on the first frame, which has nothing to diff against. */
    motionFraction: number | null;
    compensationApplied: boolean;
    cameraConfidence: number;
    /** AnalysisEngine.analyzeFrame wall time (detection + exposure), ms. */
    analyzeMs: number;
    /** BlobTracker.update wall time, ms. */
    trackMs: number;
    activeTracks: number;
    /** Accepted blob boxes, normalized [x, y, width, height], rounded — kept for overlay review and later per-region analysis. */
    boxes: [number, number, number, number][];
}

export interface Distribution {
    mean: number;
    p50: number;
    p95: number;
    max: number;
}

export interface ClipSummary {
    frames: number;
    blobs: Distribution;
    /** Fraction of frames whose blob count is strictly greater than each cutoff, keyed by cutoff. */
    blobsAbove: Record<number, number>;
    /** Seconds into the clip of the first frame above `implausibleBlobCutoff`, or null if none. */
    firstImplausibleTime: number | null;
    motionFraction: Distribution;
    /** Fraction of frames whose motion coverage is strictly greater than each cutoff (0..1), keyed by cutoff. */
    motionAbove: Record<number, number>;
    compensationAppliedFraction: number;
    meanCameraConfidence: number;
    analyzeMs: Distribution;
    trackMs: Distribution;
    maxActiveTracks: number;
}

export const BLOB_CUTOFFS = [5, 10, 20, 50] as const;
export const MOTION_CUTOFFS = [0.05, 0.1, 0.25] as const;

/** Linear-interpolated percentile (p in 0..1) of an already-sorted array. Empty -> 0. */
export function percentileSorted(sorted: readonly number[], p: number): number {
    if (sorted.length === 0) return 0;
    if (sorted.length === 1) return sorted[0];
    const rank = Math.min(Math.max(p, 0), 1) * (sorted.length - 1);
    const lo = Math.floor(rank);
    const hi = Math.ceil(rank);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

export function distribution(values: readonly number[]): Distribution {
    if (values.length === 0) return { mean: 0, p50: 0, p95: 0, max: 0 };
    const sorted = [...values].sort((a, b) => a - b);
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    return {
        mean,
        p50: percentileSorted(sorted, 0.5),
        p95: percentileSorted(sorted, 0.95),
        max: sorted[sorted.length - 1]
    };
}

/** Fraction of `values` strictly greater than `cutoff`. Empty -> 0. */
export function fractionAbove(values: readonly number[], cutoff: number): number {
    if (values.length === 0) return 0;
    return values.filter((v) => v > cutoff).length / values.length;
}

/**
 * Summarizes one clip run. Frames with no motion measurement (the first
 * frame, which has no previous frame to diff against) are excluded from
 * every statistic, timing included — the first analyzeFrame call also pays
 * the one-time OpenCV.js WASM load, which says nothing about per-frame cost.
 */
export function summarize(records: readonly FrameRecord[], implausibleBlobCutoff: number): ClipSummary {
    const measured = records.filter((r) => r.motionFraction !== null);
    const blobCounts = measured.map((r) => r.blobs);
    const motion = measured.map((r) => r.motionFraction as number);

    const blobsAbove: Record<number, number> = {};
    for (const cutoff of new Set([...BLOB_CUTOFFS, implausibleBlobCutoff])) blobsAbove[cutoff] = fractionAbove(blobCounts, cutoff);
    const motionAbove: Record<number, number> = {};
    for (const cutoff of MOTION_CUTOFFS) motionAbove[cutoff] = fractionAbove(motion, cutoff);

    const firstImplausible = measured.find((r) => r.blobs > implausibleBlobCutoff);

    return {
        frames: measured.length,
        blobs: distribution(blobCounts),
        blobsAbove,
        firstImplausibleTime: firstImplausible ? firstImplausible.time : null,
        motionFraction: distribution(motion),
        motionAbove,
        compensationAppliedFraction: measured.length === 0 ? 0 : measured.filter((r) => r.compensationApplied).length / measured.length,
        meanCameraConfidence: measured.length === 0 ? 0 : measured.reduce((s, r) => s + r.cameraConfidence, 0) / measured.length,
        analyzeMs: distribution(measured.map((r) => r.analyzeMs)),
        trackMs: distribution(measured.map((r) => r.trackMs)),
        maxActiveTracks: records.reduce((m, r) => Math.max(m, r.activeTracks), 0)
    };
}

/**
 * Infers the analysis mode a clip is meant for from its file name —
 * `steady*`, `moving[-_]car*`, `moving[-_]drone*`, `moving[-_]handheld*`.
 * Both separators are accepted: the brief specifies `moving-car`, the
 * actual files in test-vid/ use `moving_car`.
 */
export type ClipMode = "steady" | "moving-car" | "moving-drone" | "moving-handheld" | "unknown";

export function clipModeFromName(fileName: string): ClipMode {
    const base = fileName.toLowerCase().replace(/^.*[\\/]/, "");
    if (base.startsWith("steady")) return "steady";
    const match = /^moving[-_](car|drone|handheld)/.exec(base);
    return match ? (`moving-${match[1]}` as ClipMode) : "unknown";
}

/** Normalized [x, y, width, height]. */
export type Box = [number, number, number, number];

/** One hand-labeled keyframe — see scripts/eval/labels/*.json for the format description. */
export interface LabelFrame {
    /** Harness sample index (FrameRecord.index). */
    index: number;
    /** Only blobs whose center is inside this box are scored; omitted = whole frame. */
    roi?: Box;
    movers: Box[];
    ignore: Box[];
}

export interface LabelFile {
    clip: string;
    sampleFps: number;
    frames: LabelFrame[];
}

export interface LabelScore {
    /** Labeled frames that were actually present in the run. */
    frames: number;
    /** Blobs whose center fell on a mover. Fragments count individually — several blobs on one object are expected (they get merged into outlines later). */
    truePositives: number;
    /** Blobs inside the roi that are neither on a mover nor in an ignore region. */
    falsePositives: number;
    moversHit: number;
    movers: number;
    /** truePositives / (truePositives + falsePositives); null when no blob was scored. */
    precision: number | null;
    /** moversHit / movers; null when the labeled frames contain no movers. */
    recall: number | null;
}

/** Absolute (normalized) plus relative slack around a labeled box — hand labels are approximate, and a fragment on an object's edge should still count. */
const LABEL_MARGIN_ABS = 0.01;
const LABEL_MARGIN_REL = 0.15;

export function containsWithMargin(box: Box, x: number, y: number, absMargin = LABEL_MARGIN_ABS, relMargin = LABEL_MARGIN_REL): boolean {
    const [bx, by, bw, bh] = box;
    const mx = absMargin + relMargin * bw;
    const my = absMargin + relMargin * bh;
    return x >= bx - mx && x <= bx + bw + mx && y >= by - my && y <= by + bh + my;
}

/** Scores accepted blob boxes against hand-labeled keyframes. Frames missing from `records` (e.g. a --max-frames run) are skipped. */
export function scoreLabels(labels: readonly LabelFrame[], records: readonly FrameRecord[]): LabelScore {
    const byIndex = new Map(records.map((r) => [r.index, r]));
    let frames = 0;
    let truePositives = 0;
    let falsePositives = 0;
    let moversHit = 0;
    let movers = 0;

    for (const label of labels) {
        const record = byIndex.get(label.index);
        if (!record) continue;
        frames++;
        movers += label.movers.length;
        const hit = new Set<number>();

        for (const [x, y, w, h] of record.boxes) {
            const cx = x + w / 2;
            const cy = y + h / 2;
            if (label.roi && !containsWithMargin(label.roi, cx, cy, 0, 0)) continue;
            const moverIndex = label.movers.findIndex((box) => containsWithMargin(box, cx, cy));
            if (moverIndex >= 0) {
                truePositives++;
                label.movers.forEach((box, i) => {
                    if (containsWithMargin(box, cx, cy)) hit.add(i);
                });
            } else if (!label.ignore.some((box) => containsWithMargin(box, cx, cy))) {
                falsePositives++;
            }
        }
        moversHit += hit.size;
    }

    const scored = truePositives + falsePositives;
    return {
        frames,
        truePositives,
        falsePositives,
        moversHit,
        movers,
        precision: scored === 0 ? null : truePositives / scored,
        recall: movers === 0 ? null : moversHit / movers
    };
}
