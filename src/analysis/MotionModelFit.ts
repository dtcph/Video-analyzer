import type { OpenCv, CvMat } from "./BlobDetector";

/**
 * Shared robust-fit primitives used by BOTH motion-estimation paths:
 * `GlobalMotionEstimator` (legacy block-matching correspondences) and
 * `SceneMotionEstimator` (motion-field path, correspondences from sparse
 * optical flow). Both paths reduce to the same problem — given a set of
 * `Correspondence`s (a from-point and where it ended up), robustly fit a
 * translation (and, diagnostically, richer models), then check whether
 * the fit's residual varies coherently across a spatial grid (the
 * parallax/depth-layer signal). Extracting this once means both paths
 * share the exact same, already-validated RANSAC behavior rather than
 * two subtly different reimplementations drifting apart.
 */

export interface Correspondence {
    /** Previous-frame point. */
    fromX: number;
    fromY: number;
    /** Matched/tracked location in the current frame. */
    toX: number;
    toY: number;
    /** Match quality / track confidence, 0..1 (meaning depends on the source — cross-correlation score for block matching, inverse tracking error for optical flow). */
    score: number;
}

export type AffineMatrix = [number, number, number, number, number, number];

const RANSAC_REPROJ_THRESHOLD_PX = 3;
const RANSAC_MAX_ITERS = 500;
const RANSAC_CONFIDENCE = 0.99;

/**
 * Robust translation via 1-point-hypothesis RANSAC: each correspondence's
 * own displacement is tried as a candidate global translation, scored by
 * how many OTHER correspondences it explains within
 * RANSAC_REPROJ_THRESHOLD_PX; the best-scoring hypothesis's inlier set is
 * then refined by taking the MEDIAN displacement over just those inliers.
 * With up to a few hundred correspondences this is at most tens of
 * thousands of distance comparisons — trivial next to producing the
 * correspondences themselves (block matching or optical flow).
 */
export function fitTranslationRansac(correspondences: Correspondence[]): { dx: number; dy: number; inlierMask: number[] } {
    const displacements = correspondences.map((c) => ({ dx: c.toX - c.fromX, dy: c.toY - c.fromY }));

    let bestInlierMask: boolean[] = new Array(correspondences.length).fill(false);
    let bestCount = -1;

    for (let h = 0; h < displacements.length; h++) {
        const hypothesis = displacements[h];
        const mask = displacements.map((d) => Math.hypot(d.dx - hypothesis.dx, d.dy - hypothesis.dy) <= RANSAC_REPROJ_THRESHOLD_PX);
        const count = mask.filter(Boolean).length;
        if (count > bestCount) {
            bestCount = count;
            bestInlierMask = mask;
        }
    }

    const inlierDisplacements = displacements.filter((_, i) => bestInlierMask[i]);
    const dx = median(inlierDisplacements.map((d) => d.dx));
    const dy = median(inlierDisplacements.map((d) => d.dy));

    // Re-derive the final inlier mask against the REFINED (median)
    // translation, not the single seed hypothesis.
    const inlierMask = displacements.map((d) => (Math.hypot(d.dx - dx, d.dy - dy) <= RANSAC_REPROJ_THRESHOLD_PX ? 1 : 0));

    return { dx, dy, inlierMask };
}

/**
 * Fits a 2x3 affine transform mapping `fromX/Y` -> `toX/Y` via OpenCV's
 * RANSAC-based estimateAffine2D. Returns null on a degenerate input (too
 * few points, collinear points) — OpenCV reports this as an empty
 * (0-row) result rather than throwing.
 */
