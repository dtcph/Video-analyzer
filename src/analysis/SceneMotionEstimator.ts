import type { OpenCv, CvMat } from "./BlobDetector";
import { estimateSparseMotion } from "./SparseMotionEstimator";
import type { MotionVector } from "./SparseMotionEstimator";
import {
    fitTranslationRansac,
    fitAffineRansac,
    fitHomographyRansac,
    residualOfTranslation,
    residualOfAffine,
    residualOfHomography,
    computeRegionalResiduals,
    isMeaningfullyBetterFit,
    mean,
    type Correspondence
} from "./MotionModelFit";
import type { GlobalMotion } from "./GlobalMotionEstimator";

/**
 * The motion-field path's replacement for GlobalMotionEstimator, built
 * against the same GlobalMotion shape so BlobDetector, MotionCandidateFilter,
 * AnalysisControls and AnalysisOverlay all keep working unchanged whichever
 * path produced the estimate (see AnalysisSettings.cameraMotionMode). The
 * legacy path stays available and unmodified in GlobalMotionEstimator.ts —
 * see its module doc and CLAUDE.md for why: real drone / moving-vehicle
 * footage broke the "one global translation (+coarse 2x2 residual)"
 * assumption badly enough (near/far/independent motion all reading as
 * "everything is moving") that it needed a genuinely different motion
 * representation, not another threshold on top of the same one.
 *
 * Pipeline: `estimateSparseMotion` (goodFeaturesToTrack + calcOpticalFlowPyrLK,
 * ~100-300 tracked features — see its module doc for why this beats the
 * legacy path's ~20 block-matched patches) produces a MotionField, which
 * is then fed through the SAME robust-fit machinery the legacy path uses
 * (MotionModelFit.ts) — this reuse is deliberate: the RANSAC translation
 * fit, the "richer model must decisively beat the simpler one" overfitting
 * guard, and the regional-residual bucketing are proven, already-tested
 * building blocks, not something worth reimplementing differently per
 * path. What's genuinely new here is (a) far more correspondences to work
 * with, which is what makes a finer-than-2x2 regional grid meaningful, and
 * (b) reporting "field" as a `model` label distinct from "affine"/
 * "homography" for the "flow varies coherently across several distinct
 * regions" case that no single transform (however rich) actually
 * describes well — the multi-depth-layer signature the spec calls out.
 *
 * `matrix` (what BlobDetector actually warps with) is STILL always the
 * robust translation, exactly like the legacy path, for exactly the same
 * reason (see GlobalMotion.model's doc and item 8 of the motion-field
 * design brief): a flexible model fit from sparse points can still
 * silently absorb real independent motion into a spurious "camera
 * motion" warp, and an unreliable richer compensation is worse than a
 * reliable simple one. Affine/homography/field are diagnostic labels
 * (surfaced in the debug HUD) plus an input to `parallaxDetected`/
 * `regionalMotion`, which is what MotionCandidateFilter's parallax-aware
 * gate actually consumes to suppress background/depth residue — not a
 * pixel-level compensation upgrade.
 */

/** Motion-field path's own regional grid — deliberately finer than the legacy path's 2x2 (see this module's doc): with 100-300 correspondences instead of ~20, a 4-column x 3-row grid still leaves each cell enough samples to judge coherence, and can actually separate near/mid/far depth layers instead of only detecting that "some" quadrant disagrees. */
const GRID_COLS = 4;
const GRID_ROWS = 3;

const MIN_CORRESPONDENCES = 20;
const MIN_INLIERS = 15;
const MIN_VALID_CONFIDENCE = 0.5;

