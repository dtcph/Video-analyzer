import type { Track } from "../tracking/TrackTypes";
import { formatTimecode } from "../utils/timing";

export type SeekHandler = (seconds: number) => void;

/**
 * A temporal data visualization, not a video-editing timeline: it
 * shows playhead position plus a per-track duration lane so track
 * lifespans read as data rather than as editable clips.
 */
export class Timeline {
    readonly element: HTMLElement;

    private scrubber: HTMLInputElement;
    private timeLabel: HTMLElement;
    private tracksLane: HTMLElement;

    private durationSeconds = 0;
    private onSeek: SeekHandler | null = null;

    constructor() {
        this.element = document.createElement("div");
        this.element.className = "timeline";
        this.element.innerHTML = `
            <div class="timeline-scrub-row">
                <input type="range" class="timeline-scrubber" min="0" max="1" step="0.001" value="0" />
                <span class="timeline-time">00:00.000</span>
            </div>
            <div class="timeline-tracks-lane"></div>
        `;

        this.scrubber = this.element.querySelector(".timeline-scrubber") as HTMLInputElement;
        this.timeLabel = this.element.querySelector(".timeline-time") as HTMLElement;
        this.tracksLane = this.element.querySelector(".timeline-tracks-lane") as HTMLElement;

        this.scrubber.addEventListener("input", () => {
            const seconds = Number(this.scrubber.value);
            this.timeLabel.textContent = formatTimecode(seconds);
            this.onSeek?.(seconds);
        });
    }

    onScrub(handler: SeekHandler): void {
        this.onSeek = handler;
    }

    setDuration(seconds: number): void {
        this.durationSeconds = seconds;
        this.scrubber.max = String(seconds);
    }

    setCurrentTime(seconds: number): void {
        this.scrubber.value = String(seconds);
        this.timeLabel.textContent = formatTimecode(seconds);
    }

    renderTracks(tracks: Track[], frameRate: number): void {
        this.tracksLane.innerHTML = "";
        if (this.durationSeconds <= 0) return;

        for (const track of tracks) {
            const startSeconds = track.startFrame / frameRate;
            const endSeconds = track.endFrame / frameRate;
            const leftPct = (startSeconds / this.durationSeconds) * 100;
            const widthPct = ((endSeconds - startSeconds) / this.durationSeconds) * 100;

            const bar = document.createElement("div");
            bar.className = `timeline-track-bar timeline-track-bar--${track.status}`;
            bar.style.left = `${leftPct}%`;
            bar.style.width = `${Math.max(widthPct, 0.3)}%`;
            bar.title = `Track #${track.id} (${(track.confidence * 100).toFixed(0)}% confidence)`;
            this.tracksLane.appendChild(bar);
        }
    }
}