export function fitAffineRansac(cv: OpenCv, correspondences: Correspondence[]): { matrix: AffineMatrix; inlierMask: number[] } | null {
    const fromArray: number[] = [];
    const toArray: number[] = [];
    for (const c of correspondences) {
        fromArray.push(c.fromX, c.fromY);
        toArray.push(c.toX, c.toY);
    }

    const fromMat = cv.matFromArray(correspondences.length, 1, cv.CV_32FC2, fromArray);
    const toMat = cv.matFromArray(correspondences.length, 1, cv.CV_32FC2, toArray);
    const inliersMat = new cv.Mat();

    try {
        const M = (
            cv.estimateAffine2D as (
                from: CvMat,
                to: CvMat,
                inliers: CvMat,
                method: number,
                ransacReprojThreshold: number,
                maxIters: number,
                confidence: number,
                refineIters: number
            ) => CvMat
        )(fromMat, toMat, inliersMat, cv.RANSAC, RANSAC_REPROJ_THRESHOLD_PX, RANSAC_MAX_ITERS, RANSAC_CONFIDENCE, 10);

        try {
            if (M.rows !== 2 || M.cols !== 3) return null;
            const data = M.data64F;
            const matrix: AffineMatrix = [data[0], data[1], data[2], data[3], data[4], data[5]];
            const inlierMask = Array.from(inliersMat.data as Uint8Array);
            return { matrix, inlierMask };
        } finally {
            M.delete();
        }
    } finally {
        fromMat.delete();
        toMat.delete();
        inliersMat.delete();
    }
}

/**
 * Fits a 3x3 homography mapping `fromX/Y` -> `toX/Y` via OpenCV's
 * RANSAC-based findHomography — a richer, projective model, purely
 * diagnostic (see SceneMotion.model in SceneMotionEstimator): it can fit
 * a genuinely planar scene under perspective change well, but like the
 * affine fit it can also "explain" independent motion as a spurious
 * projective warp given only sparse points, so it is never used to drive
 * pixel compensation directly. Returns null on a degenerate input.
 */
export function fitHomographyRansac(cv: OpenCv, correspondences: Correspondence[]): { matrix: number[]; inlierMask: number[] } | null {
    const fromArray: number[] = [];
    const toArray: number[] = [];
    for (const c of correspondences) {
        fromArray.push(c.fromX, c.fromY);
        toArray.push(c.toX, c.toY);
    }

    const fromMat = cv.matFromArray(correspondences.length, 1, cv.CV_32FC2, fromArray);
    const toMat = cv.matFromArray(correspondences.length, 1, cv.CV_32FC2, toArray);
    const inliersMat = new cv.Mat();

    try {
        const M = (
            cv.findHomography as (
                from: CvMat,
                to: CvMat,
                method: number,
                ransacReprojThreshold: number,
                mask: CvMat,
                maxIters: number,
                confidence: number
            ) => CvMat
        )(fromMat, toMat, cv.RANSAC, RANSAC_REPROJ_THRESHOLD_PX, inliersMat, RANSAC_MAX_ITERS, RANSAC_CONFIDENCE);

        try {
            if (M.rows !== 3 || M.cols !== 3) return null;
            const matrix = Array.from(M.data64F as Float64Array);
            const inlierMask = Array.from(inliersMat.data as Uint8Array);
            return { matrix, inlierMask };
        } finally {
            M.delete();
        }
    } finally {
        fromMat.delete();
        toMat.delete();
        inliersMat.delete();
    }
}

export function applyAffine(matrix: AffineMatrix, x: number, y: number): { dx: number; dy: number } {
    return { dx: matrix[0] * x + matrix[1] * y + matrix[2] - x, dy: matrix[3] * x + matrix[4] * y + matrix[5] - y };
}

export function applyHomography(matrix: number[], x: number, y: number): { dx: number; dy: number } {
    const w = matrix[6] * x + matrix[7] * y + matrix[8];
    if (Math.abs(w) < 1e-9) return { dx: 0, dy: 0 };
    const px = (matrix[0] * x + matrix[1] * y + matrix[2]) / w;
    const py = (matrix[3] * x + matrix[4] * y + matrix[5]) / w;
    return { dx: px - x, dy: py - y };
}

export function residualOfAffine(c: Correspondence, matrix: AffineMatrix): { dx: number; dy: number } {
    const predicted = applyAffine(matrix, c.fromX, c.fromY);
    return { dx: c.toX - c.fromX - predicted.dx, dy: c.toY - c.fromY - predicted.dy };
}

export function residualOfHomography(c: Correspondence, matrix: number[]): { dx: number; dy: number } {
    const predicted = applyHomography(matrix, c.fromX, c.fromY);
    return { dx: c.toX - c.fromX - predicted.dx, dy: c.toY - c.fromY - predicted.dy };
}

/** Convenience: residual against a pure translation (dx, dy applied uniformly). */
export function residualOfTranslation(c: Correspondence, dx: number, dy: number): { dx: number; dy: number } {
    return { dx: c.toX - c.fromX - dx, dy: c.toY - c.fromY - dy };
}

