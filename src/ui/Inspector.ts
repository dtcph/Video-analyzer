import type { Track } from "../tracking/TrackTypes";
import { averageConfidence, durationInFrames, latestPoint } from "../tracking/Track";

/**
 * Shows detailed data for the currently selected track: position,
 * size, confidence, and duration. Read-only data readout, not an
 * editing panel.
 */
export class Inspector {
    readonly element: HTMLElement;

    constructor() {
        this.element = document.createElement("div");
        this.element.className = "inspector";
        this.renderEmpty();
    }

    private renderEmpty(): void {
        this.element.innerHTML = `<p class="inspector-empty">Select a track to inspect its data</p>`;
    }

    show(track: Track | undefined, frameRate: number): void {
        if (!track) {
            this.renderEmpty();
            return;
        }

        const current = latestPoint(track);

        this.element.innerHTML = `
            <h3 class="inspector-title">Track #${track.id}</h3>
            <dl class="inspector-fields">
                <dt>Status</dt><dd>${track.status}</dd>
                <dt>Position</dt><dd>${current ? `${(current.x * 100).toFixed(1)}%, ${(current.y * 100).toFixed(1)}%` : "—"}</dd>
                <dt>Size</dt><dd>${current ? `${(current.width * 100).toFixed(1)}% × ${(current.height * 100).toFixed(1)}%` : "—"}</dd>
                <dt>Confidence (avg)</dt><dd>${(averageConfidence(track) * 100).toFixed(0)}%</dd>
                <dt>Duration</dt><dd>${(durationInFrames(track) / frameRate).toFixed(2)}s (${durationInFrames(track)} frames)</dd>
                <dt>Start / End frame</dt><dd>${track.startFrame} / ${track.endFrame}</dd>
            </dl>
        `;
    }
}
