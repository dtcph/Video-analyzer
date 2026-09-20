import type { OpenCv, CvMat } from "./BlobDetector";

/** Runtime shape of cv.minMaxLoc's return value — see the call site for why this isn't taken from the vendored types. */
interface MinMaxLocResult {
    minVal: number;
    maxVal: number;
    minLoc: { x: number; y: number };
    maxLoc: { x: number; y: number };
}

/**
 * One quadrant of the coarse 2x2 spatial breakdown of how well the fitted
 * global model explains motion in that part of the frame. `dx`/`dy` is
 * the mean RESIDUAL displacement (matched point minus what the global
 * model predicted) of the sample correspondences whose previous-frame
 * position fell in this quadrant — near zero means the global model
 * already explains this part of the frame well; a non-trivial, `coherent`
 * residual means this quadrant is moving in a way the single global
 * transform can't capture (the parallax/depth-layer case), which is
 * different from a quadrant with a large but incoherent (high-dispersion)
 * residual, which just means noisy/scattered correspondences there, not a
 * systematic layer.
 */
export interface RegionalMotionCell {
    row: number;
    col: number;
    dx: number;
    dy: number;
    sampleCount: number;
    /** True when the correspondences behind this cell agree with each other reasonably tightly — see PARALLAX_MAX_QUADRANT_DISPERSION_PX. A cell with too few samples or high internal disagreement is never `coherent`, and consumers should not treat its dx/dy as meaningful. */
    coherent: boolean;
}

/**
 * This frame's estimate of global (camera) motion between two grayscale
 * frames, in analysis-resolution pixels.
 *
 * `dx`/`dy`/`matrix` describe the model actually used for compensation —
 * a robust TRANSLATION only (`matrix` is always `[1, 0, dx, 0, 1, dy]`).
 * See `model` for why this stays translation-only rather than upgrading
 * to a full affine fit for compensation, even though an affine fit is
 * also computed (see below).
 *
 * `confidence` (0..1) reflects how much of the sampled frame supports
 * this translation and how good those matches are; `valid` is the actual
 * go/no-go signal consumers should check — a low confidence should mean
 * "don't compensate", not "compensate a little".
 */
export interface GlobalMotion {
    dx: number;
    dy: number;
    confidence: number;
    valid: boolean;

    /** Always `[1, 0, dx, 0, 1, dy]` — see `model`'s doc for why this doesn't become a richer transform. Kept as a matrix (not just dx/dy) so compensateGlobalMotion has one shape to warp with regardless of model. */
    matrix: [number, number, number, number, number, number];
    /**
     * DIAGNOSTIC label, not a statement about what `matrix` is. "affine"
     * means a separately-fitted RANSAC affine model (see
     * `diagnosticAffineFit` in the implementation) explained the sampled
     * correspondences MEANINGFULLY better than the translation actually
     * used for compensation — i.e. "a richer model probably describes
     * this frame's motion" (camera roll, zoom/dolly). It is NOT used for
     * compensation: an early implementation did compensate with the
     * fitted affine directly, and synthetic testing caught a concrete
     * failure mode (see scripts/detectorScenarios.ts) — with only ~20
     * sparse correspondences, an unconstrained 6-DOF affine fit can
     * "explain" two genuinely distinct motions (a real background plus a
     * real independently-moving region) as one spurious continuous
     * scale/shear, silently absorbing independent motion into the
     * "camera motion" instead of flagging it. Camera rotation is already
     * handled acceptably by translation alone in this codebase's own
     * validation, so the affine fit is kept as a reporting signal
     * (surfaced in the debug HUD, and folded into `parallaxDetected`)
     * rather than trusted for the pixel-level warp — an unreliable richer
     * model is worse than a reliable simple one, same principle as the
     * confidence gate below.
     */
    model: "translation" | "affine";
    /** Fraction of sampled correspondences RANSAC accepted as consistent with the translation actually used for compensation — the direct "how much of the frame agrees with one camera motion" figure requested for the debug view. */
    inlierRatio: number;
    /** Mean reprojection error (px) of the RANSAC inliers against the translation actually used — near the RANSAC threshold at best fit; large only when even the "agreeing" set was a poor, likely spurious fit. */
    residualError: number;
    /**
     * True when, despite a usable global fit, at least one spatial
     * quadrant of the frame shows a coherent (not just noisy) residual
     * motion the global model doesn't explain — the depth-parallax
     * signature described in the module doc: near/mid/far scene content
     * moving at different apparent rates during real 3D camera
     * translation, which no single 2D transform can fully capture. This
     * does NOT mean "there's an independent object here" — it means the
     * global model alone is an incomplete explanation for this frame, so
     * downstream candidate filtering should apply extra scrutiny (see
     * MotionCandidateFilter's parallax-aware gate) rather than trust
     * every bit of post-compensation residual motion as a real blob.
     */
    parallaxDetected: boolean;
    /** Coarse 2x2 breakdown backing `parallaxDetected` — see RegionalMotionCell. Always 4 cells (row/col in [0,1]), even when some are low-sample/incoherent. */
    regionalMotion: RegionalMotionCell[];
}

