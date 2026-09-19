import type { Track, TrackingSettings, TrackPoint } from "./TrackTypes";
import { DEFAULT_TRACKING_SETTINGS } from "./TrackTypes";
import { appendTrackPoint, createTrack, latestPoint, mergeInto } from "./Track";
import { confirmObservation, markUnobserved } from "./TrackLifecycle";
import { distance } from "../utils/geometry";

export type TrackManagerListener = (tracks: Track[]) => void;
/** Fired when two tracks turn out to be the same object and get folded into one — `keptId` survives, `droppedId` is gone from the store. Lets other owners of track-keyed state (labels, selection) follow along. */
export type TrackMergeListener = (keptId: number, droppedId: number) => void;

/**
 * Owns the set of tracks produced by the analysis pipeline. A plain
 * data store — no rendering, no DOM, and (since TrackLifecycle) no
 * state-machine logic of its own either; it just calls into
 * TrackLifecycle at the right two points (a track matched this frame,
 * a track that wasn't) and keeps listeners in sync.
 */
export class TrackManager {
    private tracks: Map<number, Track> = new Map();
    private nextId = 0;
    private listeners: Set<TrackManagerListener> = new Set();
    private mergeListeners: Set<TrackMergeListener> = new Set();
    private settings: TrackingSettings = DEFAULT_TRACKING_SETTINGS;

    updateSettings(partial: Partial<TrackingSettings>): void {
        this.settings = { ...this.settings, ...partial };
    }

    onChange(listener: TrackManagerListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    onMerge(listener: TrackMergeListener): () => void {
        this.mergeListeners.add(listener);
        return () => this.mergeListeners.delete(listener);
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
        confirmObservation(track, this.settings, point.frame);
        this.emit();
    }

    /**
     * Advances every track that did NOT get a new observation this
     * frame (see TrackLifecycle.markUnobserved for the full
     * active -> uncertain -> lost -> abandoned progression, and what
     * skips straight to "abandoned"). Tracks extended this frame
     * (endFrame === currentFrame, set by extendTrack just above) are
     * left alone — they've already had their lifecycle step via
     * confirmObservation.
     */
    updateLifecycle(currentFrame: number): void {
        let changed = false;
        for (const track of this.tracks.values()) {
            if (track.endFrame === currentFrame) continue;
            if (markUnobserved(track, this.settings, currentFrame)) changed = true;
        }
        if (changed) this.emit();
    }

    /**
     * Folds `dropId` into `keepId` — used when reidentification revives
     * a lost track under a blob that had already started a new one, or
     * when two simultaneously matchable tracks turn out to be
     * duplicates of the same object (see BlobTracker and
     * mergeDuplicateActiveTracks). Notifies onMerge listeners before
     * removing `dropId` so they can move anything keyed by it (a label,
     * the current selection) over to `keepId` first.
     */
    mergeTracks(keepId: number, dropId: number): void {
        if (keepId === dropId) return;
        const keep = this.tracks.get(keepId);
        const drop = this.tracks.get(dropId);
        if (!keep || !drop) return;

        mergeInto(keep, drop);
        this.tracks.delete(dropId);

        for (const listener of this.mergeListeners) listener(keepId, dropId);
        this.emit();
    }

    /**
     * Two matchable (active or uncertain) tracks whose current
     * positions have converged within mergeDistance are almost
     * certainly the same object — most often caused by detection noise
     * briefly splitting one blob into two, or a reidentification
     * landing a track right on top of one that was never actually
     * lost. Keeps the older (lower id) track and folds the newer one
     * into it, so the tracking history that already has more identity
     * behind it — and is more likely to be labeled — wins.
     */
    mergeDuplicateActiveTracks(): void {
        const matchable = this.getMatchableTracks().sort((a, b) => a.id - b.id);

        for (let i = 0; i < matchable.length; i++) {
            const a = this.tracks.get(matchable[i].id);
            const pointA = a ? latestPoint(a) : undefined;
            if (!a || !pointA) continue;

            for (let j = i + 1; j < matchable.length; j++) {
                const b = this.tracks.get(matchable[j].id);
                const pointB = b ? latestPoint(b) : undefined;
                if (!b || !pointB) continue;

                if (distance(pointA, pointB) <= this.settings.mergeDistance) {
                    this.mergeTracks(a.id, b.id);
                }
            }
        }
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

    /** The pool BlobTracker matches new detections against each frame: unconfirmed tracks still earning trust, confirmed tracks, and tracks that are shakier but still being matched — everything short of "lost"/"abandoned". See TrackTypes.TrackStatus. */
    getMatchableTracks(): Track[] {
        return this.getAllTracks().filter(
            (track) => track.status === "active" || track.status === "uncertain" || track.status === "tentative"
        );
    }

    /** Tracks still eligible for reidentification — see TrackLifecycle.markUnobserved for how a track ends up here versus "abandoned". */
    getLostTracks(): Track[] {
        return this.getAllTracks().filter((track) => track.status === "lost");
    }
}
