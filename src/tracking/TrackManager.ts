import type { Track, TrackingSettings, TrackPoint } from "./TrackTypes";
import { DEFAULT_TRACKING_SETTINGS } from "./TrackTypes";
import { appendTrackPoint, createTrack, recentConfidence, setTrackStatus } from "./Track";

export type TrackManagerListener = (tracks: Track[]) => void;

/**
 * Owns the set of tracks produced by the analysis pipeline.
 * Pure data store — no rendering, no DOM.
 */
export class TrackManager {
    private tracks: Map<number, Track> = new Map();
    private nextId = 0;
    private listeners: Set<TrackManagerListener> = new Set();
    private settings: TrackingSettings = DEFAULT_TRACKING_SETTINGS;

    updateSettings(partial: Partial<TrackingSettings>): void {
        this.settings = { ...this.settings, ...partial };
    }

    onChange(listener: TrackManagerListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private emit(): void {
        const snapshot = this.getAllTracks();
        for (const listener of this.listeners) listener(snapshot);
    }

    reset(): void {
        this.tracks.clear();
        this.nextId = 0;
        this.emit();
    }

    startTrack(point: TrackPoint): Track {
        const id = this.nextId++;
        const track = createTrack(id, point);
        this.tracks.set(id, track);
        this.emit();
        return track;
    }

    extendTrack(trackId: number, point: TrackPoint): void {
        const track = this.tracks.get(trackId);
        if (!track) return;
        appendTrackPoint(track, point);
        setTrackStatus(track, "active");
        this.emit();
    }

    /**
     * A track leaves "active" for "lost" in two ways: it goes too many
     * consecutive frames without an accepted match (maxFramesLost), or
     * its recent match quality has degraded below lossThreshold even
     * while still nominally being extended. V1 has no "uncertain"
     * status of its own — a track between those two conditions stays
     * active but with a visibly lower confidence — and there is no
     * automatic re-identification once a track is lost.
     */
    markLostIfStale(currentFrame: number): void {
        let changed = false;
        for (const track of this.tracks.values()) {
            if (track.status !== "active") continue;

            const staleByGap = currentFrame - track.endFrame > this.settings.maxFramesLost;
            const staleByConfidence = recentConfidence(track) < this.settings.lossThreshold;

            if (staleByGap || staleByConfidence) {
                setTrackStatus(track, "lost");
                changed = true;
            }
        }
        if (changed) this.emit();
    }

    getTrack(trackId: number): Track | undefined {
        return this.tracks.get(trackId);
    }

    getAllTracks(): Track[] {
        return Array.from(this.tracks.values());
    }

    getActiveTracks(): Track[] {
        return this.getAllTracks().filter((track) => track.status === "active");
    }
}