export const NO_GLOBAL_MOTION: GlobalMotion = {
    dx: 0,
    dy: 0,
    confidence: 0,
    valid: false,
    matrix: [1, 0, 0, 0, 1, 0],
    model: "translation",
    inlierRatio: 0,
    residualError: 0,
    parallaxDetected: false,
    regionalMotion: []
};

// --- Tuning constants -------------------------------------------------
// Not exposed as UI sliders (see AnalysisControls) — these shape the
// internal correspondence search and robust-fit behavior, not something a
// user tunes per video, same spirit as e.g. TrackReidentifier.REIDENTIFY_THRESHOLD.

/** Grid of sample patches spread across the frame — enough spatial coverage to distinguish "most of the frame agrees" from "a few coincidentally-aligned patches", without the cost of matching every pixel. */
const GRID_COLS = 5;
const GRID_ROWS = 4;
/** Patch (template) side length, in analysis-resolution px. */
const PATCH_SIZE = 24;
/** Max displacement, in px each direction, the search window allows a patch to have moved. */
const SEARCH_MARGIN = 14;
/** Fraction of the frame kept as a border where no patch is placed, so every patch's search window fits fully inside the frame without extra edge-of-frame bookkeeping. */
const EDGE_MARGIN_FRACTION = 0.08;
/** Minimum grayscale std-dev within a patch (0..255) for it to be usable as a match anchor — a flat, textureless patch (sky, an out-of-focus wall) matches almost anywhere similarly well and would otherwise contribute noise, not signal. */
const MIN_PATCH_TEXTURE = 6;
/** Minimum normalized cross-correlation (TM_CCOEFF_NORMED, -1..1) for a patch's best match to be trusted enough to even offer it to RANSAC. */
const MIN_MATCH_SCORE = 0.6;
/** Minimum number of candidate correspondences (post texture/score gating) before attempting a fit at all — a couple of lucky matches isn't evidence of anything. */
const MIN_CORRESPONDENCES = 6;
/** Minimum RANSAC inliers for the fitted model to be trusted at all, mirroring the old MIN_AGREEING_PATCHES. */
const MIN_INLIERS = 6;
/** Max pixel reprojection error for a correspondence to count as a RANSAC inlier. */
const RANSAC_REPROJ_THRESHOLD_PX = 3;
const RANSAC_MAX_ITERS = 500;
const RANSAC_CONFIDENCE = 0.99;
/** Confidence bar a fitted model must clear before consumers should compensate with it at all. */
const MIN_VALID_CONFIDENCE = 0.5;
/** How much better (absolute inlier-ratio gain) the diagnostic affine fit must do over the translation actually used before the debug label reports "affine" instead of "translation" — see GlobalMotion.model for why this stays diagnostic-only. */
const AFFINE_DIAGNOSTIC_MIN_GAIN = 0.15;
/** The diagnostic affine fit's mean residual must additionally drop to (at most) this fraction of the translation's own residual — guards against reporting "affine" over trivial/noise-level differences. */
const AFFINE_DIAGNOSTIC_MAX_RESIDUAL_FRACTION = 0.6;