/** Same asymmetric "decisively better, not just marginally" gates as the legacy path's diagnostic affine fit — see MotionModelFit.isMeaningfullyBetterFit and GlobalMotionEstimator's module doc for the overfitting failure mode this guards against. */
const AFFINE_MIN_GAIN = 0.15;
const AFFINE_MAX_RESIDUAL_FRACTION = 0.6;
/** Homography is the richest (8-DOF) model tried, so it's held to a stricter bar than affine over the SAME translation baseline — it must not just match affine's improvement but clearly exceed it, or the label stays "affine". */
const HOMOGRAPHY_MIN_GAIN = 0.22;
const HOMOGRAPHY_MAX_RESIDUAL_FRACTION = 0.5;

const MIN_QUADRANT_SAMPLES = 4;
const PARALLAX_MAX_QUADRANT_DISPERSION_PX = 2;
const PARALLAX_MIN_RESIDUAL_PX = 2.5;
const PARALLAX_MAX_INLIER_RATIO = 0.9;
/** Two or more distinct coherent regions carrying real leftover motion is the "this isn't one transform, it's several depth layers" signature — reported as model "field" rather than "affine"/"homography" even when one of those happened to also pass its own gate, since a single richer transform is a worse summary of the frame than acknowledging it's several. */
const FIELD_MIN_COHERENT_REGIONS = 2;

export const NO_MOTION_FIELD_ESTIMATE: GlobalMotion = {
    dx: 0,
    dy: 0,
    confidence: 0,
    valid: false,
    matrix: [1, 0, 0, 0, 1, 0],
    model: "translation",
    inlierRatio: 0,
    residualError: 0,
    parallaxDetected: false,
    regionalMotion: [],
    gridRows: GRID_ROWS,
    gridCols: GRID_COLS,
    vectors: [],
    residualVectors: [],
    featureCount: 0,
    validCount: 0
};

/**
 * Estimates scene (camera + depth-layer) motion between two grayscale
 * analysis frames via sparse optical flow — see this module's doc for the
 * overall approach and why it exists alongside (not instead of) the
 * legacy `estimateGlobalMotion`.
 */
export function estimateMotionField(
    cv: OpenCv,
    previous: CvMat,
    current: CvMat,
    width: number,
    height: number,
    computeDiagnosticModel = true
): GlobalMotion {
    const field = estimateSparseMotion(cv, previous, current, width, height);
    if (field.vectors.length < MIN_CORRESPONDENCES) {
        return { ...NO_MOTION_FIELD_ESTIMATE, featureCount: field.featureCount, validCount: field.validCount };
    }

    const correspondences: Correspondence[] = field.vectors.map((v) => ({
        fromX: v.x,
        fromY: v.y,
        toX: v.x + v.dx,
        toY: v.y + v.dy,
        score: v.confidence
    }));

    const translationFit = fitTranslationRansac(correspondences);
    const inliers = correspondences.filter((_, i) => translationFit.inlierMask[i] !== 0);
    if (inliers.length < MIN_INLIERS) {
        return { ...NO_MOTION_FIELD_ESTIMATE, featureCount: field.featureCount, validCount: field.validCount, vectors: field.vectors };
    }

    const matrix: [number, number, number, number, number, number] = [1, 0, translationFit.dx, 0, 1, translationFit.dy];
    const residuals = correspondences.map((c) => residualOfTranslation(c, translationFit.dx, translationFit.dy));
    const inlierResiduals = residuals.filter((_, i) => translationFit.inlierMask[i] !== 0);
    const residualError = mean(inlierResiduals.map((r) => Math.hypot(r.dx, r.dy)));

    const inlierRatio = inliers.length / correspondences.length;
    const avgInlierScore = mean(inliers.map((c) => c.score));
    const confidence = inlierRatio * avgInlierScore;
    const valid = confidence >= MIN_VALID_CONFIDENCE;

    const regionalMotion = computeRegionalResiduals(
        correspondences,
        residuals,
        width,
        height,
        GRID_ROWS,
        GRID_COLS,
        MIN_QUADRANT_SAMPLES,
        PARALLAX_MAX_QUADRANT_DISPERSION_PX
    );
    const coherentSignalCells = regionalMotion.filter((cell) => cell.coherent && Math.hypot(cell.dx, cell.dy) >= PARALLAX_MIN_RESIDUAL_PX);
    const parallaxDetected = valid && inlierRatio <= PARALLAX_MAX_INLIER_RATIO && coherentSignalCells.length > 0;

    const model = computeDiagnosticModel
        ? selectDiagnosticModel(cv, correspondences, inlierRatio, residualError, coherentSignalCells.length)
        : "translation";

    const residualVectors: MotionVector[] = field.vectors.map((v, i) => ({
        x: v.x,
        y: v.y,
        dx: residuals[i].dx,
        dy: residuals[i].dy,
        magnitude: Math.hypot(residuals[i].dx, residuals[i].dy),
        confidence: v.confidence
    }));

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
        regionalMotion,
        gridRows: GRID_ROWS,
        gridCols: GRID_COLS,
        vectors: field.vectors,
        residualVectors,
        featureCount: field.featureCount,
        validCount: field.validCount
    };
}

