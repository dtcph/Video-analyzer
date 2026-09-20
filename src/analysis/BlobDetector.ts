import type { CV } from "@techstark/opencv-js";
import type { BlobData } from "../tracking/TrackTypes";
import type { AnalysisSettings, DetectorDebugInfo, MotionCandidateDebug } from "./AnalysisTypes";
import { estimateGlobalMotion, compensateGlobalMotion, NO_GLOBAL_MOTION } from "./GlobalMotionEstimator";
import type { GlobalMotion } from "./GlobalMotionEstimator";
import { estimateMotionField } from "./SceneMotionEstimator";
import { extractCandidates, dedupeSmallPathCoveredByNormal, enrichWithSceneMotion } from "./MotionCandidateExtractor";
import { MotionPersistenceTracker } from "./MotionPersistenceTracker";
import { filterCandidates } from "./MotionCandidateFilter";
import type { MotionCandidate } from "./MotionCandidate";

export type OpenCv = CV & { onRuntimeInitialized?: () => void; Mat?: unknown };
export type CvMat = ReturnType<OpenCv["matFromImageData"]>;

/** Threshold multiplier for the small-object path relative to the normal path's own AnalysisSettings.threshold — lower, since it exists specifically to catch subtler motion the normal path's threshold would miss. */
const SMALL_PATH_THRESHOLD_FACTOR = 0.75;
/** Small-path minimum area, as a fraction of the normal path's own minBlobArea — the small path only needs to cover the gap below the normal path's floor; anything at or above minBlobArea is already the normal path's territory (and any small-path detection there gets deduped away — see dedupeSmallPathCoveredByNormal). */
const SMALL_PATH_MIN_AREA_FACTOR = 0.15;

/** Result of BlobDetector.detect() — blobs plus, only when requested, the pipeline internals behind them. See AnalysisSettings.detectorDebugEnabled. */
export interface DetectionResult {
    blobs: BlobData[];
    debug?: DetectorDebugInfo;
}

/**
 * Lazily imports @techstark/opencv-js and resolves once its WASM
 * runtime is ready. The package's default export is either a Promise
 * (module already invoked) or a Module object awaiting
 * onRuntimeInitialized, depending on how the runtime happened to load
 * — see the package README for this exact pattern.
 */
async function loadCv(): Promise<OpenCv> {
    const imported = (await import("@techstark/opencv-js")) as unknown as { default: unknown };
    const candidate = imported.default;

    if (candidate && typeof (candidate as Promise<unknown>).then === "function") {
        return (await candidate) as OpenCv;
    }

    const cv = candidate as OpenCv;
    if (cv.Mat) return cv;

    return new Promise((resolve) => {
        cv.onRuntimeInitialized = () => resolve(cv);
    });
}

/**
 * Detects blobs via OpenCV.js: grayscale -> optional blur -> absolute
 * difference against the previous analyzed frame -> threshold ->
 * morphology -> findContours -> bounding rects.
 *
 * The detection signal is frame-to-frame motion, not raw brightness.
 * An earlier version thresholded raw grayscale intensity directly,
 * which finds any region above/below a fixed brightness cutoff
 * regardless of whether it's moving — on real footage this means
 * static high/low-luminance background (sky, shadows, a light wall)
 * reliably produces "blobs" while an actual moving foreground object
 * that isn't conveniently the brightest/darkest thing in frame never
 * does. For a tool whose whole point is motion-tracking data, that's
 * backwards: with a static camera, only content that actually changes
 * between frames should surface as a blob at all.
 *
 * Camera motion is compensated before diffing (see GlobalMotionEstimator /
 * SceneMotionEstimator, chosen by AnalysisSettings.cameraMotionMode)
 * rather than left entirely to the tracking layer: without it, a pan
 * makes the whole frame read as "motion", which is exactly the failure
 * this detector exists to avoid. Compensation is a robust TRANSLATION
 * only (not a full affine/homography — see GlobalMotionEstimator's module
 * doc for why an unconstrained richer model was tried and rejected for
 * this purpose), applied only when the estimate's own confidence says
 * it's trustworthy (AnalysisSettings.cameraCompensationEnabled gates
 * whether it's attempted at all) — an uncertain or wrong global-motion
 * guess is worse than none, so the fallback on low confidence is the
 * plain uncompensated diff. This is unrelated to, and doesn't replace,
 * BlobTracker's own CameraMotionEstimator downstream, which works from
 * already-tracked blob velocities for a different purpose (predicting
 * where a track should be next) — this one exists purely to keep
 * detection itself spatially meaningful.
 *
 * `cameraMotionMode` picks WHICH estimator produces this frame's
 * GlobalMotion: "legacy" is the original grid-based block-matching
 * translation, "motion-field" is a sparse-optical-flow based estimator
 * (SparseMotionEstimator + SceneMotionEstimator) built specifically for
 * real 3D camera translation through a scene with depth — a drone, or a
 * camera moving through traffic — where near/mid/far content shifts by
 * different amounts and a single global translation (even with the
 * legacy path's coarse 2x2 residual check) reads most of the frame as
 * "moving". Both report the exact same GlobalMotion shape, so this
 * branch is the only place that changes — everything downstream
 * (compensation, the parallax-aware candidate gate, the debug HUD) is
 * identical either way. See SceneMotionEstimator's module doc for the
 * full reasoning and scripts/detectorScenarios.ts for scenarios covering
 * both.
 *
 * Real 3D camera translation (a drone moving forward, a vehicle-mounted
 * camera moving through a street) breaks the "one global translation"
 * assumption via parallax: near and far scene content shift by different
 * amounts for the same camera motion, so no single 2D transform is
 * exactly right everywhere. Rather than chase this with a richer pixel-
 * level warp (dense optical flow, or per-region re-warping — both
 * explicitly avoided as excessive for a real-time browser pipeline), the
 * SAME sparse correspondences already gathered for the global fit are
 * also bucketed into a coarse 2x2 spatial grid to check whether one part
 * of the frame has a coherent leftover motion the global translation
 * doesn't explain (GlobalMotion.parallaxDetected/regionalMotion). When
 * that's true, MotionCandidateFilter gets this as extra context: a
 * candidate whose own measured displacement matches its quadrant's
 * uncompensated residual gets rejected as background/parallax residue
 * rather than an independent object, on the same "measurable properties,
 * not hardcoded assumptions" principle as its other gates.
 *
 * Beyond the threshold mask, every connected region is measured as a
 * MotionCandidate (density, shape, and — via MotionPersistenceTracker —
 * how long it's persisted and how consistent its direction has been)
 * and only the candidates MotionCandidateFilter actually accepts become
 * a BlobData the tracker sees at all. This is what keeps a single stray
 * frame of compression noise, a flickering camera-compensation edge,
 * wind-shaken foliage, or (per the parallax gate above) an unexplained
 * camera-motion residual from becoming a blob just because it crossed the
 * motion threshold once — see MotionCandidateFilter's module doc for the
 * actual gates. It's also why there are two detection passes
 * (AnalysisSettings.smallObjectDetectionEnabled): a small, distant
 * object needs a lower area floor than a global lowering of
 * minBlobArea would allow without flooding the normal path with noise,
 * so it gets a second, more sensitive pass held to *stricter*
 * persistence/direction requirements instead.
 *
 * A blob is a detected region only, not a classified object — semantic
 * labeling happens later, on tracks, not here.
 */
