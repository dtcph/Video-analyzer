export type PlayPauseHandler = () => void;
export type PlayForwardHandler = () => void;
// export type PlayBackwardHandler = () => void;

/**
 * Regular video transport — play/pause, step forward — rendered below
 * the video stage once a video is loaded. Playback is native <video>
 * playback. Mirrors the spacebar/K (play-pause), L (forward) keyboard
 * bindings wired in App. (Backward playback is disabled — not needed
 * currently.)
 */
export class PlaybackControls {
    readonly element: HTMLElement;
    private onPlayPauseHandler: PlayPauseHandler | null = null;
    private onForwardHandler: PlayForwardHandler | null = null;
    // private onBackwardHandler: PlayBackwardHandler | null = null;

    constructor() {
        this.element = document.createElement("div");
        this.element.className = "playback-controls";
        this.element.hidden = true;
        this.element.innerHTML = `
            <button type="button" class="playback-button playback-play-pause-button" title="Play / Pause (Space, K)">Play</button>
            <button type="button" class="playback-button playback-forward-button" title="Play forward (L)">Forward ►►</button>
        `;
        // <button type="button" class="playback-button playback-backward-button" title="Play backward (J)">◄◄ Backward</button>

        // this.backwardButton.addEventListener("click", () => this.onBackwardHandler?.());
        this.playPauseButton.addEventListener("click", () => this.onPlayPauseHandler?.());
        this.forwardButton.addEventListener("click", () => this.onForwardHandler?.());
    }

    // private get backwardButton(): HTMLButtonElement {
    //     return this.element.querySelector(".playback-backward-button") as HTMLButtonElement;
    // }

    private get playPauseButton(): HTMLButtonElement {
        return this.element.querySelector(".playback-play-pause-button") as HTMLButtonElement;
    }

    private get forwardButton(): HTMLButtonElement {
        return this.element.querySelector(".playback-forward-button") as HTMLButtonElement;
    }

    onPlayPause(handler: PlayPauseHandler): void {
        this.onPlayPauseHandler = handler;
    }

    onPlayForward(handler: PlayForwardHandler): void {
        this.onForwardHandler = handler;
    }

    // onPlayBackward(handler: PlayBackwardHandler): void {
    //     this.onBackwardHandler = handler;
    // }

    setEnabled(enabled: boolean): void {
        this.element.hidden = !enabled;
        // this.backwardButton.disabled = !enabled;
        this.playPauseButton.disabled = !enabled;
        this.forwardButton.disabled = !enabled;
    }

    setPlaybackLabel(label: "Play" | "Pause"): void {
        this.playPauseButton.textContent = label;
    }
}
