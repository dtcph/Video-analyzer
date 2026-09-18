import type { BlobData } from "../tracking/TrackTypes";
import type { AnalysisSettings } from "./AnalysisTypes";

/**
 * Detects blobs in a single frame. This is the intended integration
 * point for OpenCV.js (threshold -> findContours -> boundingRect).
 * OpenCV.js is not wired in yet; detect() returns no blobs until the
 * cv runtime is loaded and the thresholding pipeline is implemented.
 */
export class BlobDetector {
    private cvReady = false;

    isReady(): boolean {
        return this.cvReady;
    }

    detect(_imageData: ImageData, _settings: AnalysisSettings): BlobData[] {
        if (!this.cvReady) return [];
        return [];
    }
}
