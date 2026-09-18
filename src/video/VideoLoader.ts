import type { VideoMetadata } from "./VideoTypes";

const ASSUMED_FRAME_RATE = 30;
const MAX_RECOMMENDED_BYTES = 500 * 1024 * 1024;
const SUPPORTED_MIME_TYPES = ["video/mp4", "video/webm"];

let probeVideoEl: HTMLVideoElement | null = null;

function getProbeElement(): HTMLVideoElement {
    if (!probeVideoEl) probeVideoEl = document.createElement("video");
    return probeVideoEl;
}

export class VideoLoader {
    /**
     * Best-effort pre-flight check. A definite "no" here (empty type,
     * or a type Chrome reports as outright unplayable) is filtered
     * before we spend time loading the file; anything else is left to
     * the actual <video> element, which is the real source of truth.
     */
    static validate(file: File): string | null {
        if (!file.type) {
            return "Could not determine file type. Try an MP4 or WebM file.";
        }
        if (!file.type.startsWith("video/")) {
            return `Unsupported file type: ${file.type}. Try an MP4 or WebM file.`;
        }
        if (getProbeElement().canPlayType(file.type) === "") {
            return `This browser cannot play ${file.type} files. Try an MP4 or WebM file.`;
        }
        return null;
    }

    static isRecommendedSize(file: File): boolean {
        return file.size <= MAX_RECOMMENDED_BYTES;
    }

    static isKnownFormat(file: File): boolean {
        return SUPPORTED_MIME_TYPES.includes(file.type);
    }

    static createObjectUrl(file: File): string {
        return URL.createObjectURL(file);
    }

    static revokeObjectUrl(url: string): void {
        URL.revokeObjectURL(url);
    }

    static readMetadata(video: HTMLVideoElement, file: File): VideoMetadata {
        return {
            fileName: file.name,
            fileSizeBytes: file.size,
            durationSeconds: video.duration,
            width: video.videoWidth,
            height: video.videoHeight,
            frameRate: ASSUMED_FRAME_RATE,
            frameRateDetected: false
        };
    }
}
