import type { MotionCandidate } from "./MotionCandidate";
import type { GlobalMotion, RegionalMotionCell } from "./GlobalMotionEstimator";

/** Why a candidate was rejected — surfaced in DetectorDebugInfo.rejectedCandidates, never in production BlobData. */
export type RejectionReason = "insufficient-persistence" | "edge-like" | "incoherent-direction" | "large-unstable-region" | "parallax-background";

export interface CandidateFilterResult {
    accepted: MotionCandidate[];
    rejected: { candidate: MotionCandidate; reason: RejectionReason }[];
}

/** Frame context needed for the parallax-aware gate — optional, since it only applies when the caller has a GlobalMotion estimate to check against (see BlobDetector). */
export interface ParallaxContext {
    globalMotion: GlobalMotion;
    width: number;
    height: number;
}

/**
 * How closely (px) a candidate's own recent displacement must match its
 * quadrant's leftover (post-global-compensation) residual motion to be
 * read as "this region is moving the way uncompensated background/
 * parallax residue moves here", not as its own independent motion.
 */
const PARALLAX_DISPLACEMENT_MATCH_PX = 2.5;
/** A coherent quadrant's mean residual must clear this magnitude (px) before it's treated as meaningful leftover motion worth explaining a candidate away with. */
const PARALLAX_MIN_RESIDUAL_PX = 2.0;

/**
 * Per-path acceptance thresholds — not exposed as UI sliders (see the
 * module doc in BlobDetector.ts for why): these are measurable-property
 * gates, not a knob a user tunes per video, same spirit as
 * TrackReidentifier.REIDENTIFY_THRESHOLD.
 *
 * None of this encodes "buildings are bad" or "grass is bad" — every
 * gate is a property any moving region has (how long it's persisted, how
 * densely it fills its own bounding box, how consistent its direction
 * has been, how large it is relative to the frame), which is what makes
 * it apply to real footage's actual failure modes (a residual
 * camera-compensation edge, wind-shaken foliage) without naming them.
 */
const NORMAL_PATH = {
    /** A region seen for only one frame is exactly what one-frame noise/compression artifacts look like — require at least a second consecutive appearance. */
    minPersistence: 2,
    /** A thin bounding box (elongation) that's also sparsely filled (low density) is the signature of an edge sliver, not a filled object silhouette — a real object that happens to be elongated (e.g. a walking person) still fills a decent fraction of its own box. */
    edgeElongationMin: 6,
    edgeDensityMax: 0.25,
    /** A region covering an implausibly large fraction of the frame is more likely a residual compensation artifact along a large structure than one real object — unless it's been persistently, coherently moving for a while, which a real large moving thing (e.g. a vehicle close to camera) would be. */
    largeAreaFraction: 0.15,
    largeMinPersistence: 4,
    largeMinDirectionConsistency: 0.5,
    /**
     * Once something has stuck around a while, a real object keeps
     * moving roughly one way; something that's persisted but whose
     * direction keeps flipping is more likely wind-shaken foliage
     * coincidentally reappearing near the same spot. 0.55 is chosen
     * from how directionConsistency actually behaves (verified in
     * scripts/detectorScenarios.ts), not guessed: genuinely random
     * frame-to-frame direction converges toward ~0.5 (uncorrelated
     * consecutive displacement vectors average to zero alignment,
     * i.e. neutral, not near-zero), while steady one-way motion
     * converges toward ~0.85+. The gate needs to sit between those two
     * observed clusters, not near either extreme.
     */
    persistentIncoherenceMinPersistence: 4,
    persistentIncoherenceMinDirection: 0.55
} as const;

/**
 * Stricter across the board, per the small path's whole purpose:
 * it's deliberately more sensitive (lower area floor, gentler
 * morphology — see BlobDetector), so it needs to demand more evidence
 * before trusting what it finds, or it would turn small-motion noise
 * into a stream of tiny blobs exactly as easily as it catches a small
 * distant person.
 */
const SMALL_PATH = {
    minPersistence: 4,
    edgeElongationMin: 5,
    edgeDensityMax: 0.3,
    persistentIncoherenceMinPersistence: 4,
    persistentIncoherenceMinDirection: 0.6
} as const;

