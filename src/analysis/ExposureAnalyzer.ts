import type { AnalysisSettings, ExposureData } from "./AnalysisTypes";
import { ExposureMaskBit } from "./AnalysisTypes";

export interface ExposureResult {
    data: ExposureData;
    /** One ExposureMaskBit combination per pixel, row-major. */
    mask: Uint8Array;
}

/**
 * Computes exposure-related statistics (per-channel RGB clipping,
 * luminance highlights, crushed blacks) from raw pixel data, plus a
 * per-pixel category mask for visualization. No OpenCV dependency —
 * this runs on plain ImageData.
 */
export class ExposureAnalyzer {
    static analyze(imageData: ImageData, settings: AnalysisSettings): ExposureResult {
        const { data } = imageData;
        const pixelCount = data.length / 4;
        const mask = new Uint8Array(pixelCount);

        let redClipCount = 0;
        let greenClipCount = 0;
        let blueClipCount = 0;
        let combinedClipCount = 0;
        let highlightCount = 0;
        let crushedCount = 0;
        let minLuminance = 1;
        let maxLuminance = 0;
        let luminanceSum = 0;

        const clipCutoff = settings.clipThreshold * 255;

        for (let i = 0, p = 0; i < data.length; i += 4, p++) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];

            const redClipped = r >= clipCutoff;
            const greenClipped = g >= clipCutoff;
            const blueClipped = b >= clipCutoff;
            const anyClipped = redClipped || greenClipped || blueClipped;

            if (redClipped) redClipCount++;
            if (greenClipped) greenClipCount++;
            if (blueClipped) blueClipCount++;
            if (anyClipped) combinedClipCount++;

            const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
            const isHighlight = luminance >= settings.highlightThreshold;
            const isCrushed = luminance <= settings.shadowThreshold;

            if (isHighlight) highlightCount++;
            if (isCrushed) crushedCount++;

            minLuminance = Math.min(minLuminance, luminance);
            maxLuminance = Math.max(maxLuminance, luminance);
            luminanceSum += luminance;

            let bits = 0;
            if (anyClipped) bits |= ExposureMaskBit.Clip;
            if (isHighlight) bits |= ExposureMaskBit.Highlight;
            if (isCrushed) bits |= ExposureMaskBit.CrushedBlack;
            mask[p] = bits;
        }

        return {
            data: {
                rgbClipRatio: combinedClipCount / pixelCount,
                redClipRatio: redClipCount / pixelCount,
                greenClipRatio: greenClipCount / pixelCount,
                blueClipRatio: blueClipCount / pixelCount,
                luminanceHighlightRatio: highlightCount / pixelCount,
                crushedBlackRatio: crushedCount / pixelCount,
                minLuminance,
                maxLuminance,
                meanLuminance: luminanceSum / pixelCount
            },
            mask
        };
    }
}
