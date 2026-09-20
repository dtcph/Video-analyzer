import type { MotionCandidate } from "./MotionCandidate";

/** Why a candidate was rejected — surfaced in DetectorDebugInfo.rejectedCandidates, never in production BlobData. */
export type RejectionReason = "insufficient-persistence" | "edge-like" | "incoherent-direction" | "large-unstable-region";

export interface CandidateFilterResult {
    accepted: MotionCandidate[];
    rejected: { candidate: MotionCandidate; reason: RejectionReason }[];
}

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

export function filterCandidates(candidates: MotionCandidate[], frameArea: number): CandidateFilterResult {
    const accepted: MotionCandidate[] = [];
    const rejected: { candidate: MotionCandidate; reason: RejectionReason }[] = [];

    for (const candidate of candidates) {
        const reason = rejectionReason(candidate, frameArea);
        if (reason) rejected.push({ candidate, reason });
        else accepted.push(candidate);
    }

    return { accepted, rejected };
}

function rejectionReason(candidate: MotionCandidate, frameArea: number): RejectionReason | null {
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

    return null;
}