export function filterCandidates(candidates: MotionCandidate[], frameArea: number, parallax?: ParallaxContext): CandidateFilterResult {
    const accepted: MotionCandidate[] = [];
    const rejected: { candidate: MotionCandidate; reason: RejectionReason }[] = [];

    for (const candidate of candidates) {
        const reason = rejectionReason(candidate, frameArea, parallax);
        if (reason) rejected.push({ candidate, reason });
        else accepted.push(candidate);
    }

    return { accepted, rejected };
}

function rejectionReason(candidate: MotionCandidate, frameArea: number, parallax?: ParallaxContext): RejectionReason | null {
    const config = candidate.path === "small" ? SMALL_PATH : NORMAL_PATH;

    if (candidate.persistence < config.minPersistence) return "insufficient-persistence";

    if (candidate.elongation >= config.edgeElongationMin && candidate.motionDensity <= config.edgeDensityMax) {
        return "edge-like";
    }

    if (
        candidate.persistence >= config.persistentIncoherenceMinPersistence &&
        candidate.directionConsistency < config.persistentIncoherenceMinDirection
    ) {
        return "incoherent-direction";
    }

    if ("largeAreaFraction" in config) {
        const normalizedArea = candidate.area / frameArea;
        if (
            normalizedArea > config.largeAreaFraction &&
            (candidate.persistence < config.largeMinPersistence || candidate.directionConsistency < config.largeMinDirectionConsistency)
        ) {
            return "large-unstable-region";
        }
    }

    if (parallax?.globalMotion.parallaxDetected && isParallaxBackgroundResidual(candidate, parallax)) {
        return "parallax-background";
    }

    return null;
}

/**
 * Only invoked when GlobalMotion.parallaxDetected is already true for
 * this frame (i.e. the global model has already been judged an
 * incomplete explanation somewhere in the frame — see
 * GlobalMotionEstimator's module doc). Rejects a candidate as background/
 * parallax residue, rather than an independent object, when its own
 * recent displacement matches its quadrant's leftover (post-global-
 * compensation) residual motion closely — i.e. it's moving the way
 * uncompensated depth-layer background moves here, not some other way.
 *
 * This is a direct measurement, not a shape heuristic: an earlier version
 * of this gate additionally required a spatially-extended/irregular shape
 * (low compactness or high elongation), reasoning that a real object's
 * silhouette should look different from "background residue". Synthetic
 * testing of a genuinely textured, richly-detailed background layer
 * shifting rigidly under incomplete compensation (see
 * scripts/detectorScenarios.ts's depth-layer scenarios) showed that
 * assumption doesn't hold: a textured region's frame-difference naturally
 * fragments into many small, locally COMPACT-looking blobs — the same
 * shape a small real object would have — so shape alone couldn't tell
 * them apart, and requiring it left exactly the kind of background flood
 * this gate exists to prevent. The displacement-match against the
 * region's own measured residual is intrinsically what distinguishes
 * background residue from an independent object: an object moving
 * differently from its local depth layer won't match, regardless of its
 * shape. The tradeoff (kept deliberately tight via
 * PARALLAX_DISPLACEMENT_MATCH_PX, and only engaged at all when this
 * frame's parallax has already been positively identified) is that a
 * real independent object which happens to be moving at very close to
 * the same velocity as its local uncompensated depth-layer residual could
 * be suppressed — an inherent ambiguity in any detection-only (pre-
 * semantic) approach, not a defect specific to this gate.
 */
function isParallaxBackgroundResidual(candidate: MotionCandidate, parallax: ParallaxContext): boolean {
    if (candidate.displacementX === null || candidate.displacementY === null) return false;

    const cell = regionalCellFor(candidate.centerX, candidate.centerY, parallax);
    if (!cell || !cell.coherent) return false;

    const residualMagnitude = Math.hypot(cell.dx, cell.dy);
    if (residualMagnitude < PARALLAX_MIN_RESIDUAL_PX) return false;

    return Math.hypot(candidate.displacementX - cell.dx, candidate.displacementY - cell.dy) <= PARALLAX_DISPLACEMENT_MATCH_PX;
}

function regionalCellFor(centerX: number, centerY: number, parallax: ParallaxContext): RegionalMotionCell | undefined {
    const gridSize = Math.sqrt(parallax.globalMotion.regionalMotion.length) || 1;
    const col = Math.min(gridSize - 1, Math.floor((centerX / parallax.width) * gridSize));
    const row = Math.min(gridSize - 1, Math.floor((centerY / parallax.height) * gridSize));
    return parallax.globalMotion.regionalMotion.find((cell) => cell.row === row && cell.col === col);
}
