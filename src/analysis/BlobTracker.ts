import type { BlobData, TrackPoint, TrackingSettings } from "../tracking/TrackTypes";
import { DEFAULT_TRACKING_SETTINGS } from "../tracking/TrackTypes";
import type { TrackManager } from "../tracking/TrackManager";
import type { BlobMatcher } from "./BlobMatcher";
import { TrackAssociator } from "./TrackAssociator";
import { reidentifyRadius, reidentifyTracks } from "./TrackReidentifier";
import { predictionRadius } from "./TrackingConfidence";
import { CameraMotionEstimator } from "./CameraMotionEstimator";
import { predictPosition } from "../tracking/Track";
import type { CameraMotionEstimate } from "../tracking/TrackTypes";

/**
 * Associates per-frame blob detections with existing tracks in a
 * TrackManager, starting new tracks for unmatched blobs. The
 * association algorithm itself is delegated to a BlobMatcher (default:
 * TrackAssociator's gated Hungarian assignment — see BlobMatcher.ts for
 * the simpler GreedyBlobMatcher alternative) so it can be swapped
 * without touching this orchestration:
 *
 *   estimate camera motion -> match the matchable pool (tentative,
 *   active, uncertain) -> reidentify lost tracks against what's left
 *   -> start new tracks for anything still unclaimed -> advance
 *   lifecycle for everything not matched this frame -> merge any
 *   matchable tracks that turned out to be duplicates.
 *
 * The reidentify step is what keeps a briefly-occluded object as one
 * track instead of "lost" + a brand new one at the same spot — an
 * unmatched blob is first offered to recently-lost tracks before a new
 * id is ever created for it. The camera-motion estimate (see
 * CameraMotionEstimator) is what keeps that same matching from getting
 * unreasonably strict, or mispredicted, for every track the instant the
 * camera itself pans or shakes.
 */
export class BlobTracker {
    private settings: TrackingSettings = DEFAULT_TRACKING_SETTINGS;
    private readonly motionEstimator = new CameraMotionEstimator();
    private lastCameraMotion: CameraMotionEstimate | null = null;

    constructor(
        private readonly trackManager: TrackManager,
        private readonly matcher: BlobMatcher = new TrackAssociator()
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

    /** This frame's global-motion estimate (see CameraMotionEstimator), for the debug HUD — null before the first analyzed frame. */
    getLastCameraMotion(): CameraMotionEstimate | null {
        return this.lastCameraMotion;
    }

    /** Drops accumulated camera-motion history — call when starting a new video, since a running baseline from the previous clip has nothing to do with this one. */
    reset(): void {
        this.motionEstimator.reset();
        this.lastCameraMotion = null;
    }

    update(frame: number, blobs: BlobData[]): void {
        const matchableTracks = this.trackManager.getMatchableTracks();
        const camera = this.motionEstimator.estimate(matchableTracks, this.settings);
        this.lastCameraMotion = camera;

        // Recorded on each track itself (not just used locally) so debug
        // visualization and Inspector can show what the tracker expected
        // before seeing this frame's detections — see TrackTypes.Track.
        for (const track of matchableTracks) {
            track.predictedPosition = predictPosition(track, 1, camera);
            track.predictedSize = { width: track.expectedSize.width, height: track.expectedSize.height };
            track.searchRadius = predictionRadius(track, this.settings, camera);
        }

        const matches = this.matcher.match(matchableTracks, blobs, this.settings, camera);

        const matchedBlobs = new Set<BlobData>();
        for (const { track, blob, score } of matches) {
            matchedBlobs.add(blob);
            this.trackManager.extendTrack(track.id, toTrackPoint(frame, blob, score));
        }

        const unmatchedBlobs = blobs.filter((blob) => !matchedBlobs.has(blob));

        const lostTracks = this.trackManager.getLostTracks();
        for (const track of lostTracks) {
            const gap = frame - track.endFrame;
            track.predictedPosition = predictPosition(track, gap, camera);
            track.searchRadius = reidentifyRadius(gap, this.settings);
        }

        const revivals = reidentifyTracks(lostTracks, unmatchedBlobs, frame, this.settings, camera);
        const revivedBlobs = new Set<BlobData>();
        for (const { track, blob, score } of revivals) {
            revivedBlobs.add(blob);
            this.trackManager.extendTrack(track.id, toTrackPoint(frame, blob, score));
        }

        for (const blob of unmatchedBlobs) {
            if (revivedBlobs.has(blob)) continue;
            this.trackManager.startTrack(toTrackPoint(frame, blob, 1));
        }

        this.trackManager.updateLifecycle(frame);
        this.trackManager.mergeDuplicateActiveTracks();
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
