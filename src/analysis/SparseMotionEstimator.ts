import type { OpenCv, CvMat } from "./BlobDetector";

/** Runtime shape of a KeyPointVector's elements — see selectSpreadFeatures for why FastFeatureDetector/KeyPointVector are accessed via a narrow runtime cast rather than typed on OpenCv directly. */
interface FastKeyPointVector {
    size(): number;
    get(i: number): { pt: { x: number; y: number }; response: number };
    delete(): void;
}

/**
 * One tracked feature's observed image-space motion between two
 * consecutive analyzed frames, in analysis-resolution pixels.
 * `confidence` (0..1) is derived from calcOpticalFlowPyrLK's own tracking
 * error (`err`) — a well-matched feature (small appearance change between
 * its two positions) gets a high confidence, a barely-tracked one (near
 * an occlusion boundary, in a featureless region the pyramid had to
 * guess through) gets a low one. This is a per-point quality signal, not
 * a statement about whether the point sits on the background or an
 * object — that judgment is SceneMotionEstimator's job, one level up.
 */
export interface MotionVector {
    x: number;
    y: number;
    dx: number;
    dy: number;
    magnitude: number;
    confidence: number;
}

/**
 * The full sparse motion measurement for one frame pair — every
 * successfully tracked feature, plus frame-level summary statistics
 * (median flow, magnitude distribution) useful both for the scene-motion
 * fit downstream and for the debug HUD (see AnalysisOverlay).
 */
export interface MotionField {
    vectors: MotionVector[];
    /** How many features goodFeaturesToTrack found in the previous frame — the denominator behind validCount, and itself informative (a near-featureless frame, e.g. a blank wall or heavy fog, starves every downstream estimate). */
    featureCount: number;
    /** How many of those features calcOpticalFlowPyrLK tracked successfully into a MotionVector (status === 1 and error under MAX_TRACK_ERROR) — see MotionVector.confidence for how well, not just whether. */
    validCount: number;
    medianDx: number;
    medianDy: number;
    flowMagnitudeMedian: number;
    flowMagnitudeP90: number;
}

export const EMPTY_MOTION_FIELD: MotionField = {
    vectors: [],
    featureCount: 0,
    validCount: 0,
    medianDx: 0,
    medianDy: 0,
    flowMagnitudeMedian: 0,
    flowMagnitudeP90: 0
};

// --- Tuning constants --------------------------------------------------
// Not exposed as UI sliders, same reasoning as GlobalMotionEstimator's own
// tuning constants — these shape the feature search/tracking itself, not
// something a user tunes per video.

/** Upper bound on tracked features — the spec's "100-300 strong features" range; more than this buys little extra robustness for a translation/affine/homography fit and costs real per-frame time. */
const MAX_CORNERS = 220;
/**
 * FAST's own corner-strength threshold (0..255, on the same intensity
 * scale as the grayscale frame) — not goodFeaturesToTrack's relative
 * qualityLevel, because this OpenCV.js build's video/imgproc_feature
 * module doesn't actually export goodFeaturesToTrack at runtime (verified
 * directly against the WASM build, not just the vendored .d.ts — see
 * this module's doc). FastFeatureDetector + a manual top-N/min-distance
 * reduction (see `selectSpreadFeatures`) is the available substitute:
 * conceptually the same "strong, spread-out corners" goal, just without
 * goodFeaturesToTrack's built-in Shi-Tomasi scoring and spacing.
 */
