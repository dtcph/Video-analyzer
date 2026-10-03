import { COCO_CLASSES } from "../inference/cocoClasses";
import type { Detection } from "../inference/postprocess";
import type { Box } from "../utils/geometry";
import { intersectionOverUnion } from "../utils/geometry";
import { associate } from "./association";
import type { Associable } from "./association";
import { BoxKalmanFilter } from "./BoxKalmanFilter";

/** The user-facing tracker parameters (settings). */
export interface TrackerOptions {
    /** A tentative track is confirmed (and counted) after this many consecutive frames with a detection. */
    confirmationFrames: number;
    /** A confirmed track that is no longer seen is kept this long (media seconds) for re-association. */
    lostBufferSeconds: number;
    /** Detections at or above this score are "high" (the user's confidence threshold): only they create, confirm or classify tracks. */
    highScore: number;
}

/** Internal constants (not settings). Documented in docs/decisions.md §6; overridable for the parameter sweep. */
export interface TrackerTuning {
    /** Detections from here up to `highScore` can only extend existing confirmed tracks (ByteTrack's second stage). */
    lowScore: number;
    /** Subtracted from the IoU when a detection's class differs from the track's (user decision: cross-class association). */
    classPenalty: number;
    /** Minimum association score per stage (ByteTrack: 0.2 / 0.5 / 0.3, i.e. its match thresholds 0.8 / 0.5 / 0.7 as costs). */
    minScoreHigh: number;
    minScoreLow: number;
    minScoreTentative: number;
    /**
     * An unmatched detection that overlaps a track already matched in this
     * frame by at least this IoU, with a different class, is a cross-class
     * duplicate of that object (class-aware NMS keeps e.g. both "car" and
     * "truck" boxes on one vehicle) and does not start a new track.
     * Set above 1 to disable.
     */
    duplicateIou: number;
    /** Buffered-IoU enlargement (see `Associable.buffer`) for tracked and for lost tracks. */
    trackedBuffer: number;
    lostBuffer: number;
}

export const DEFAULT_TUNING: Readonly<TrackerTuning> = {
    lowScore: 0.1,
    classPenalty: 0.2,
    minScoreHigh: 0.2,
    minScoreLow: 0.5,
    minScoreTentative: 0.3,
    duplicateIou: 0.7,
    trackedBuffer: 0,
    lostBuffer: 0.5
};

export type TrackState = "tentative" | "confirmed" | "lost";

export interface TrackSnapshot {
    id: number;
    /** Majority class (score-weighted votes of its above-threshold detections). */
    classId: number;
    label: string;
    /** Score of the latest above-threshold detection. */
    confidence: number;
    state: TrackState;
    /** Frames with an above-threshold detection. */
    hits: number;
    firstSeen: number;
    lastSeen: number;
    counted: boolean;
    /** Box at the latest update, normalized. */
    box: Box;
}

/** A track to draw at a display time. */
export interface VisibleTrack {
    id: number;
    classId: number;
    confidence: number;
    confirmed: boolean;
    box: Box;
}

export interface TrackerUpdate {
    /** Tracks confirmed in this update, each exactly once in a track's life: count these (under `classId`). */
    newlyConfirmed: TrackSnapshot[];
    /** Already counted tracks whose majority class changed in this update: move their count `from` → `to`. */
    reclassified: { id: number; from: number; to: number }[];
    /** Time went backwards (a seek), so all tracks were dropped first. */
    reset: boolean;
}

export interface TrackerStats {
    tentative: number;
    confirmed: number;
    lost: number;
}

interface Track {
    id: number;
    filter: BoxKalmanFilter;
    /** Media time the filter state belongs to. */
    time: number;
    votes: Map<number, number>;
    classId: number;
    confidence: number;
    state: TrackState;
    hits: number;
    firstSeen: number;
    lastSeen: number;
    counted: boolean;
    /** The class this track is currently counted under (set at confirmation, follows the majority vote). */
    countedClass: number;
}

/** Same-time updates (within this) are ignored; earlier ones mean a seek. */
const TIME_EPSILON = 1e-6;

