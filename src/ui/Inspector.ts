import type { Track } from "../tracking/TrackTypes";
import { averageConfidence, durationInFrames, latestPoint } from "../tracking/Track";
import type { CollapsiblePanel } from "./CollapsiblePanel";
import { makeCollapsible } from "./CollapsiblePanel";

/**
 * Shows detailed data for the currently selected track: position,
 * size, confidence, and duration. Read-only data readout, not an
 * editing panel.
 */
export class Inspector {
    readonly element: HTMLElement;
    private collapsible: CollapsiblePanel;

    constructor() {
        this.element = document.createElement("div");
        this.element.className = "inspector";

        // Closed by default — App opens this automatically once a track
        // is selected, since there's nothing to inspect before then.
        this.collapsible = makeCollapsible(this.element, "Inspector", false);
        this.renderEmpty();
    }

    setOpen(open: boolean): void {
        this.collapsible.setOpen(open);
    }

    private renderEmpty(): void {
        this.collapsible.body.innerHTML = `<p class="inspector-empty">Select a track to inspect its data</p>`;
    }

    show(track: Track | undefined, frameRate: number): void {
        if (!track) {
            this.renderEmpty();
            return;
        }

        const current = latestPoint(track);
        const currentArea = current ? current.width * current.height : null;

        this.collapsible.body.innerHTML = `
            <h3 class="inspector-title">Track #${track.id}</h3>
            <dl class="inspector-fields">
                <dt>Status</dt><dd>${track.status}</dd>
                <dt>Position</dt><dd>${current ? `${(current.x * 100).toFixed(1)}%, ${(current.y * 100).toFixed(1)}%` : "—"}</dd>
                <dt>Size</dt><dd>${current ? `${(current.width * 100).toFixed(1)}% × ${(current.height * 100).toFixed(1)}%` : "—"}</dd>
                <dt>Current area</dt><dd>${currentArea !== null ? `${(currentArea * 100).toFixed(2)}%` : "—"}</dd>
                <dt>Confidence (current)</dt><dd>${current ? `${(current.confidence * 100).toFixed(0)}%` : "—"}</dd>
                <dt>Confidence (avg)</dt><dd>${(averageConfidence(track) * 100).toFixed(0)}%</dd>
                <dt>Duration</dt><dd>${(durationInFrames(track) / frameRate).toFixed(2)}s (${durationInFrames(track)} frames)</dd>
                <dt>Start time</dt><dd>${(track.startFrame / frameRate).toFixed(2)}s</dd>
                <dt>End time</dt><dd>${(track.endFrame / frameRate).toFixed(2)}s</dd>
            </dl>
        `;
    }
}