/**
 * One cell of a coarse spatial grid over the frame, reporting the mean
 * RESIDUAL displacement (matched point minus what the baseline model —
 * usually the fitted translation — predicted) of correspondences whose
 * from-point fell in this cell. `coherent` requires enough samples AND
 * low internal disagreement — see PARALLAX_MAX_QUADRANT_DISPERSION_PX at
 * each call site — which is what tells a genuine depth-layer residual
 * (several correspondences in one part of the frame all pointing the
 * same uncompensated way) apart from scattered, mutually contradictory
 * noise worth ignoring.
 */
export interface RegionalMotionCell {
    row: number;
    col: number;
    dx: number;
    dy: number;
    sampleCount: number;
    coherent: boolean;
    /** Mean distance of this cell's residuals from their own mean — 0 for a perfectly agreeing cell, large for scattered/noisy ones. Retained (not just folded into `coherent`) so consumers can grade confidence continuously rather than just pass/fail. */
    dispersion: number;
}

/**
 * Buckets every correspondence's residual (relative to a baseline model,
 * usually the fitted translation) into a `gridRows` x `gridCols` spatial
 * grid by its previous-frame position. Deliberately generalized beyond a
 * square grid: the legacy path uses a coarse 2x2 (cheap, reuses ~20
 * correspondences), while the motion-field path — with 100-300 optical-flow
 * correspondences instead of ~20 — can support a meaningfully finer grid
 * (e.g. 4 columns x 3 rows) without the individual cells starving for
 * samples, which is what lets it actually separate near/mid/far depth
 * layers rather than only detect that "some" quadrant disagrees.
 */
export function computeRegionalResiduals(
    correspondences: Correspondence[],
    residuals: { dx: number; dy: number }[],
    width: number,
    height: number,
    gridRows: number,
    gridCols: number,
    minSamples: number,
    maxDispersionPx: number
): RegionalMotionCell[] {
    const cells: RegionalMotionCell[] = [];

    for (let row = 0; row < gridRows; row++) {
        for (let col = 0; col < gridCols; col++) {
            const inCell = correspondences
                .map((c, i) => ({ c, r: residuals[i] }))
                .filter(
                    ({ c }) =>
                        Math.floor((c.fromX / width) * gridCols) === col && Math.floor((c.fromY / height) * gridRows) === row
                );

            if (inCell.length < minSamples) {
                cells.push({ row, col, dx: 0, dy: 0, sampleCount: inCell.length, coherent: false, dispersion: Infinity });
                continue;
            }

            const meanDx = mean(inCell.map(({ r }) => r.dx));
            const meanDy = mean(inCell.map(({ r }) => r.dy));
            const dispersion = mean(inCell.map(({ r }) => Math.hypot(r.dx - meanDx, r.dy - meanDy)));

            cells.push({
                row,
                col,
                dx: meanDx,
                dy: meanDy,
                sampleCount: inCell.length,
                coherent: dispersion <= maxDispersionPx,
                dispersion
            });
        }
    }

    return cells;
}

/**
 * Whether a richer model (affine/homography) fit the SAME correspondences
 * decisively better than a simpler baseline already in use — both a
 * meaningfully higher inlier ratio and a meaningfully lower residual, not
 * just the marginal improvement any higher-DOF model gets "for free" on
 * any dataset. This is the guard against the overfitting failure mode
 * documented in GlobalMotionEstimator's module doc: with too few
 * correspondences, an unconstrained richer model can silently absorb a
 * real independently-moving region into a spurious global transform. It
 * does not become safe just because it's centralized here — callers still
 * decide whether "decisively better" is even enough to use the richer
 * model for anything beyond a diagnostic label (see SceneMotion.model).
 */
export function isMeaningfullyBetterFit(
    baselineInlierRatio: number,
    baselineResidualError: number,
    candidateInlierRatio: number,
    candidateResidualError: number,
    minInlierGain: number,
    maxResidualFraction: number
): boolean {
    const meaningfullyMoreInliers = candidateInlierRatio - baselineInlierRatio >= minInlierGain;
    const meaningfullyLowerResidual =
        baselineResidualError <= 0 || candidateResidualError <= baselineResidualError * maxResidualFraction;
    return meaningfullyMoreInliers && meaningfullyLowerResidual;
}

export function mean(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function median(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
