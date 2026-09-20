import type { OpenCv, CvMat } from "./BlobDetector";

/** Actual runtime shape of cv.minMaxLoc's return value — see the call site for why this isn't taken from the vendored types. */
interface MinMaxLocResult {
    minVal: number;
    maxVal: number;
    minLoc: { x: number; y: number };
    maxLoc: { x: number; y: number };
}

/**
 * This frame's estimate of global (camera) translation between two
 * grayscale frames, in analysis-resolution pixels. `confidence` (0..1)
 * reflects both how much of the frame's grid actually agrees on this
 * displacement and how good those matches are — see estimateGlobalMotion.
 * `valid` is the actual go/no-go signal consumers should check: a low
 * confidence should mean "don't compensate", not "compensate a little".
 */
export interface GlobalMotion {
    dx: number;
    dy: number;
    confidence: number;
    valid: boolean;
}

export const NO_GLOBAL_MOTION: GlobalMotion = { dx: 0, dy: 0, confidence: 0, valid: false };

// --- Tuning constants -------------------------------------------------
// Not exposed as UI sliders (see AnalysisControls) — these shape the
// internal block-matching search, not something a user tunes per video,
// same spirit as e.g. TrackReidentifier.REIDENTIFY_THRESHOLD.

/** Grid of sample patches spread across the frame — enough spatial coverage to distinguish "most of the frame agrees" from "a few coincidentally-aligned patches", without the cost of matching every pixel. */
const GRID_COLS = 5;
const GRID_ROWS = 4;
/** Patch (template) side length, in analysis-resolution px. */
const PATCH_SIZE = 24;
/** Max displacement, in px each direction, the search window allows a patch to have moved — also the absolute cap on any reported dx/dy. */
const SEARCH_MARGIN = 14;
/** Fraction of the frame kept as a border where no patch is placed, so every patch's search window fits fully inside the frame without extra edge-of-frame bookkeeping. */
const EDGE_MARGIN_FRACTION = 0.08;
/** Minimum grayscale std-dev within a patch (0..255) for it to be usable as a match anchor — a flat, textureless patch (sky, an out-of-focus wall) matches almost anywhere similarly well and would otherwise contribute noise, not signal. */
const MIN_PATCH_TEXTURE = 6;
/** Minimum normalized cross-correlation (TM_CCOEFF_NORMED, -1..1) for a patch's best match to be trusted at all. */
const MIN_MATCH_SCORE = 0.6;
/** How close (px) a patch's displacement must be to the grid's median to count as "agreeing" with it. */
const AGREEMENT_RADIUS_PX = 2.5;
/** Minimum number of agreeing patches before an estimate is considered at all — a couple of lucky matches isn't evidence of camera motion. */
const MIN_AGREEING_PATCHES = 6;

/**
 * Estimates global (camera) translation between two grayscale frames via
 * grid-based block matching: sample a fixed grid of small, sufficiently
 * textured patches from `previous`, look for each one's best match in a
 * small window of `current` (matchTemplate + minMaxLoc), then take the
 * median displacement — robust to a minority of patches sitting on an
 * independently moving object, the same way BlobTracker's own
 * CameraMotionEstimator takes a median over track velocities rather than
 * a mean.
 *
 * Deliberately simple: a single rigid translation, not optical flow,
 * feature matching, or a homography — see the module doc in
 * BlobDetector.ts for why. It has no notion of *what* moved, only
 * whether enough of the frame's sampled points agree on one consistent
 * shift.
 *
 * `confidence` is fraction-of-grid-agreement × average match quality of
 * the agreeing patches — not just how many patches were sampled. This
 * matters because "most tracked objects moved the same way" is not
 * evidence of camera motion by itself (a flock, a crowd, several
 * independently panning blobs can all move together); what actually
 * distinguishes real camera motion is that a large, spatially-spread
 * *fraction of the whole visible frame* — not just a handful of
 * conveniently-agreeing sample points — supports the same shift. A scene
 * that's mostly independent motion, or too textureless to sample at all,
 * reports low confidence rather than a false positive.
 */
