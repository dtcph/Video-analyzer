import type { OpenCv, CvMat } from "./BlobDetector";
import type { MotionCandidate, MotionPath } from "./MotionCandidate";
import type { GlobalMotion, RegionalMotionCell } from "./GlobalMotionEstimator";

/** Cap on how far MOTION_LAYER_DISPERSION_CAP-normalized dispersion can drive spatialCoherence down to 0 — a cell's dispersion is unbounded in principle (a totally scattered cell has no natural upper limit), so this defines what "no coherence at all" means in practice rather than letting one wild outlier cell divide by an arbitrarily large number. */
const MOTION_LAYER_DISPERSION_CAP_PX = 6;
/** How many samples a regional cell needs before motionLayerConfidence treats it as fully trustworthy (saturates at 1) — below this, confidence scales down linearly even for a tightly-agreeing cell, since a handful of correspondences agreeing could still be coincidence. */
const MOTION_LAYER_SAMPLE_TARGET = 8;

/**
 * Extracts connected-region measurements from a binary motion mask —
 * the same `findContours` step BlobDetector always ran, but reporting a
 * full MotionCandidate (density, magnitude, shape, provenance) instead
 * of going straight to a bounding-box blob. Reads `diff` (the raw
 * frame-difference magnitude, pre-threshold) purely to measure how
 * strong each region's motion actually was — the binary mask alone only
 * says "changed" or "didn't", not by how much.
 *
 * `minAreaFraction`/`maxAreaFraction` are normalized (fraction of total
 * frame area), same convention as AnalysisSettings.min/maxBlobArea —
 * this is where each detection path's own size window is applied, not a
 * hardcoded constant.
 */