export class BlobDetector {
    private cv: OpenCv | null = null;
    private loading: Promise<OpenCv> | null = null;
    /** Grayscale (post-blur) of the previously analyzed frame, kept purely to compute this frame's motion diff — see reset(). */
    private prevGray: CvMat | null = null;
    /** Detection-level temporal filter shared across both detection paths — see MotionPersistenceTracker's module doc for why this is not a duplicate of Track/TrackManager. */
    private readonly persistenceTracker = new MotionPersistenceTracker();

    isReady(): boolean {
        return this.cv !== null;
    }

    /** Drops the remembered previous frame and all persistence history — call when starting a new video, since neither has anything to do with motion in this one. */
    reset(): void {
        this.prevGray?.delete();
        this.prevGray = null;
        this.persistenceTracker.reset();
    }

    private ensureReady(): Promise<OpenCv> {
        if (this.cv) return Promise.resolve(this.cv);
        if (!this.loading) {
            this.loading = loadCv().then((cv) => {
                this.cv = cv;
                return cv;
            });
        }
        return this.loading;
    }

    async detect(imageData: ImageData, settings: AnalysisSettings): Promise<DetectionResult> {
        const cv = await this.ensureReady();
        return this.detectBlobs(cv, imageData, settings);
    }

    private detectBlobs(cv: OpenCv, imageData: ImageData, settings: AnalysisSettings): DetectionResult {
        const { width, height } = imageData;
        const frameArea = width * height;

        const src = cv.matFromImageData(imageData);
        const gray = new cv.Mat();
        const diff = new cv.Mat();
        const normalBinary = new cv.Mat();
        const smallBinary = new cv.Mat();
        let compensated: CvMat | null = null;
        let rawDiffForDebug: CvMat | null = null;

        try {
            cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

            if (settings.blurRadius > 0) {
                const kernelSize = 2 * Math.round(settings.blurRadius) + 1;
                cv.GaussianBlur(gray, gray, new cv.Size(kernelSize, kernelSize), 0);
            }

            // No previous frame yet (first frame of this video, or the
            // analysis resolution just changed) — there's nothing to
            // diff against, so there's no motion signal to report. Still
            // remember this frame for next time.
            const previous = this.prevGray;
            const hasPrevFrame = previous !== null && previous.rows === gray.rows && previous.cols === gray.cols;

            if (!previous || !hasPrevFrame) {
                previous?.delete();
                this.prevGray = gray.clone();
                return { blobs: [] };
            }

            const globalMotion: GlobalMotion = settings.cameraCompensationEnabled
                ? settings.cameraMotionMode === "motion-field"
                    ? estimateMotionField(cv, previous, gray, width, height, settings.detectorDebugEnabled)
                    : estimateGlobalMotion(cv, previous, gray, width, height, settings.detectorDebugEnabled)
                : NO_GLOBAL_MOTION;

            let diffSource: CvMat = previous;
            if (globalMotion.valid) {
                compensated = compensateGlobalMotion(cv, previous, globalMotion);
                diffSource = compensated;
            }

            // The debug view wants to show the *uncompensated* diff even
            // when compensation is active, so the effect of compensation
            // is actually visible side by side rather than only ever
            // seeing whichever one was used.
            if (settings.detectorDebugEnabled && compensated) {
                rawDiffForDebug = new cv.Mat();
                cv.absdiff(gray, previous, rawDiffForDebug);
            }

            cv.absdiff(gray, diffSource, diff);
            previous.delete();
            this.prevGray = gray.clone();

            // Normal path: today's threshold/morphology/area settings,
            // unchanged — this is the "stable medium/large motion" pass.
            applyThresholdAndMorphology(cv, diff, normalBinary, settings.threshold, settings.morphologyStrength);
            const normalCandidates = extractCandidates(
                cv,
                normalBinary,
                diff,
                width,
                height,
                "normal",
                settings.minBlobArea,
                settings.maxBlobArea
            );

            // Small-object path: lower threshold, no morphology (an
            // erosion-based open reliably erases exactly the thin/small
            // regions this path exists to keep), and an area floor set
            // relative to the normal path's own floor rather than a
            // fixed constant, so it scales if the user retunes minBlobArea.
            // Only candidates MotionCandidateFilter's stricter small-path
            // gates accept ever reach the tracker — this path being more
            // sensitive is exactly why it demands more evidence, not less.
            let smallCandidates: MotionCandidate[] = [];
            if (settings.smallObjectDetectionEnabled) {
                applyThresholdAndMorphology(cv, diff, smallBinary, settings.threshold * SMALL_PATH_THRESHOLD_FACTOR, 0);
                smallCandidates = extractCandidates(
                    cv,
                    smallBinary,
                    diff,
                    width,
                    height,
                    "small",
                    settings.minBlobArea * SMALL_PATH_MIN_AREA_FACTOR,
                    settings.minBlobArea
                );
                smallCandidates = dedupeSmallPathCoveredByNormal(normalCandidates, smallCandidates);
            }

            const persistedCandidates = this.persistenceTracker.update([...normalCandidates, ...smallCandidates]);
            const allCandidates = enrichWithSceneMotion(persistedCandidates, globalMotion, width, height);
            const { accepted, rejected } = filterCandidates(allCandidates, frameArea, { globalMotion, width, height });

            const blobs = accepted.map((candidate, index) => toBlobData(candidate, index + 1, width, height));

            const debug: DetectorDebugInfo | undefined = settings.detectorDebugEnabled
                ? {
                      globalMotion,
                      rawDiff: new Uint8Array((rawDiffForDebug ?? diff).data),
                      compensatedDiff: new Uint8Array(diff.data),
                      motionMask: new Uint8Array(normalBinary.data),
                      width,
                      height,
                      acceptedCandidates: accepted.map((c) => toCandidateDebug(c, width, height)),
                      rejectedCandidates: rejected.map(({ candidate, reason }) => toCandidateDebug(candidate, width, height, reason))
                  }
                : undefined;

            return { blobs, debug };
        } finally {
            src.delete();
            gray.delete();
            diff.delete();
            normalBinary.delete();
            smallBinary.delete();
            compensated?.delete();
            rawDiffForDebug?.delete();
        }
    }
}

