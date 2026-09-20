import type { MotionCandidate } from "./MotionCandidate";

/**
 * How far (in units of the larger candidate's own size) a region may
 * have moved between frames and still count as "the same" region for
 * persistence purposes — generous enough to follow a genuinely moving
 * object frame to frame, tight enough that two unrelated nearby regions
 * don't get chained together.
 */
const MATCH_RADIUS_FACTOR = 1.2;

/** Smoothing applied to directionConsistency on a successful match — recent alignment matters more than old, but a single misaligned frame shouldn't erase a long steady run. */
const DIRECTION_SMOOTHING = 0.4;
/** How much directionConsistency decays on a match with negligible displacement (the region matched, but neither the old nor new position implies a direction) — prevents a stationary-but-persistent region from being stuck at whatever consistency score it last earned while genuinely moving. */
const STALL_DECAY = 0.8;

interface PersistedState {
    x: number;
    y: number;
    width: number;
    height: number;
    persistence: number;
    displacementX: number;
    displacementY: number;
    directionConsistency: number;
}

/**
 * Lightweight, detection-level temporal filter — NOT a duplicate of
 * Track/TrackManager. It runs on raw MotionCandidates before any of them
 * become a BlobData the tracker ever sees, has no lifecycle states, no
 * ids, no reidentification, and keeps only the immediately-previous
 * frame's state (a single-hop greedy nearest-match, not global
 * assignment) — its only job is "has a spatially coherent region been
 * here for a few frames, and has it been moving consistently", which is
 * exactly the signal one-frame noise, compression artifacts, and
 * flickering camera-compensation edges lack. See MotionCandidateFilter
 * for how persistence/directionConsistency actually gate acceptance.
 */
export class MotionPersistenceTracker {
    private previous: PersistedState[] = [];

    /** Drops all history — call when starting a new video, same reason as BlobDetector.reset(). */
    reset(): void {
        this.previous = [];
    }

    update(candidates: MotionCandidate[]): MotionCandidate[] {
        const claimed = new Set<number>();
        const result: MotionCandidate[] = [];

        for (const candidate of candidates) {
            const matchIndex = this.findBestMatch(candidate, claimed);

            if (matchIndex === -1) {
                result.push({ ...candidate, persistence: 1, displacementX: null, displacementY: null, directionConsistency: 0.5 });
                continue;
            }

            claimed.add(matchIndex);
            const prev = this.previous[matchIndex];
            const dx = candidate.centerX - prev.x;
            const dy = candidate.centerY - prev.y;
            const persistence = prev.persistence + 1;
            const directionConsistency = this.nextDirectionConsistency(prev, dx, dy);

            result.push({ ...candidate, persistence, displacementX: dx, displacementY: dy, directionConsistency });
        }

        this.previous = result.map((c) => ({
            x: c.centerX,
            y: c.centerY,
            width: c.width,
            height: c.height,
            persistence: c.persistence,
            displacementX: c.displacementX ?? 0,
            displacementY: c.displacementY ?? 0,
            directionConsistency: c.directionConsistency
        }));

        return result;
    }

    private findBestMatch(candidate: MotionCandidate, claimed: Set<number>): number {
        let bestIndex = -1;
        let bestDistance = Infinity;

        for (let i = 0; i < this.previous.length; i++) {
            if (claimed.has(i)) continue;
            const prev = this.previous[i];
            const distance = Math.hypot(candidate.centerX - prev.x, candidate.centerY - prev.y);
            const matchRadius = Math.max(prev.width, prev.height, candidate.width, candidate.height) * MATCH_RADIUS_FACTOR;
            if (distance <= matchRadius && distance < bestDistance) {
                bestDistance = distance;
                bestIndex = i;
            }
        }

        return bestIndex;
    }

    private nextDirectionConsistency(prev: PersistedState, dx: number, dy: number): number {
        const prevMagnitude = Math.hypot(prev.displacementX, prev.displacementY);
        const currentMagnitude = Math.hypot(dx, dy);

        if (prevMagnitude <= 1e-3 || currentMagnitude <= 1e-3) {
            return prev.directionConsistency * STALL_DECAY;
        }

        const dot = (prev.displacementX * dx + prev.displacementY * dy) / (prevMagnitude * currentMagnitude);
        const alignment = Math.max(0, (dot + 1) / 2); // -1..1 -> 0..1
        return prev.directionConsistency * (1 - DIRECTION_SMOOTHING) + alignment * DIRECTION_SMOOTHING;
    }
}