// Parallax/regional-residual detection — a coarse 2x2 breakdown of the
// SAME correspondences already gathered for the global fit (no extra
// frame passes), used only to decide (a) whether more than one
// coherent motion exists in the frame and (b) to give MotionCandidateFilter
// a per-region "this is probably background residual, not an object"
// reference — see RegionalMotionCell and MotionCandidateFilter.
const PARALLAX_GRID_SIZE = 2;
/** A quadrant needs at least this many correspondences before its mean residual means anything. */
const MIN_QUADRANT_SAMPLES = 2;
/** A quadrant's own residuals must cluster within this radius (px) of their mean to call it "coherent" (a systematic depth-layer-like residual) rather than noisy/scattered outliers. */
const PARALLAX_MAX_QUADRANT_DISPERSION_PX = 2;
/** A coherent quadrant's mean residual must exceed this magnitude (px) to count as meaningful leftover motion, not just RANSAC/measurement noise. */
const PARALLAX_MIN_RESIDUAL_PX = 2.5;
/** Above this inlier ratio, the global model is already explaining nearly everything — not worth flagging parallax even if one small coherent pocket of residual exists. */
const PARALLAX_MAX_INLIER_RATIO = 0.9;

interface Correspondence {
    /** Previous-frame patch center. */
    fromX: number;
    fromY: number;
    /** Matched location in the current frame. */
    toX: number;
    toY: number;
    score: number;
}

/**
 * Estimates global (camera) motion between two grayscale frames.
 *
 * Correspondences come from grid-based block matching (matchTemplate +
 * minMaxLoc over small textured patches — sparse, not dense optical
 * flow). They're combined via a proper 1-point-hypothesis RANSAC over
 * pure translation (see `fitTranslationRansac`) — outlier correspondences
 * (typically sitting on an independently moving object, or a different
 * depth layer under real 3D camera motion) don't drag the fit the way an
 * unweighted average would.
 *
 * A full affine model (rotation/scale/shear, fit via OpenCV's own
 * RANSAC-based `estimateAffine2D`) is also computed, but purely as a
 * DIAGNOSTIC signal (see GlobalMotion.model) — actual compensation always
 * uses the robust translation. Synthetic testing surfaced a concrete
 * reason not to trust the unconstrained affine fit for compensation: with
 * only ~20 sparse correspondences, it can "explain" two genuinely
 * distinct motions (real background plus a real independently-moving
 * region covering a meaningful chunk of the frame) as one spurious
 * continuous scale, silently absorbing independent motion into "camera
 * motion" rather than flagging it — see scripts/detectorScenarios.ts's
 * "independent motion covering a minority of the frame" scenario, which
 * is exactly how this was caught. Camera rotation was already reported as
 * working acceptably under translation-only compensation before this
 * change, so there wasn't a case where the affine's real benefit
 * outweighed that overfitting risk.
 *
 * `confidence` is inlier-fraction x average inlier match quality — not
 * just how many patches were sampled. This matters because "most tracked
 * objects moved the same way" is not evidence of camera motion by itself
 * (a flock, a crowd, several independently panning blobs can all move
 * together); what actually distinguishes real camera motion is that a
 * large, spatially-spread fraction of the whole visible frame supports
 * the same shift.
 *
 * Beyond the single global fit, the same correspondences are also
 * grouped into a coarse 2x2 spatial breakdown of RESIDUAL (post-
 * translation-compensation) motion, to check whether one part of the
 * frame has coherent leftover motion the global translation doesn't
 * explain (see RegionalMotionCell/parallaxDetected) — the signature of
 * real 3D camera translation through a scene with depth (parallax): the
 * dominant/majority layer gets compensated away, while nearer/farther
 * layers (and real independently moving objects) remain as residual for
 * MotionCandidateFilter to reason about with actual shape/persistence
 * evidence, rather than the detector guessing here. This is deliberately
 * NOT a second full regional block-matching pass (that would double the
 * per-frame cost for a use that's purely diagnostic/gating); it's the
 * existing correspondences' residuals, bucketed by location.
 */
