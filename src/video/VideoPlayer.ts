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

    // Manual reverse-scrub loop (see playBackward) — HTMLMediaElement
    // doesn't support negative playbackRate across browsers, so
    // backward playback is implemented by decrementing currentTime on
    // a rAF loop instead. The native element stays paused throughout,
    // so the native "pause" event must be ignored while this is active
    // or it would immediately overwrite the "playing-reverse" state.
    // Backward playback is disabled — not needed currently.
    // private reverseRafHandle: number | null = null;
    // private reverseLastTimestamp: number | null = null;
    // private manualReverseActive = false;

    constructor(videoElement: HTMLVideoElement) {
        this.element = videoElement;
        this.element.playsInline = true;

        this.element.addEventListener("play", () => {
            // this.manualReverseActive = false;
            this.setState("playing");
        });
        this.element.addEventListener("pause", () => {
            // if (this.manualReverseActive) return;
            this.setState("paused");
        });
        this.element.addEventListener("ended", () => {
            // this.manualReverseActive = false;
            this.setState("paused");
        });
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
        // this.stopReversePlayback();
        this.setState("loading");

        if (this.objectUrl) {
            VideoLoader.revokeObjectUrl(this.objectUrl);
            this.objectUrl = null;
        }
        this.metadata = null;

        const objectUrl = VideoLoader.createObjectUrl(file);
        this.objectUrl = objectUrl;
        this.element.src = objectUrl;

        try {
            await new Promise<void>((resolve, reject) => {
                const onLoaded = () => {
                    cleanup();
                    resolve();
                };
                const onError = () => {
                    cleanup();
                    reject(new Error(`Could not decode video: ${file.name}. The file may be corrupt or use an unsupported codec.`));
                };
                const cleanup = () => {
                    this.element.removeEventListener("loadedmetadata", onLoaded);
                    this.element.removeEventListener("error", onError);
                };
                this.element.addEventListener("loadedmetadata", onLoaded);
                this.element.addEventListener("error", onError);
            });

            if (this.element.videoWidth === 0 || this.element.videoHeight === 0) {
                throw new Error(`Could not decode video: ${file.name}. The file may be corrupt or use an unsupported codec.`);
            }

            this.metadata = VideoLoader.readMetadata(this.element, file);
            this.setState("ready");
            return this.metadata;
        } catch (error) {
            VideoLoader.revokeObjectUrl(objectUrl);
            this.objectUrl = null;
            this.element.removeAttribute("src");
            this.element.load();
            this.setState("empty");
            throw error;
        }
    }

    /**
     * Releases the current video entirely — revokes its object URL and
     * drops the element back to empty, so a fresh upload can take its
     * place. Mirrors the cleanup `load()` already does on a failed
     * load, just triggered directly rather than by an error.
     */
    unload(): void {
        if (this.objectUrl) {
            VideoLoader.revokeObjectUrl(this.objectUrl);
            this.objectUrl = null;
        }
        this.metadata = null;
        this.element.removeAttribute("src");
        this.element.load();
        this.setState("empty");
    }

    play(): void {
        // this.stopReversePlayback();
        void this.element.play();
    }

    pause(): void {
        // const wasReversing = this.reverseRafHandle !== null;
        // this.stopReversePlayback();
        this.element.pause();
        // If we were reversing, the element was already paused the whole
        // time, so calling pause() again is a no-op and fires no native
        // "pause" event — set the state explicitly instead.
        // if (wasReversing) this.setState("paused");
    }

    togglePlayback(): void {
        if (!this.element.paused) {
            this.pause();
        } else {
            this.play();
        }
    }

    // /**
    //  * Plays backward from the current position by decrementing
    //  * currentTime on a rAF loop (see class-level comment). Holds at
    //  * frame 0 rather than looping or erroring once it gets there.
    //  */
    // playBackward(): void {
    //     if (this.reverseRafHandle !== null) return;
    //
    //     if (!this.element.paused) {
    //         this.manualReverseActive = true;
    //         this.element.pause();
    //     }
    //
    //     if (this.element.currentTime <= 0) {
    //         this.manualReverseActive = false;
    //         this.setState("paused");
    //         return;
    //     }
    //
    //     this.setState("playing-reverse");
    //     this.reverseLastTimestamp = null;
    //
    //     const step = (timestamp: number) => {
    //         if (this.reverseLastTimestamp === null) this.reverseLastTimestamp = timestamp;
    //         const deltaSeconds = (timestamp - this.reverseLastTimestamp) / 1000;
    //         this.reverseLastTimestamp = timestamp;
    //
    //         const next = this.element.currentTime - deltaSeconds;
    //         if (next <= 0) {
    //             this.element.currentTime = 0;
    //             this.stopReversePlayback();
    //             this.setState("paused");
    //             return;
    //         }
    //
    //         this.element.currentTime = next;
    //         this.reverseRafHandle = requestAnimationFrame(step);
    //     };
    //
    //     this.reverseRafHandle = requestAnimationFrame(step);
    // }
    //
    // private stopReversePlayback(): void {
    //     if (this.reverseRafHandle !== null) {
    //         cancelAnimationFrame(this.reverseRafHandle);
    //         this.reverseRafHandle = null;
    //     }
    //     this.reverseLastTimestamp = null;
    //     this.manualReverseActive = false;
    // }

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