const FAST_THRESHOLD = 20;
/** Minimum pixel spacing enforced between the corners actually kept — see selectSpreadFeatures; without this, FAST's own output clusters heavily on any single strong edge/corner region and MAX_CORNERS gets spent there instead of spread across the frame. */
const MIN_DISTANCE = 8;
/** calcOpticalFlowPyrLK's per-level search window — large enough to follow faster motion (a nearby car, a fast pan) without needing more pyramid levels than MAX_LEVEL. */
const WIN_SIZE = 21;
/** Pyramid levels — each level halves resolution, roughly doubling the displacement calcOpticalFlowPyrLK can follow without losing the feature; 3 levels covers a substantial pan/translation at this analysis resolution (~960x540) without the cost of a deeper pyramid. */
const MAX_LEVEL = 3;
/** calcOpticalFlowPyrLK's own iteration/epsilon stopping criteria for its per-point Lucas-Kanade refinement. */
const LK_MAX_ITER = 30;
const LK_EPSILON = 0.01;
/** A tracked point with LK's own reported error above this is more likely a lost/occluded feature falsely reported as "found" than a real match — dropped rather than trusted with a low confidence, since LK's error scale isn't linearly comparable to a trustworthy 0..1 confidence below this point. */
const MAX_TRACK_ERROR = 24;

/**
 * Sparse optical flow between two consecutive grayscale analysis frames:
 * strong, spread-out corners are found in `previous` (see
 * `selectSpreadFeatures`), then `calcOpticalFlowPyrLK` (pyramidal
 * Lucas-Kanade) tracks each one into `current`. This is the motion-field
 * path's replacement for GlobalMotionEstimator's grid-based block
 * matching — the same kind of sparse correspondence-gathering, but
 * anchored to features the frame actually has (corners, edges, texture)
 * rather than a fixed grid of patches, and yielding roughly 10x more
 * correspondences (100-300 vs ~20) for the same rough per-frame cost,
 * which is what makes a finer regional grid (see SceneMotionEstimator)
 * actually meaningful rather than starved for samples per cell.
 *
 * Deliberately NOT dense optical flow (e.g. Farneback) — the spec this
 * was built against is explicit that dense flow's added cost isn't
 * justified unless profiling shows sparse flow insufficient, and at
 * ~960x540/12fps in a browser Web Worker, computing a few hundred
 * Lucas-Kanade tracks is a small fraction of the cost of a dense
 * per-pixel flow field.
 */
export function estimateSparseMotion(cv: OpenCv, previous: CvMat, current: CvMat, width: number, height: number): MotionField {
    if (previous.rows !== current.rows || previous.cols !== current.cols) return EMPTY_MOTION_FIELD;

    const prevPts = selectSpreadFeatures(cv, previous);
    const featureCount = prevPts.rows;
    if (featureCount === 0) {
        prevPts.delete();
        return EMPTY_MOTION_FIELD;
    }

    const nextPts = new cv.Mat();
    const status = new cv.Mat();
    const err = new cv.Mat();

    try {
        const criteria = new cv.TermCriteria(cv.TermCriteria_COUNT + cv.TermCriteria_EPS, LK_MAX_ITER, LK_EPSILON);
        cv.calcOpticalFlowPyrLK(
            previous,
            current,
            prevPts,
            nextPts,
            status,
            err,
            new cv.Size(WIN_SIZE, WIN_SIZE),
            MAX_LEVEL,
            criteria
        );

        const prevData = prevPts.data32F;
        const nextData = nextPts.data32F;
        const statusData = status.data as Uint8Array;
        const errData = err.data32F;

        const vectors: MotionVector[] = [];
        for (let i = 0; i < featureCount; i++) {
            if (statusData[i] === 0) continue;

            const trackError = errData[i];
            if (!Number.isFinite(trackError) || trackError > MAX_TRACK_ERROR) continue;

            const x = prevData[i * 2];
            const y = prevData[i * 2 + 1];
            const nx = nextData[i * 2];
            const ny = nextData[i * 2 + 1];
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;

            const dx = nx - x;
            const dy = ny - y;
            vectors.push({
                x,
                y,
                dx,
                dy,
                magnitude: Math.hypot(dx, dy),
                confidence: Math.max(0, 1 - trackError / MAX_TRACK_ERROR)
            });
        }

        if (vectors.length === 0) return { ...EMPTY_MOTION_FIELD, featureCount };

        const magnitudes = vectors.map((v) => v.magnitude).sort((a, b) => a - b);
        return {
            vectors,
            featureCount,
            validCount: vectors.length,
            medianDx: median(vectors.map((v) => v.dx)),
            medianDy: median(vectors.map((v) => v.dy)),
            flowMagnitudeMedian: percentile(magnitudes, 0.5),
            flowMagnitudeP90: percentile(magnitudes, 0.9)
        };
    } finally {
        prevPts.delete();
        nextPts.delete();
        status.delete();
        err.delete();
    }
}