export function estimateGlobalMotion(
    cv: OpenCv,
    previous: CvMat,
    current: CvMat,
    width: number,
    height: number,
    /** Whether to run the diagnostic affine RANSAC fit at all — it only feeds GlobalMotion.model's debug label (see its doc), so BlobDetector skips it entirely outside AnalysisSettings.detectorDebugEnabled to avoid paying for a fit nobody is looking at on every analyzed frame. */
    computeDiagnosticModel = true
): GlobalMotion {
    if (previous.rows !== current.rows || previous.cols !== current.cols) return NO_GLOBAL_MOTION;

    const marginX = Math.max(SEARCH_MARGIN + PATCH_SIZE / 2, Math.round(width * EDGE_MARGIN_FRACTION));
    const marginY = Math.max(SEARCH_MARGIN + PATCH_SIZE / 2, Math.round(height * EDGE_MARGIN_FRACTION));

    if (width - 2 * marginX < PATCH_SIZE || height - 2 * marginY < PATCH_SIZE) return NO_GLOBAL_MOTION;

    const correspondences = gatherCorrespondences(cv, previous, current, width, height, marginX, marginY);
    if (correspondences.length < MIN_CORRESPONDENCES) return NO_GLOBAL_MOTION;

    const translationFit = fitTranslationRansac(correspondences);
    const inliers = correspondences.filter((_, i) => translationFit.inlierMask[i] !== 0);
    if (inliers.length < MIN_INLIERS) return NO_GLOBAL_MOTION;

    const matrix: [number, number, number, number, number, number] = [1, 0, translationFit.dx, 0, 1, translationFit.dy];

    const residuals = correspondences.map((c) => residualOf(c, matrix));
    const inlierResiduals = residuals.filter((_, i) => translationFit.inlierMask[i] !== 0);
    const residualError = mean(inlierResiduals.map((r) => Math.hypot(r.dx, r.dy)));

    const inlierRatio = inliers.length / correspondences.length;
    const avgInlierScore = mean(inliers.map((c) => c.score));
    const confidence = inlierRatio * avgInlierScore;
    const valid = confidence >= MIN_VALID_CONFIDENCE;

    const model = computeDiagnosticModel ? diagnosticModel(cv, correspondences, inlierRatio, residualError) : "translation";

    const regionalMotion = computeRegionalResiduals(correspondences, residuals, width, height);
    const parallaxDetected =
        valid &&
        inlierRatio <= PARALLAX_MAX_INLIER_RATIO &&
        regionalMotion.some((cell) => cell.coherent && Math.hypot(cell.dx, cell.dy) >= PARALLAX_MIN_RESIDUAL_PX);

    return {
        dx: translationFit.dx,
        dy: translationFit.dy,
        confidence,
        valid,
        matrix,
        model,
        inlierRatio,
        residualError,
        parallaxDetected,
        regionalMotion
    };
}

/**
 * Robust translation via 1-point-hypothesis RANSAC: each correspondence's
 * own displacement is tried as a candidate global translation, scored by
 * how many OTHER correspondences it explains within
 * RANSAC_REPROJ_THRESHOLD_PX; the best-scoring hypothesis's inlier set is
 * then refined by taking the median displacement over just those inliers
 * (median rather than mean — consistent with the rest of this codebase's
 * preference for median over outliers, e.g. BlobTracker's own
 * CameraMotionEstimator). With ~20 correspondences this is at most a few
 * hundred distance comparisons, trivial next to the block-matching that
 * produced them.
 */
function fitTranslationRansac(correspondences: Correspondence[]): { dx: number; dy: number; inlierMask: number[] } {
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
    // translation, not the single seed hypothesis — the median of the
    // seed's inlier set is usually a slightly better estimate than any
    // one of its members, and a correspondence right at the boundary can
    // flip in or out accordingly.
    const inlierMask = displacements.map((d) => (Math.hypot(d.dx - dx, d.dy - dy) <= RANSAC_REPROJ_THRESHOLD_PX ? 1 : 0));

    return { dx, dy, inlierMask };
}

/**
 * Purely diagnostic: fits a full affine model via OpenCV's RANSAC (see
 * fitAffineRansac) and reports "affine" only when it explains the SAME
 * correspondences decisively better than the translation actually used —
 * both a meaningfully higher inlier ratio and a meaningfully lower
 * residual, not just a marginal improvement a 6-DOF model gets "for
 * free" over a 2-DOF one on any dataset. Never influences `matrix`,
 * `confidence`, or `parallaxDetected` — see GlobalMotion.model.
 */
