import { formatTimecode } from "../utils/format";

export type SeekHandler = (seconds: number) => void;

/** Play/pause button, scrubber and time readout for video. Hidden until a video is loaded. */
export class PlaybackControls {
    readonly element: HTMLElement;
    private readonly playButton: HTMLButtonElement;
    private readonly scrubber: HTMLInputElement;
    private readonly timeLabel: HTMLElement;
    private durationSeconds = 0;
    private onPlayPauseHandler: (() => void) | null = null;
    private onSeekHandler: SeekHandler | null = null;

    constructor() {
        this.element = document.createElement("div");
        this.element.className = "playback-controls";
        this.element.hidden = true;
        this.element.innerHTML = `
            <button type="button" class="playback-button" title="Play / Pause (Space)">Play</button>
            <input type="range" class="playback-scrubber" min="0" max="1" step="0.001" value="0" aria-label="Seek" />
            <span class="playback-time">00:00.000 / 00:00.000</span>
        `;
        this.playButton = this.element.querySelector(".playback-button") as HTMLButtonElement;
        this.scrubber = this.element.querySelector(".playback-scrubber") as HTMLInputElement;
        this.timeLabel = this.element.querySelector(".playback-time") as HTMLElement;

        this.playButton.addEventListener("click", () => this.onPlayPauseHandler?.());
        this.scrubber.addEventListener("input", () => {
            const seconds = Number(this.scrubber.value);
            this.updateTimeLabel(seconds);
            this.onSeekHandler?.(seconds);
        });
    }

    onPlayPause(handler: () => void): void {
        this.onPlayPauseHandler = handler;
    }

    onSeek(handler: SeekHandler): void {
        this.onSeekHandler = handler;
    }

    show(durationSeconds: number): void {
        this.durationSeconds = durationSeconds;
        this.scrubber.max = String(durationSeconds);
        this.setCurrentTime(0);
        this.element.hidden = false;
    }

    hide(): void {
        this.element.hidden = true;
        this.durationSeconds = 0;
        this.setCurrentTime(0);
    }

    /** Pre-analysis locks playback until the analysis is complete. */
    setLocked(locked: boolean, reason = ""): void {
        this.element.classList.toggle("is-locked", locked);
        this.playButton.disabled = locked;
        this.scrubber.disabled = locked;
        this.element.title = locked ? reason : "";
    }

    setPlaying(playing: boolean): void {
        this.playButton.textContent = playing ? "Pause" : "Play";
    }

    setCurrentTime(seconds: number): void {
        this.scrubber.value = String(seconds);
        this.updateTimeLabel(seconds);
    }

    private updateTimeLabel(seconds: number): void {
        this.timeLabel.textContent = `${formatTimecode(seconds)} / ${formatTimecode(this.durationSeconds)}`;
    }
}
