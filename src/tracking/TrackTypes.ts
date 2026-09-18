/** All spatial values are normalized 0..1 against frame width/height. */
export interface BlobData {
    id: number;

    /** Top-left corner of the bounding box. Use centerX/centerY for the blob's center. */
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

    /** Center of the bounding box (unlike BlobData.x/y, which is top-left). */
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

/**
 * Configurable knobs for blob-to-track association and track lifecycle.
 * See TrackingConfidence.scoreMatch for how the weights combine into a
 * single match score, and TrackManager for how the thresholds below
 * drive the active -> lost transition.
 */
export interface TrackingSettings {
    /** Minimum score (see scoreMatch) required to associate a blob with an existing track. */
    matchThreshold: number;
    /** A track is marked "lost" once its recent confidence drops below this value. */
    lossThreshold: number;
    /** A track is marked "lost" after this many consecutive frames with no accepted match. */
    maxFramesLost: number;

    /** Relative weight of predicted-position proximity in the match score. */
    weightPosition: number;
    /** Relative weight of bounding-box overlap (IoU) in the match score. */
    weightOverlap: number;
    /** Relative weight of blob-area similarity in the match score. */
    weightArea: number;
    /** Relative weight of movement-direction/magnitude consistency in the match score. */
    weightMovement: number;
}

export const DEFAULT_TRACKING_SETTINGS: TrackingSettings = {
    matchThreshold: 0.4,
    lossThreshold: 0.25,
    maxFramesLost: 5,
    weightPosition: 0.4,
    weightOverlap: 0.25,
    weightArea: 0.15,
    weightMovement: 0.2
};
