import type { BlobData, CameraMotionEstimate, Track, TrackingSettings } from "../tracking/TrackTypes";
import { scoreMatch } from "./TrackingConfidence";

export interface BlobMatch {
    track: Track;
    blob: BlobData;
    score: number;
}

/**
 * Pluggable association strategy: given a frame's active tracks and
 * detected blobs, decide which blobs continue which tracks. BlobTracker
 * depends on this interface rather than a concrete algorithm — the
 * default is TrackAssociator (gated Hungarian assignment); GreedyBlobMatcher
 * below remains available as a simpler, easier-to-reason-about
 * alternative.
 */
export interface BlobMatcher {
    match(tracks: Track[], blobs: BlobData[], settings: TrackingSettings, camera: CameraMotionEstimate | null): BlobMatch[];
}

/**
 * Greedy nearest-score matcher: repeatedly picks the single
 * highest-scoring (track, blob) pair above matchThreshold, removes
 * both from further consideration, and repeats. Simple and fast, but
 * — unlike TrackAssociator's Hungarian assignment — reasons about each
 * pair in isolation, so it can leave a second-best track/blob pairing
 * stuck with a worse match than a globally optimal assignment would
 * have given it (the classic source of ID switches on crossing
 * objects). Kept as a lighter-weight alternative; not the default.
 */
export class GreedyBlobMatcher implements BlobMatcher {
    match(tracks: Track[], blobs: BlobData[], settings: TrackingSettings, camera: CameraMotionEstimate | null): BlobMatch[] {
        const candidates: BlobMatch[] = [];
        for (const track of tracks) {
            for (const blob of blobs) {
                const score = scoreMatch(track, blob, settings, camera);
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
