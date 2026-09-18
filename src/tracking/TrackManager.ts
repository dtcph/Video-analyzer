import type { Track, TrackPoint } from "./TrackTypes";
import { appendTrackPoint, createTrack, setTrackStatus } from "./Track";

export type TrackManagerListener = (tracks: Track[]) => void;

const LOST_AFTER_FRAMES = 5;

/**
 * Owns the set of tracks produced by the analysis pipeline.
 * Pure data store — no rendering, no DOM.
 */
export class TrackManager {
    private tracks: Map<number, Track> = new Map();
    private nextId = 0;
    private listeners: Set<TrackManagerListener> = new Set();

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

    markLostIfStale(currentFrame: number): void {
        let changed = false;
        for (const track of this.tracks.values()) {
            if (track.status === "active" && currentFrame - track.endFrame > LOST_AFTER_FRAMES) {
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
