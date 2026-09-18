import type { BlobData, Track, TrackingSettings } from "../tracking/TrackTypes";
import { scoreMatch } from "./TrackingConfidence";

export interface BlobMatch {
    track: Track;
    blob: BlobData;
    score: number;
}

/**
 * Pluggable association strategy: given a frame's active tracks and
 * detected blobs, decide which blobs continue which tracks. BlobTracker
 * depends on this interface rather than a concrete algorithm, so a
 * more advanced strategy (e.g. Hungarian assignment) can replace
 * GreedyBlobMatcher later without touching track lifecycle logic.
 */
export interface BlobMatcher {
    match(tracks: Track[], blobs: BlobData[], settings: TrackingSettings): BlobMatch[];
}

/**
 * Greedy nearest-score matcher: repeatedly picks the single
 * highest-scoring (track, blob) pair above matchThreshold, removes
 * both from further consideration, and repeats. Simple and fast for
 * the scale of blobs this app expects; not globally optimal like the
 * Hungarian algorithm, but close enough in practice and easy to reason
 * about.
 */
export class GreedyBlobMatcher implements BlobMatcher {
    match(tracks: Track[], blobs: BlobData[], settings: TrackingSettings): BlobMatch[] {
        const candidates: BlobMatch[] = [];
        for (const track of tracks) {
            for (const blob of blobs) {
                const score = scoreMatch(track, blob, settings);
                if (score >= settings.matchThreshold) {
                    candidates.push({ track, blob, score });
                }
            }
        }

        candidates.sort((a, b) => b.score - a.score);

        const matchedTracks = new Set<number>();
        const matchedBlobs = new Set<BlobData>();
        const result: BlobMatch[] = [];

        for (const candidate of candidates) {
            if (matchedTracks.has(candidate.track.id) || matchedBlobs.has(candidate.blob)) continue;
            matchedTracks.add(candidate.track.id);
            matchedBlobs.add(candidate.blob);
            result.push(candidate);
        }

        return result;
    }
}