export function extractCandidates(
    cv: OpenCv,
    binary: CvMat,
    diff: CvMat,
    width: number,
    height: number,
    path: MotionPath,
    minAreaFraction: number,
    maxAreaFraction: number
): MotionCandidate[] {
    const frameArea = width * height;
    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    const candidates: MotionCandidate[] = [];

    try {
        cv.findContours(binary, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

        for (let i = 0; i < contours.size(); i++) {
            const contour = contours.get(i);
            const area = cv.contourArea(contour);
            const normalizedArea = area / frameArea;

            if (normalizedArea < minAreaFraction || normalizedArea > maxAreaFraction) {
                contour.delete();
                continue;
            }

            const rect = cv.boundingRect(contour);
            const perimeter = cv.arcLength(contour, true);
            contour.delete();

            const bboxArea = Math.max(1, rect.width * rect.height);
            const compactness = perimeter > 0 ? (4 * Math.PI * area) / (perimeter * perimeter) : 0;
            const elongation = Math.max(rect.width, rect.height) / Math.max(1, Math.min(rect.width, rect.height));

            const { motionPixelCount, meanMagnitude, medianMagnitude } = measureMotion(binary, diff, rect);

            candidates.push({
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
                centerX: rect.x + rect.width / 2,
                centerY: rect.y + rect.height / 2,
                area,
                motionPixelCount,
                motionDensity: motionPixelCount / bboxArea,
                meanMagnitude,
                medianMagnitude,
                compactness,
                elongation,
                // Filled in by MotionPersistenceTracker; a brand-new,
                // never-matched candidate starts at persistence 1 with
                // no displacement history.
                persistence: 1,
                displacementX: null,
                displacementY: null,
                directionConsistency: 0.5,
                path
            });
        }
    } finally {
        contours.delete();
        hierarchy.delete();
    }

    return candidates;
}

/**
 * Drops any small-path candidate whose centroid falls inside a
 * normal-path candidate's bounding box — the normal path already found
 * that region (typically the small path just carves out a sub-piece of
 * the same connected motion under its lower threshold), so keeping both
 * would double-detect one object. A small-path candidate that ISN'T
 * covered by anything the normal path found is exactly the "small
 * object the normal path's own minimum area missed" case the small path
 * exists for.
 */
export function dedupeSmallPathCoveredByNormal(normal: MotionCandidate[], small: MotionCandidate[]): MotionCandidate[] {
    return small.filter(
        (s) =>
            !normal.some(
                (n) => s.centerX >= n.x && s.centerX <= n.x + n.width && s.centerY >= n.y && s.centerY <= n.y + n.height
            )
    );
}

/**
 * Attaches scene-motion context (see MotionCandidate's own doc) to each
 * candidate from whichever GlobalMotion estimate this frame produced —
 * legacy or motion-field, the lookup is identical since both report the
 * same shape (see GlobalMotion.gridRows/gridCols). A no-op (candidates
 * returned unchanged) when `globalMotion` isn't valid, since an invalid
 * estimate's regional grid isn't meaningful to attach to anything.
 */
export function enrichWithSceneMotion(candidates: MotionCandidate[], globalMotion: GlobalMotion, width: number, height: number): MotionCandidate[] {
    if (!globalMotion.valid) return candidates;

    return candidates.map((candidate) => {
        const cell = regionalCellFor(candidate.centerX, candidate.centerY, globalMotion, width, height);
        if (!cell || !cell.coherent) {
            return { ...candidate, localMotionResidual: 0, sceneMotionConfidence: globalMotion.confidence, motionLayerConfidence: 0, spatialCoherence: 0 };
        }

        const spatialCoherence = Math.max(0, 1 - cell.dispersion / MOTION_LAYER_DISPERSION_CAP_PX);
        const sampleWeight = Math.min(1, cell.sampleCount / MOTION_LAYER_SAMPLE_TARGET);

        return {
            ...candidate,
            localMotionResidual: Math.hypot(cell.dx, cell.dy),
            sceneMotionConfidence: globalMotion.confidence,
            motionLayerConfidence: spatialCoherence * sampleWeight,
            spatialCoherence
        };
    });
}

function regionalCellFor(centerX: number, centerY: number, globalMotion: GlobalMotion, width: number, height: number): RegionalMotionCell | undefined {
    const { gridRows, gridCols } = globalMotion;
    const col = Math.min(gridCols - 1, Math.floor((centerX / width) * gridCols));
    const row = Math.min(gridRows - 1, Math.floor((centerY / height) * gridRows));
    return globalMotion.regionalMotion.find((cell) => cell.row === row && cell.col === col);
}

/**
 * Reads the bounding-box region of `binary`/`diff` pixel by pixel via
 * `ucharPtr` to measure the actual motion pixels within it — cheap
 * since candidate boxes are small relative to the frame.
 *
 * Deliberately NOT `.roi(rect).data` (even via `.clone()` first): that
 * combination was verified, directly, to silently return wrong pixel
 * values for a real thresholded Mat here — a candidate's own
 * `motionPixelCount` came back far lower than its visibly-solid region
 * implied, while `ucharPtr` reads of the exact same pixels were
 * correct. `ucharPtr` addresses through OpenCV's own row/step logic
 * rather than a flat buffer read, so it doesn't depend on assumptions
 * about a Mat's internal memory layout that don't always hold.
 */
function measureMotion(
    binary: CvMat,
    diff: CvMat,
    rect: { x: number; y: number; width: number; height: number }
): { motionPixelCount: number; meanMagnitude: number; medianMagnitude: number } {
    let motionPixelCount = 0;
    let magSum = 0;
    const magnitudes: number[] = [];

    for (let yy = rect.y; yy < rect.y + rect.height; yy++) {
        for (let xx = rect.x; xx < rect.x + rect.width; xx++) {
            if (binary.ucharPtr(yy, xx)[0] === 0) continue;
            const magnitude = diff.ucharPtr(yy, xx)[0];
            motionPixelCount++;
            magSum += magnitude;
            magnitudes.push(magnitude);
        }
    }

    magnitudes.sort((a, b) => a - b);
    const medianMagnitude = magnitudes.length > 0 ? magnitudes[Math.floor(magnitudes.length / 2)] : 0;
    const meanMagnitude = motionPixelCount > 0 ? magSum / motionPixelCount : 0;

    return { motionPixelCount, meanMagnitude, medianMagnitude };
}