/**
 * ByteTrack-style multi-object tracker over detections from frames sampled at
 * a variable rate. Pure: no DOM, no timers; time is media time in seconds.
 *
 * Per update:
 * 1. lost tracks older than the lost buffer are removed; all tracks are
 *    predicted to the frame time (Kalman, constant velocity);
 * 2. high-score detections are matched to confirmed and lost tracks
 *    (Hungarian on IoU, across classes with a mismatch penalty);
 * 3. low-score detections can only extend still unmatched confirmed tracks;
 *    unmatched confirmed tracks become lost;
 * 4. tentative tracks are matched to the remaining high-score detections;
 *    unmatched tentative tracks are removed (so confirmation needs
 *    consecutive frames);
 * 5. remaining high-score detections start tentative tracks.
 * A track is confirmed after `confirmationFrames` hits and reported once in
 * `newlyConfirmed`, under its majority class at that moment. Its count then
 * follows the majority vote: when the winning class changes, the update lists
 * it in `reclassified` so the count moves (the total never changes).
 */
export class Tracker {
    private tracks: Track[] = [];
    private nextId = 1;
    private lastTime: number | null = null;
    private options: TrackerOptions;

    constructor(
        options: TrackerOptions,
        private readonly tuning: Readonly<TrackerTuning> = DEFAULT_TUNING
    ) {
        this.options = { ...options };
    }

    setOptions(options: Partial<TrackerOptions>): void {
        this.options = { ...this.options, ...options };
    }

    getOptions(): Readonly<TrackerOptions> {
        return this.options;
    }

    /** Media time of the latest update, or null. */
    getLastTime(): number | null {
        return this.lastTime;
    }

    /**
     * Feeds the detections of one frame (already filtered to enabled classes;
     * scores below `lowScore` are ignored).
     */
    update(time: number, detections: readonly Detection[]): TrackerUpdate {
        const newlyConfirmed: TrackSnapshot[] = [];
        const reclassified: TrackerUpdate["reclassified"] = [];
        let reset = false;
        if (this.lastTime !== null) {
            if (time < this.lastTime - TIME_EPSILON) {
                this.clear();
                reset = true;
            } else if (time - this.lastTime <= TIME_EPSILON) {
                return { newlyConfirmed, reclassified, reset };
            }
        }
        const { highScore, lostBufferSeconds } = this.options;
        const { lowScore, classPenalty } = this.tuning;

        // 1. Expire, then predict.
        this.tracks = this.tracks.filter((t) => !(t.state === "lost" && time - t.lastSeen > lostBufferSeconds));
        for (const track of this.tracks) {
            if (track.state === "lost") track.filter.stopHeightVelocity();
            track.filter.predict(time - track.time);
            track.time = time;
        }

        // Highest score first, so of two cross-class duplicates the more confident one starts the track.
        const byScore = [...detections].sort((a, b) => b.score - a.score);
        const high = byScore.filter((d) => d.score >= highScore);
        const low = byScore.filter((d) => d.score >= lowScore && d.score < highScore);
        const matched = new Set<Track>();
        const confirmIfDue = (track: Track) => {
            if (track.state === "tentative" && track.hits >= this.options.confirmationFrames) {
                this.confirm(track, newlyConfirmed);
            }
        };

        // 2. High-score detections ↔ confirmed and lost tracks.
        const established = this.tracks.filter((t) => t.state !== "tentative");
        const first = associate(
            established.map((t) => this.associable(t)),
            high,
            this.tuning.minScoreHigh,
            classPenalty
        );
        for (const [row, col] of first.matches) {
            const track = established[row];
            this.apply(track, high[col], time, true);
            track.state = "confirmed";
            matched.add(track);
        }

        // 3. Low-score detections ↔ remaining confirmed tracks (never lost ones).
        const remaining = first.unmatchedRows.map((i) => established[i]).filter((t) => t.state === "confirmed");
        const second = associate(
            remaining.map((t) => this.associable(t)),
            low,
            this.tuning.minScoreLow,
            classPenalty
        );
        for (const [row, col] of second.matches) {
            this.apply(remaining[row], low[col], time, false);
            matched.add(remaining[row]);
        }
        for (const row of second.unmatchedRows) remaining[row].state = "lost";

        // 4. Remaining high-score detections ↔ tentative tracks.
        const leftHigh = first.unmatchedCols.map((j) => high[j]);
        const tentative = this.tracks.filter((t) => t.state === "tentative");
        const third = associate(
            tentative.map((t) => this.associable(t)),
            leftHigh,
            this.tuning.minScoreTentative,
            classPenalty
        );
        for (const [row, col] of third.matches) {
            const track = tentative[row];
            this.apply(track, leftHigh[col], time, true);
            matched.add(track);
            confirmIfDue(track);
        }
        const removed = new Set(third.unmatchedRows.map((row) => tentative[row]));
        this.tracks = this.tracks.filter((t) => !removed.has(t));

        // 5. New tentative tracks, except cross-class duplicates of an object matched in this frame.
        const matchedBoxes = [...matched].map((t) => ({ classId: t.classId, box: t.filter.box() }));
        for (const col of third.unmatchedCols) {
            const detection = leftHigh[col];
            const duplicate = matchedBoxes.some(
                (m) =>
                    m.classId !== detection.classId &&
                    intersectionOverUnion(m.box, detection.box) >= this.tuning.duplicateIou
            );
            if (duplicate) continue;
            const track = this.create(detection, time);
            matchedBoxes.push({ classId: track.classId, box: detection.box });
            confirmIfDue(track);
        }

        for (const track of matched) {
            if (track.counted && track.classId !== track.countedClass) {
                reclassified.push({ id: track.id, from: track.countedClass, to: track.classId });
                track.countedClass = track.classId;
            }
        }
        this.lastTime = time;
        return { newlyConfirmed, reclassified, reset };
    }

