import type { AnalysisSettings, ExposureStats } from "./AnalysisTypes";

/**
 * Computes exposure-related statistics (clipping, crushed blacks,
 * luminance range) from raw pixel data. No OpenCV dependency —
 * this runs on plain ImageData.
 */
export class ExposureAnalyzer {
    static analyze(imageData: ImageData, settings: AnalysisSettings): ExposureStats {
        const { data } = imageData;
        const pixelCount = data.length / 4;

        let clippedCount = 0;
        let crushedCount = 0;
        let minLuminance = 1;
        let maxLuminance = 0;
        let luminanceSum = 0;

        const whiteCutoff = settings.whiteThreshold * 255;

        for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];

            if (r >= whiteCutoff || g >= whiteCutoff || b >= whiteCutoff) {
                clippedCount++;
            }

            const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
            if (luminance <= settings.blackThreshold) crushedCount++;

            minLuminance = Math.min(minLuminance, luminance);
            maxLuminance = Math.max(maxLuminance, luminance);
            luminanceSum += luminance;
        }

        return {
            rgbClippedRatio: clippedCount / pixelCount,
            crushedBlacksRatio: crushedCount / pixelCount,
            minLuminance,
            maxLuminance,
            meanLuminance: luminanceSum / pixelCount
        };
    }
}
