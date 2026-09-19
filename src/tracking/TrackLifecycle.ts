import type { Track, TrackingSettings } from "./TrackTypes";
import { isNearFrameEdge, latestPoint, recentConfidence, recordEvent, setTrackStatus } from "./Track";
import { trackerLogger } from "./TrackerLogger";

/**
 * Centralizes every TrackStatus transition in one place (see
 * TrackTypes.TrackStatus for the full state diagram) so TrackManager
 * can stay a plain data store — it calls these two entry points once
 * per frame per track rather than inlining the state machine itself.
 */

/**
 * Called for a track that got a new accepted observation this frame
 * (a fresh match OR a reidentification revival). Advances a tentative
 * track toward "active" once matched confirmationFrames times in a
 * row — a single detection never immediately becomes a trusted,
 * visualized track, per the "tentative" stage in TrackTypes.TrackStatus.
 * An "uncertain" track resolves straight back to "active" on any fresh
 * match — it was already in the primary matching pool, just with
 * softened confidence, and a real match settles that ambiguity
 * immediately without needing to re-earn confirmationFrames again.
 */
export function confirmObservation(track: Track, settings: TrackingSettings, frame: number): void {
    track.lostFrames = 0;
    track.consecutiveMatches += 1;

    if (track.status === "tentative") {
        if (track.consecutiveMatches >= settings.confirmationFrames) {
            setTrackStatus(track, "active");
            recordEvent(track, { frame, type: "confirmed", confidence: track.confidence });
            trackerLogger.trackState(track.id, { state: "ACTIVE", event: "confirmed" });
        }
        return;
    }

    if (track.status === "lost" || track.status === "uncertain") {
        const wasLost = track.status === "lost";
        setTrackStatus(track, "active");
        if (wasLost) {
            recordEvent(track, { frame, type: "reidentified", confidence: track.confidence });
        }
    }
}

/**
 * Called once per frame for every track that did NOT get a new
 * observation this frame. Advances lostFrames and, depending on how
 * stale that makes it and this track's status, may demote it:
 *
 *   tentative -> abandoned immediately (an unconfirmed track that
 *     already missed a frame was most likely noise, not worth holding
 *     a reidentification slot open for)
 *   active    -> uncertain (still gets matched next frame — see
 *                TrackManager.getMatchableTracks — just flagged as
 *                shakier) as soon as it misses even one frame, or
 *                straight past that to lost/abandoned if it's stale
 *                enough already (see below)
 *   uncertain -> lost/abandoned once it crosses maxFramesLost frames
 *                missed, or its recent confidence has collapsed
 *   lost      -> abandoned once its reidentification window elapses
 *
 * A track abandoned for genuinely low confidence, or last seen at the
 * frame edge (isNearFrameEdge — most likely left the frame rather than
 * being briefly occluded), skips "lost" entirely: there's no reason to
 * hold a reidentification slot open for it.
 */
export function markUnobserved(track: Track, settings: TrackingSettings, currentFrame: number): boolean {
    if (track.status === "abandoned") return false;

    track.lostFrames += 1;

    if (track.status === "tentative") {
        setTrackStatus(track, "abandoned");
        return true;
    }

    const staleByGap = track.lostFrames > settings.maxFramesLost;
    const staleByConfidence = recentConfidence(track) < settings.lossThreshold;

    if (track.status === "active" && !staleByGap && !staleByConfidence) {
        setTrackStatus(track, "uncertain");
        recordEvent(track, { frame: currentFrame, type: "uncertain", confidence: track.confidence });
        return true;
    }

    if (track.status === "active" || track.status === "uncertain") {
        const last = latestPoint(track);
        const leftFrame = last ? isNearFrameEdge(last, settings.edgeMargin) : false;
        const nextStatus = staleByConfidence || leftFrame ? "abandoned" : "lost";
        setTrackStatus(track, nextStatus);
        recordEvent(track, { frame: currentFrame, type: nextStatus === "abandoned" ? "abandoned" : "lost" });
        trackerLogger.trackState(track.id, {
            state: nextStatus.toUpperCase(),
            lostFrames: track.lostFrames,
            reason: staleByConfidence ? "confidence" : leftFrame ? "frame-edge" : "gap"
        });
        return true;
    }

    if (track.status === "lost" && track.lostFrames > settings.reidentifyWindowFrames) {
        setTrackStatus(track, "abandoned");
        recordEvent(track, { frame: currentFrame, type: "abandoned" });
        trackerLogger.trackState(track.id, { state: "ABANDONED", reason: "reidentify-window-expired" });
        return true;
    }

    return false;
}