function diagnosticModel(cv: OpenCv, correspondences: Correspondence[], translationInlierRatio: number, translationResidualError: number): GlobalMotion["model"] {
    const affineFit = fitAffineRansac(cv, correspondences);
    if (!affineFit) return "translation";

    const affineInliers = correspondences.filter((_, i) => affineFit.inlierMask[i] !== 0);
    if (affineInliers.length < MIN_INLIERS) return "translation";

    const affineInlierRatio = affineInliers.length / correspondences.length;
    const affineResiduals = correspondences
        .map((c) => residualOf(c, affineFit.matrix))
        .filter((_, i) => affineFit.inlierMask[i] !== 0);
    const affineResidualError = mean(affineResiduals.map((r) => Math.hypot(r.dx, r.dy)));

    const meaningfullyMoreInliers = affineInlierRatio - translationInlierRatio >= AFFINE_DIAGNOSTIC_MIN_GAIN;
    const meaningfullyLowerResidual =
        translationResidualError <= 0 || affineResidualError <= translationResidualError * AFFINE_DIAGNOSTIC_MAX_RESIDUAL_FRACTION;

    return meaningfullyMoreInliers && meaningfullyLowerResidual ? "affine" : "translation";
}

/** Grid-based sparse block matching — unchanged in spirit from the original translation-only estimator, just returning raw correspondences instead of pre-reducing them to a single displacement. */
function gatherCorrespondences(
    cv: OpenCv,
    previous: CvMat,
    current: CvMat,
    width: number,
    height: number,
    marginX: number,
    marginY: number
): Correspondence[] {
    const correspondences: Correspondence[] = [];

    const meanMat = new cv.Mat();
    const stddevMat = new cv.Mat();
    const result = new cv.Mat();

    try {
        for (let row = 0; row < GRID_ROWS; row++) {
            for (let col = 0; col < GRID_COLS; col++) {
                const cx = marginX + ((col + 0.5) * (width - 2 * marginX)) / GRID_COLS;
                const cy = marginY + ((row + 0.5) * (height - 2 * marginY)) / GRID_ROWS;

                const patchRect = new cv.Rect(Math.round(cx - PATCH_SIZE / 2), Math.round(cy - PATCH_SIZE / 2), PATCH_SIZE, PATCH_SIZE);
                const searchRect = new cv.Rect(
                    patchRect.x - SEARCH_MARGIN,
                    patchRect.y - SEARCH_MARGIN,
                    PATCH_SIZE + 2 * SEARCH_MARGIN,
                    PATCH_SIZE + 2 * SEARCH_MARGIN
                );

                const patch = previous.roi(patchRect);
                cv.meanStdDev(patch, meanMat, stddevMat);
                const texture = stddevMat.data64F[0];
                if (texture < MIN_PATCH_TEXTURE) {
                    patch.delete();
                    continue;
                }

                const searchRegion = current.roi(searchRect);
                cv.matchTemplate(searchRegion, patch, result, cv.TM_CCOEFF_NORMED);
                // The vendored .d.ts mis-declares minMaxLoc as taking
                // output-pointer params mirroring OpenCV's native C++
                // signature; the actual JS/WASM binding takes just the Mat
                // (plus an optional mask) and returns
                // {minVal, maxVal, minLoc, maxLoc} — verified against the
                // runtime directly, not just the types.
                const { maxVal, maxLoc } = (cv.minMaxLoc as (src: CvMat) => MinMaxLocResult)(result);
                patch.delete();
                searchRegion.delete();

                if (maxVal < MIN_MATCH_SCORE) continue;

                correspondences.push({
                    fromX: patchRect.x + PATCH_SIZE / 2,
                    fromY: patchRect.y + PATCH_SIZE / 2,
                    toX: searchRect.x + maxLoc.x + PATCH_SIZE / 2,
                    toY: searchRect.y + maxLoc.y + PATCH_SIZE / 2,
                    score: maxVal
                });
            }
        }
    } finally {
        meanMat.delete();
        stddevMat.delete();
        result.delete();
    }

    return correspondences;
}

