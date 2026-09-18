import type { PlaybackState, VideoMetadata } from "./VideoTypes";
import { VideoLoader } from "./VideoLoader";

export type VideoPlayerListener = (state: PlaybackState) => void;

/**
 * Wraps the native <video> element. Owns playback state only —
 * frame extraction, analysis, and rendering live in other modules.
 */
export class VideoPlayer {
    readonly element: HTMLVideoElement;

    private objectUrl: string | null = null;
    private state: PlaybackState = "empty";
    private metadata: VideoMetadata | null = null;
    private listeners: Set<VideoPlayerListener> = new Set();

    constructor(videoElement: HTMLVideoElement) {
        this.element = videoElement;
        this.element.playsInline = true;

        this.element.addEventListener("play", () => this.setState("playing"));
        this.element.addEventListener("pause", () => this.setState("paused"));
        this.element.addEventListener("ended", () => this.setState("paused"));
    }

    onStateChange(listener: VideoPlayerListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private setState(state: PlaybackState): void {
        this.state = state;
        for (const listener of this.listeners) listener(state);
    }

    getState(): PlaybackState {
        return this.state;
    }

    getMetadata(): VideoMetadata | null {
        return this.metadata;
    }

    async load(file: File): Promise<VideoMetadata> {
        this.setState("loading");

        if (this.objectUrl) {
            VideoLoader.revokeObjectUrl(this.objectUrl);
        }

        this.objectUrl = VideoLoader.createObjectUrl(file);
        this.element.src = this.objectUrl;

        await new Promise<void>((resolve, reject) => {
            const onLoaded = () => {
                this.element.removeEventListener("loadedmetadata", onLoaded);
                this.element.removeEventListener("error", onError);
                resolve();
            };
            const onError = () => {
                this.element.removeEventListener("loadedmetadata", onLoaded);
                this.element.removeEventListener("error", onError);
                reject(new Error(`Failed to load video: ${file.name}`));
            };
            this.element.addEventListener("loadedmetadata", onLoaded);
            this.element.addEventListener("error", onError);
        });

        this.metadata = VideoLoader.readMetadata(this.element, file.name);
        this.setState("ready");
        return this.metadata;
    }

    play(): void {
        void this.element.play();
    }

    pause(): void {
        this.element.pause();
    }

    togglePlayback(): void {
        if (this.element.paused) {
            this.play();
        } else {
            this.pause();
        }
    }

    seekToSeconds(seconds: number): void {
        this.element.currentTime = seconds;
    }

    getCurrentSeconds(): number {
        return this.element.currentTime;
    }

    getDurationSeconds(): number {
        return this.element.duration || this.metadata?.durationSeconds || 0;
    }
}
