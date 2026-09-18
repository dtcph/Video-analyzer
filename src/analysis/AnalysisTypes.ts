import type { BlobData } from "../tracking/TrackTypes";

export interface ExposureStats {
    rgbClippedRatio: number;
    crushedBlacksRatio: number;
    minLuminance: number;
    maxLuminance: number;
    meanLuminance: number;
}

export interface FrameAnalysisResult {
    frame: number;
    blobs: BlobData[];
    exposure: ExposureStats;
}

export interface AnalysisSettings {
    threshold: number;
    minBlobArea: number;
    blackThreshold: number;
    whiteThreshold: number;
}

export const DEFAULT_ANALYSIS_SETTINGS: AnalysisSettings = {
    threshold: 0.5,
    minBlobArea: 0.0005,
    blackThreshold: 0.02,
    whiteThreshold: 0.98
};
