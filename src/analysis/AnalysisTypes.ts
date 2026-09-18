import type { BlobData } from "../tracking/TrackTypes";

export interface ExposureData {
    rgbClipRatio: number;

    redClipRatio: number;
    greenClipRatio: number;
    blueClipRatio: number;

    luminanceHighlightRatio: number;

    crushedBlackRatio: number;

    minLuminance: number;
    maxLuminance: number;
    meanLuminance: number;
}

/** Per-pixel exposure category bitmask, one byte per pixel at analysis resolution. */
export const enum ExposureMaskBit {
    Clip = 0b001,
    Highlight = 0b010,
    CrushedBlack = 0b100
}

/** Result of analyzing one sampled frame, at analysis resolution. */
export interface FrameAnalysis {
    frame: number;
    timestamp: number;

    width: number;
    height: number;

    blobs: BlobData[];
    exposure: ExposureData;
    /** One ExposureMaskBit combination per pixel, row-major, same dimensions as width/height. */
    exposureMask: Uint8Array;
}

export interface AnalysisSettings {
    /** Grayscale binarization threshold for blob detection, 0..1 (mapped to 0..255 for OpenCV). */
    threshold: number;
    /** Minimum blob area, normalized as a fraction of total frame area. */
    minBlobArea: number;
    /** Maximum blob area, normalized as a fraction of total frame area. */
    maxBlobArea: number;
    /** Morphological open/close iterations applied to the threshold mask to remove noise, 0 = off. */
    morphologyStrength: number;
    /** Optional Gaussian blur kernel radius in px (at analysis resolution) applied before thresholding, 0 = off. */
    blurRadius: number;

    /** Luminance at/above which a pixel counts as a crushed-black shadow, 0..1. */
    shadowThreshold: number;
    /** Luminance at/above which a pixel counts as a highlight, 0..1. */
    highlightThreshold: number;
    /** RGB channel value (normalized 0..1) at/above which that channel counts as clipped. */
    clipThreshold: number;

    /**
     * Resolution frames are downscaled to for analysis. Set per-loaded-video
     * (see fitWithinPreservingAspect) to match the source's aspect ratio
     * within ANALYSIS_RESOLUTION_BUDGET — never a fixed 16:9 stretch.
     */
    analysisWidth: number;
    analysisHeight: number;

    /** How many frames per second are sampled for analysis, independent of playback frame rate. */
    sampleFps: number;
}

/** Max analysis-canvas footprint; actual per-video dimensions are fit within this preserving aspect ratio. */
export const ANALYSIS_RESOLUTION_BUDGET = { width: 960, height: 540 };

export const DEFAULT_ANALYSIS_SETTINGS: AnalysisSettings = {
    threshold: 0.5,
    minBlobArea: 0.0005,
    maxBlobArea: 0.5,
    morphologyStrength: 1,
    blurRadius: 0,
    shadowThreshold: 0.02,
    highlightThreshold: 0.85,
    clipThreshold: 0.98,
    analysisWidth: ANALYSIS_RESOLUTION_BUDGET.width,
    analysisHeight: ANALYSIS_RESOLUTION_BUDGET.height,
    sampleFps: 12
};