    /**
     * Tracks seen in the latest update (tentative and confirmed, not lost),
     * with their boxes extrapolated to `displayTime`. Nothing is shown when the
     * latest update is more than `maxAgeSeconds` away from the display time
     * (inference stalled, or the display jumped).
     */
    visibleAt(displayTime: number, maxAgeSeconds: number): VisibleTrack[] {
        if (this.lastTime === null) return [];
        const ahead = displayTime - this.lastTime;
        if (Math.abs(ahead) > maxAgeSeconds) return [];
        return this.tracks
            .filter((t) => t.state !== "lost")
            .map((t) => ({
                id: t.id,
                classId: t.classId,
                confidence: t.confidence,
                confirmed: t.state === "confirmed",
                box: t.filter.box(displayTime - t.time)
            }));
    }

    /** All live tracks (including lost ones), in creation order. */
    snapshot(): TrackSnapshot[] {
        return this.tracks.map(snapshotOf);
    }

    stats(): TrackerStats {
        const stats: TrackerStats = { tentative: 0, confirmed: 0, lost: 0 };
        for (const t of this.tracks) stats[t.state]++;
        return stats;
    }

    /** Drops tracks whose class was disabled (`enabled[classId]` is 0). Their counts, if any, stay. */
    dropDisabledClasses(enabled: Uint8Array): void {
        this.tracks = this.tracks.filter((t) => enabled[t.classId] === 1);
    }

    /** Drops all tracks (a seek). `resetIds` also restarts IDs at 1 (Reset counts, new media). */
    clear(resetIds = false): void {
        this.tracks = [];
        this.lastTime = null;
        if (resetIds) this.nextId = 1;
    }

    private create(detection: Detection, time: number): Track {
        const track: Track = {
            id: this.nextId++,
            filter: new BoxKalmanFilter(detection.box),
            time,
            votes: new Map([[detection.classId, detection.score]]),
            classId: detection.classId,
            confidence: detection.score,
            state: "tentative",
            hits: 1,
            firstSeen: time,
            lastSeen: time,
            counted: false,
            countedClass: detection.classId
        };
        this.tracks.push(track);
        return track;
    }

    /** Updates a matched track. Only high-score detections add hits, class votes and confidence. */
    private apply(track: Track, detection: Detection, time: number, high: boolean): void {
        track.filter.update(detection.box);
        track.lastSeen = time;
        if (!high) return;
        track.hits++;
        track.confidence = detection.score;
        track.votes.set(detection.classId, (track.votes.get(detection.classId) ?? 0) + detection.score);
        let best = track.classId;
        for (const [classId, weight] of track.votes) {
            if (weight > (track.votes.get(best) ?? 0)) best = classId;
        }
        track.classId = best;
    }

    private associable(track: Track): Associable {
        const buffer = track.state === "lost" ? this.tuning.lostBuffer : this.tuning.trackedBuffer;
        return { box: track.filter.box(), classId: track.classId, buffer };
    }

    private confirm(track: Track, newlyConfirmed: TrackSnapshot[]): void {
        track.state = "confirmed";
        if (track.counted) return;
        track.counted = true;
        track.countedClass = track.classId;
        newlyConfirmed.push(snapshotOf(track));
    }
}

function snapshotOf(t: Track): TrackSnapshot {
    return {
        id: t.id,
        classId: t.classId,
        label: COCO_CLASSES[t.classId] ?? `class ${t.classId}`,
        confidence: t.confidence,
        state: t.state,
        hits: t.hits,
        firstSeen: t.firstSeen,
        lastSeen: t.lastSeen,
        counted: t.counted,
        box: t.filter.box()
    };
}
