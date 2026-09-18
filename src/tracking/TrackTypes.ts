/** All spatial values are normalized 0..1 against frame width/height. */
export interface BlobData {
    id: number;

    x: number;
    y: number;

    width: number;
    height: number;

    centerX: number;
    centerY: number;

    area: number;
}

export interface TrackPoint {
    frame: number;

    x: number;
    y: number;

    width: number;
    height: number;

    confidence: number;
}

export type TrackStatus = "active" | "lost";

export interface Track {
    id: number;

    blobs: TrackPoint[];

    startFrame: number;
    endFrame: number;

    confidence: number;

    status: TrackStatus;
}
