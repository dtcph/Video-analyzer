import type { PlaybackState, VideoMetadata } from "./MediaTypes";

export type VideoPlayerListener = (state: PlaybackState) => void;

/**
 * Wraps the native <video> element. Owns playback state only; frame
 * capture, inference and rendering live in other modules.
 */
export class VideoPlayer {
    private objectUrl: string | null = null;
    private state: PlaybackState = "empty";
    private metadata: VideoMetadata | null = null;
    private readonly listeners = new Set<VideoPlayerListener>();

    constructor(readonly element: HTMLVideoElement) {
        this.element.playsInline = true;
        this.element.addEventListener("play", () => this.setState("playing"));
        this.element.addEventListener("pause", () => this.setState("paused"));
        this.element.addEventListener("ended", () => this.setState("paused"));
    }

    onStateChange(listener: VideoPlayerListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    getState(): PlaybackState {
        return this.state;
    }

    getMetadata(): VideoMetadata | null {
        return this.metadata;
    }

    async load(file: File): Promise<VideoMetadata> {
        this.release();
        this.setState("loading");

        const objectUrl = URL.createObjectURL(file);
        this.objectUrl = objectUrl;
        this.element.src = objectUrl;
        const decodeError = new Error(
            `Could not decode video: ${file.name}. The file may be corrupt or use an unsupported codec.`
        );

        try {
            await new Promise<void>((resolve, reject) => {
                const cleanup = () => {
                    this.element.removeEventListener("loadedmetadata", onLoaded);
                    this.element.removeEventListener("error", onError);
                };
                const onLoaded = () => {
                    cleanup();
                    resolve();
                };
                const onError = () => {
                    cleanup();
                    reject(decodeError);
                };
                this.element.addEventListener("loadedmetadata", onLoaded);
                this.element.addEventListener("error", onError);
            });

            if (this.element.videoWidth === 0 || this.element.videoHeight === 0) throw decodeError;

            this.metadata = {
                fileName: file.name,
                fileSizeBytes: file.size,
                durationSeconds: this.element.duration,
                width: this.element.videoWidth,
                height: this.element.videoHeight
            };
            this.setState("ready");
            return this.metadata;
        } catch (error) {
            this.unload();
            throw error;
        }
    }

    /** Releases the current video (object URL included) and returns to "empty". */
    unload(): void {
        this.release();
        this.setState("empty");
    }

    play(): void {
        void this.element.play();
    }

    pause(): void {
        this.element.pause();
    }

    togglePlayback(): void {
        if (this.element.paused) this.play();
        else this.pause();
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

    private release(): void {
        if (this.objectUrl) {
            URL.revokeObjectURL(this.objectUrl);
            this.objectUrl = null;
        }
        this.metadata = null;
        this.element.removeAttribute("src");
        this.element.load();
    }

    private setState(state: PlaybackState): void {
        this.state = state;
        for (const listener of this.listeners) listener(state);
    }
}
