import type { BlobData, TrackPoint } from "../tracking/TrackTypes";
import type { TrackManager } from "../tracking/TrackManager";
import { latestPoint } from "../tracking/Track";
import { scoreMatch } from "./TrackingConfidence";

const MATCH_THRESHOLD = 0.4;

/**
 * Associates per-frame blob detections with existing tracks in a
 * TrackManager, starting new tracks for unmatched blobs.
 */
export class BlobTracker {
    constructor(private readonly trackManager: TrackManager) {}

    update(frame: number, blobs: BlobData[]): void {
        const activeTracks = this.trackManager.getActiveTracks();
        const unmatchedBlobs = new Set(blobs);

        for (const track of activeTracks) {
            const previous = latestPoint(track);
            if (!previous) continue;

            let bestBlob: BlobData | null = null;
            let bestScore = MATCH_THRESHOLD;

            for (const blob of unmatchedBlobs) {
                const score = scoreMatch(previous, blob);
                if (score > bestScore) {
                    bestScore = score;
                    bestBlob = blob;
                }
            }

            if (bestBlob) {
                unmatchedBlobs.delete(bestBlob);
                this.trackManager.extendTrack(track.id, toTrackPoint(frame, bestBlob, bestScore));
            }
        }

        for (const blob of unmatchedBlobs) {
            this.trackManager.startTrack(toTrackPoint(frame, blob, 1));
        }

        this.trackManager.markLostIfStale(frame);
    }
}

function toTrackPoint(frame: number, blob: BlobData, confidence: number): TrackPoint {
    return {
        frame,
        x: blob.x,
        y: blob.y,
        width: blob.width,
        height: blob.height,
        confidence
    };
}