/**
 * Fits a 2x3 affine transform mapping `fromX/Y` -> `toX/Y` via OpenCV's
 * RANSAC-based estimateAffine2D — verified directly against the actual
 * WASM runtime (not just the vendored types) to (a) exist in this build,
 * (b) return a 2x3 `[a, b, tx, c, d, ty]` matrix plus an inlier mask, and
 * (c) correctly down-weight synthetic outlier correspondences without
 * distorting the fit. Returns null on a degenerate input (too few points,
 * collinear points) — OpenCV reports this as an empty (0-row) result
 * rather than throwing.
 */
function fitAffineRansac(
    cv: OpenCv,
    correspondences: Correspondence[]
): { matrix: [number, number, number, number, number, number]; inlierMask: number[] } | null {
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
            const matrix: [number, number, number, number, number, number] = [
                data[0],
                data[1],
                data[2],
                data[3],
                data[4],
                data[5]
            ];
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

function applyAffine(matrix: [number, number, number, number, number, number], x: number, y: number): { dx: number; dy: number } {
    return { dx: matrix[0] * x + matrix[1] * y + matrix[2], dy: matrix[3] * x + matrix[4] * y + matrix[5] };
}

function residualOf(c: Correspondence, matrix: [number, number, number, number, number, number]): { dx: number; dy: number } {
    const predicted = applyAffine(matrix, c.fromX, c.fromY);
    return { dx: c.toX - predicted.dx, dy: c.toY - predicted.dy };
}

/**
 * Buckets every correspondence's residual (relative to the fitted global
 * model) into a 2x2 spatial grid by its previous-frame position, and
 * reports each cell's mean residual plus whether that cell's
 * correspondences actually agree with each other. A cell is only
 * `coherent` with enough samples AND low internal dispersion — this is
 * what tells a genuine depth-layer residual (several correspondences in
 * one region of the frame all pointing the same uncompensated way) apart
 * from a cell that just happens to contain scattered, mutually
 * contradictory leftover motion (noise, or a couple of unrelated small
 * outliers) worth ignoring.
 */
function computeRegionalResiduals(
    correspondences: Correspondence[],
    residuals: { dx: number; dy: number }[],
    width: number,
    height: number
): RegionalMotionCell[] {
    const cells: RegionalMotionCell[] = [];

    for (let row = 0; row < PARALLAX_GRID_SIZE; row++) {
        for (let col = 0; col < PARALLAX_GRID_SIZE; col++) {
            const inCell = correspondences
                .map((c, i) => ({ c, r: residuals[i] }))
                .filter(({ c }) => Math.floor((c.fromX / width) * PARALLAX_GRID_SIZE) === col && Math.floor((c.fromY / height) * PARALLAX_GRID_SIZE) === row);

            if (inCell.length < MIN_QUADRANT_SAMPLES) {
                cells.push({ row, col, dx: 0, dy: 0, sampleCount: inCell.length, coherent: false });
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
                coherent: dispersion <= PARALLAX_MAX_QUADRANT_DISPERSION_PX
            });
        }
    }

    return cells;
}

function mean(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function median(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Warps `src` by the fitted global transform so its content lines up with
 * a frame taken one step later under that motion — used to align a
 * previous frame to the current one before diffing, so the diff reflects
 * local motion against the (now-matching) background rather than the
 * camera's own motion. Edge pixels revealed by the warp are replicated
 * rather than left black (BORDER_REPLICATE) — plain zero-fill would
 * otherwise read as a big fake "changed" strip along whichever edge the
 * motion revealed, exactly the kind of spurious motion this exists to
 * remove. Caller owns deleting the returned Mat.
 */
export function compensateGlobalMotion(cv: OpenCv, src: CvMat, motion: GlobalMotion): CvMat {
    const dst = new cv.Mat();
    const M = cv.matFromArray(2, 3, cv.CV_64FC1, motion.matrix);
    try {
        cv.warpAffine(src, dst, M, new cv.Size(src.cols, src.rows), cv.INTER_LINEAR, cv.BORDER_REPLICATE);
    } finally {
        M.delete();
    }
    return dst;
}
