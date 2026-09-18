import type { Track, TrackPoint, TrackStatus } from "./TrackTypes";

export function createTrack(id: number, firstPoint: TrackPoint): Track {
    return {
        id,
        blobs: [firstPoint],
        startFrame: firstPoint.frame,
        endFrame: firstPoint.frame,
        confidence: firstPoint.confidence,
        status: "active"
    };
}

export function appendTrackPoint(track: Track, point: TrackPoint): void {
    track.blobs.push(point);
    track.endFrame = point.frame;
    track.confidence = averageConfidence(track);
}

export function setTrackStatus(track: Track, status: TrackStatus): void {
    track.status = status;
}

export function latestPoint(track: Track): TrackPoint | undefined {
    return track.blobs[track.blobs.length - 1];
}

export function pointAtFrame(track: Track, frame: number): TrackPoint | undefined {
    return track.blobs.find((point) => point.frame === frame);
}

export function averageConfidence(track: Track): number {
    if (track.blobs.length === 0) return 0;
    const sum = track.blobs.reduce((acc, point) => acc + point.confidence, 0);
    return sum / track.blobs.length;
}

export function durationInFrames(track: Track): number {
    return track.endFrame - track.startFrame + 1;
}
