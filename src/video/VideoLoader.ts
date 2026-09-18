import type { VideoMetadata } from "./VideoTypes";

const ASSUMED_FRAME_RATE = 30;

export class VideoLoader {
    static isSupported(file: File): boolean {
        return file.type.startsWith("video/");
    }

    static createObjectUrl(file: File): string {
        return URL.createObjectURL(file);
    }

    static revokeObjectUrl(url: string): void {
        URL.revokeObjectURL(url);
    }

    static readMetadata(video: HTMLVideoElement, fileName: string): VideoMetadata {
        return {
            fileName,
            durationSeconds: video.duration,
            width: video.videoWidth,
            height: video.videoHeight,
            frameRate: ASSUMED_FRAME_RATE
        };
    }
}