/**
 * Finds strong, spatially spread-out corners in `image` — the local
 * substitute for `goodFeaturesToTrack`, which this OpenCV.js build
 * doesn't actually export at runtime (see this module's doc). Uses
 * `FastFeatureDetector` (available in this build) to find candidate
 * corners, then greedily keeps the strongest ones subject to
 * MIN_DISTANCE spacing from every corner already kept — FAST's own
 * output has no built-in spacing control and clusters heavily along any
 * single strong edge/corner region, which would otherwise spend most of
 * MAX_CORNERS on one small area instead of spreading them across the
 * frame (exactly what the regional/grid-based scene-motion fit
 * downstream needs to actually cover different depth layers). Returns a
 * `Nx1 CV_32FC2` Mat in the exact shape `calcOpticalFlowPyrLK` expects
 * for `prevPts` — caller owns deleting it.
 */
function selectSpreadFeatures(cv: OpenCv, image: CvMat): CvMat {
    // FastFeatureDetector/KeyPointVector exist at runtime (verified
    // directly against the WASM build) but aren't declared in the
    // vendored .d.ts at all — same category of gap as minMaxLoc
    // elsewhere in this codebase, worked around the same way (a narrow,
    // explicit runtime-shape cast at the call site rather than widening
    // OpenCv's type globally).
    const runtime = cv as unknown as {
        FastFeatureDetector: new () => { setThreshold(v: number): void; setNonmaxSuppression(v: boolean): void; detect(img: CvMat, kp: FastKeyPointVector): void; delete(): void };
        KeyPointVector: new () => FastKeyPointVector;
    };

    const detector = new runtime.FastFeatureDetector();
    detector.setThreshold(FAST_THRESHOLD);
    detector.setNonmaxSuppression(true);

    const keypoints = new runtime.KeyPointVector();
    const selected: { x: number; y: number }[] = [];

    try {
        detector.detect(image, keypoints);
        const count = keypoints.size();
        if (count === 0) return cv.matFromArray(0, 1, cv.CV_32FC2, []);

        const candidates: { x: number; y: number; response: number }[] = [];
        for (let i = 0; i < count; i++) {
            const kp = keypoints.get(i);
            candidates.push({ x: kp.pt.x, y: kp.pt.y, response: kp.response });
        }
        candidates.sort((a, b) => b.response - a.response);

        const minDistanceSq = MIN_DISTANCE * MIN_DISTANCE;
        for (const candidate of candidates) {
            if (selected.length >= MAX_CORNERS) break;
            const tooClose = selected.some((s) => (s.x - candidate.x) ** 2 + (s.y - candidate.y) ** 2 < minDistanceSq);
            if (!tooClose) selected.push(candidate);
        }
    } finally {
        keypoints.delete();
        detector.delete();
    }

    const flat = new Array<number>(selected.length * 2);
    for (let i = 0; i < selected.length; i++) {
        flat[i * 2] = selected[i].x;
        flat[i * 2 + 1] = selected[i].y;
    }
    return cv.matFromArray(selected.length, 1, cv.CV_32FC2, flat);
}

function median(values: number[]): number {
    return percentile([...values].sort((a, b) => a - b), 0.5);
}

function percentile(sortedValues: number[], p: number): number {
    if (sortedValues.length === 0) return 0;
    const index = Math.min(sortedValues.length - 1, Math.floor(p * sortedValues.length));
    return sortedValues[index];
}
