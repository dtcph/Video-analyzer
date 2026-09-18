import type { BlobData, TrackPoint, TrackingSettings } from "../tracking/TrackTypes";
import { DEFAULT_TRACKING_SETTINGS } from "../tracking/TrackTypes";
import type { TrackManager } from "../tracking/TrackManager";
import type { BlobMatcher } from "./BlobMatcher";
import { GreedyBlobMatcher } from "./BlobMatcher";

/**
 * Associates per-frame blob detections with existing tracks in a
 * TrackManager, starting new tracks for unmatched blobs. The
 * association algorithm itself is delegated to a BlobMatcher so it can
 * be swapped for a more advanced strategy later; this class only owns
 * the per-frame orchestration (match -> extend -> start -> expire).
 */
export class BlobTracker {
    private settings: TrackingSettings = DEFAULT_TRACKING_SETTINGS;

    constructor(
        private readonly trackManager: TrackManager,
        private readonly matcher: BlobMatcher = new GreedyBlobMatcher()
    ) {
        this.trackManager.updateSettings(this.settings);
    }

    updateSettings(partial: Partial<TrackingSettings>): void {
        this.settings = { ...this.settings, ...partial };
        this.trackManager.updateSettings(this.settings);
    }

    getSettings(): TrackingSettings {
        return this.settings;
    }

    update(frame: number, blobs: BlobData[]): void {
        const activeTracks = this.trackManager.getActiveTracks();
        const matches = this.matcher.match(activeTracks, blobs, this.settings);

        const matchedBlobs = new Set<BlobData>();
        for (const { track, blob, score } of matches) {
            matchedBlobs.add(blob);
            this.trackManager.extendTrack(track.id, toTrackPoint(frame, blob, score));
        }

        for (const blob of blobs) {
            if (matchedBlobs.has(blob)) continue;
            this.trackManager.startTrack(toTrackPoint(frame, blob, 1));
        }

        this.trackManager.markLostIfStale(frame);
    }
}

function toTrackPoint(frame: number, blob: BlobData, confidence: number): TrackPoint {
    return {
        frame,
        x: blob.centerX,
        y: blob.centerY,
        width: blob.width,
        height: blob.height,
        confidence
    };
}