export function estimateGlobalMotion(
    cv: OpenCv,
    previous: CvMat,
    current: CvMat,
    width: number,
    height: number
): GlobalMotion {
    if (previous.rows !== current.rows || previous.cols !== current.cols) return NO_GLOBAL_MOTION;

    const marginX = Math.max(SEARCH_MARGIN + PATCH_SIZE / 2, Math.round(width * EDGE_MARGIN_FRACTION));
    const marginY = Math.max(SEARCH_MARGIN + PATCH_SIZE / 2, Math.round(height * EDGE_MARGIN_FRACTION));

    if (width - 2 * marginX < PATCH_SIZE || height - 2 * marginY < PATCH_SIZE) return NO_GLOBAL_MOTION;

    type Sample = { dx: number; dy: number; score: number };
    const samples: Sample[] = [];
    const totalCells = GRID_COLS * GRID_ROWS;

    const meanMat = new cv.Mat();
    const stddevMat = new cv.Mat();
    const result = new cv.Mat();

    try {
        for (let row = 0; row < GRID_ROWS; row++) {
            for (let col = 0; col < GRID_COLS; col++) {
                const cx = marginX + ((col + 0.5) * (width - 2 * marginX)) / GRID_COLS;
                const cy = marginY + ((row + 0.5) * (height - 2 * marginY)) / GRID_ROWS;

                const patchRect = new cv.Rect(
                    Math.round(cx - PATCH_SIZE / 2),
                    Math.round(cy - PATCH_SIZE / 2),
                    PATCH_SIZE,
                    PATCH_SIZE
                );
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
                // output-pointer params (minVal/maxVal/...) mirroring
                // OpenCV's native C++ signature; the actual JS/WASM
                // binding takes just the Mat (plus an optional mask) and
                // returns {minVal, maxVal, minLoc, maxLoc} — verified
                // against the runtime directly, not just the types.
                const { maxVal, maxLoc } = (cv.minMaxLoc as (src: CvMat) => MinMaxLocResult)(result);
                patch.delete();
                searchRegion.delete();

                if (maxVal < MIN_MATCH_SCORE) continue;

                samples.push({ dx: maxLoc.x - SEARCH_MARGIN, dy: maxLoc.y - SEARCH_MARGIN, score: maxVal });
            }
        }
    } finally {
        meanMat.delete();
        stddevMat.delete();
        result.delete();
    }

    if (samples.length < MIN_AGREEING_PATCHES) return NO_GLOBAL_MOTION;

    const medianDx = median(samples.map((s) => s.dx));
    const medianDy = median(samples.map((s) => s.dy));

    const agreeing = samples.filter((s) => Math.hypot(s.dx - medianDx, s.dy - medianDy) <= AGREEMENT_RADIUS_PX);
    if (agreeing.length < MIN_AGREEING_PATCHES) return NO_GLOBAL_MOTION;

    const fractionOfFrame = agreeing.length / totalCells;
    const avgScore = agreeing.reduce((sum, s) => sum + s.score, 0) / agreeing.length;
    const confidence = fractionOfFrame * avgScore;

    return {
        dx: medianDx,
        dy: medianDy,
        confidence,
        valid: confidence >= 0.5
    };
}

/**
 * Warps `src` by a pure translation (dx, dy) so its content lines up
 * with a frame taken `1` step later under that motion — used to align a
 * previous frame to the current one before diffing, so the diff reflects
 * local motion against the (now-matching) background rather than the
 * camera's own translation. Edge pixels revealed by the shift are
 * replicated rather than left black (BORDER_REPLICATE) — plain zero-fill
 * would otherwise read as a big fake "changed" strip along whichever
 * edge the pan revealed, exactly the kind of spurious motion this
 * exists to remove. Caller owns deleting the returned Mat.
 */
export function compensateGlobalMotion(cv: OpenCv, src: CvMat, motion: GlobalMotion): CvMat {
    const dst = new cv.Mat();
    const M = cv.matFromArray(2, 3, cv.CV_64FC1, [1, 0, motion.dx, 0, 1, motion.dy]);
    try {
        cv.warpAffine(src, dst, M, new cv.Size(src.cols, src.rows), cv.INTER_LINEAR, cv.BORDER_REPLICATE);
    } finally {
        M.delete();
    }
    return dst;
}

function median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
