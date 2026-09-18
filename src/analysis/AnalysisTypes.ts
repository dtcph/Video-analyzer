import type { BlobData } from "../tracking/TrackTypes";

export interface ExposureStats {
    rgbClippedRatio: number;
    crushedBlacksRatio: number;
    minLuminance: number;
    maxLuminance: number;
    meanLuminance: number;
}

/** Result of analyzing one sampled frame, at analysis resolution. */
export interface FrameAnalysis {
    frame: number;
    timestamp: number;

    width: number;
    height: number;

    blobs: BlobData[];
    exposure: ExposureStats;
}

export interface AnalysisSettings {
    threshold: number;
    minBlobArea: number;
    blackThreshold: number;
    whiteThreshold: number;

    /** Downscaled resolution frames are analyzed at, independent of source video resolution. */
    analysisWidth: number;
    analysisHeight: number;

    /** How many frames per second are sampled for analysis, independent of playback frame rate. */
    sampleFps: number;
}

export const DEFAULT_ANALYSIS_SETTINGS: AnalysisSettings = {
    threshold: 0.5,
    minBlobArea: 0.0005,
    blackThreshold: 0.02,
    whiteThreshold: 0.98,
    analysisWidth: 960,
    analysisHeight: 540,
    sampleFps: 12
};