/**
 * Reports which model best DESCRIBES the observed flow — purely
 * diagnostic, never used for `matrix` (see this module's doc). Tries
 * affine first, then homography strictly on top of whichever baseline
 * (translation or affine) it must beat, then folds in the regional-grid
 * verdict: coherent leftover motion in two or more DISTINCT regions is
 * reported as "field" regardless of whether a single richer transform
 * also happened to pass its own gate, since at that point one transform
 * is the wrong shape of answer.
 */
function selectDiagnosticModel(
    cv: OpenCv,
    correspondences: Correspondence[],
    translationInlierRatio: number,
    translationResidualError: number,
    coherentRegionCount: number
): GlobalMotion["model"] {
    if (coherentRegionCount >= FIELD_MIN_COHERENT_REGIONS) return "field";

    let model: GlobalMotion["model"] = "translation";
    let bestInlierRatio = translationInlierRatio;
    let bestResidualError = translationResidualError;

    const affineFit = fitAffineRansac(cv, correspondences);
    if (affineFit) {
        const affineInliers = correspondences.filter((_, i) => affineFit.inlierMask[i] !== 0);
        if (affineInliers.length >= MIN_INLIERS) {
            const affineInlierRatio = affineInliers.length / correspondences.length;
            const affineResiduals = correspondences
                .map((c) => residualOfAffine(c, affineFit.matrix))
                .filter((_, i) => affineFit.inlierMask[i] !== 0);
            const affineResidualError = mean(affineResiduals.map((r) => Math.hypot(r.dx, r.dy)));

            if (isMeaningfullyBetterFit(translationInlierRatio, translationResidualError, affineInlierRatio, affineResidualError, AFFINE_MIN_GAIN, AFFINE_MAX_RESIDUAL_FRACTION)) {
                model = "affine";
                bestInlierRatio = affineInlierRatio;
                bestResidualError = affineResidualError;
            }
        }
    }

    const homographyFit = fitHomographyRansac(cv, correspondences);
    if (homographyFit) {
        const homographyInliers = correspondences.filter((_, i) => homographyFit.inlierMask[i] !== 0);
        if (homographyInliers.length >= MIN_INLIERS) {
            const homographyInlierRatio = homographyInliers.length / correspondences.length;
            const homographyResiduals = correspondences
                .map((c) => residualOfHomography(c, homographyFit.matrix))
                .filter((_, i) => homographyFit.inlierMask[i] !== 0);
            const homographyResidualError = mean(homographyResiduals.map((r) => Math.hypot(r.dx, r.dy)));

            if (
                isMeaningfullyBetterFit(bestInlierRatio, bestResidualError, homographyInlierRatio, homographyResidualError, HOMOGRAPHY_MIN_GAIN, HOMOGRAPHY_MAX_RESIDUAL_FRACTION)
            ) {
                model = "homography";
            }
        }
    }

    return model;
}