/** Thresholds `diff` into `dst` and optionally applies a morphological open — shared by both detection paths, each with their own threshold/morphology strength. */
function applyThresholdAndMorphology(cv: OpenCv, diff: CvMat, dst: CvMat, thresholdFraction: number, morphologyStrength: number): void {
    cv.threshold(diff, dst, thresholdFraction * 255, 255, cv.THRESH_BINARY);
    if (morphologyStrength > 0) {
        const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
        cv.morphologyEx(dst, dst, cv.MORPH_OPEN, kernel, new cv.Point(-1, -1), Math.round(morphologyStrength));
        kernel.delete();
    }
}

function toBlobData(candidate: MotionCandidate, id: number, width: number, height: number): BlobData {
    return {
        id,
        x: candidate.x / width,
        y: candidate.y / height,
        width: candidate.width / width,
        height: candidate.height / height,
        centerX: candidate.centerX / width,
        centerY: candidate.centerY / height,
        area: candidate.area,
        persistence: candidate.persistence,
        motionDx: candidate.displacementX !== null ? candidate.displacementX / width : undefined,
        motionDy: candidate.displacementY !== null ? candidate.displacementY / height : undefined
    };
}

function toCandidateDebug(candidate: MotionCandidate, width: number, height: number, reason?: string): MotionCandidateDebug {
    return {
        x: candidate.x / width,
        y: candidate.y / height,
        width: candidate.width / width,
        height: candidate.height / height,
        persistence: candidate.persistence,
        directionConsistency: candidate.directionConsistency,
        motionDx: candidate.displacementX !== null ? candidate.displacementX / width : undefined,
        motionDy: candidate.displacementY !== null ? candidate.displacementY / height : undefined,
        path: candidate.path,
        reason
    };
}
