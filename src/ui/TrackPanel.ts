import type { Track } from "../tracking/TrackTypes";
import type { CollapsiblePanel } from "./CollapsiblePanel";
import { makeCollapsible } from "./CollapsiblePanel";

export type TrackSelectHandler = (trackId: number) => void;

export class TrackPanel {
    readonly element: HTMLElement;
    private listEl: HTMLElement;
    private collapsible: CollapsiblePanel;
    private onSelect: TrackSelectHandler | null = null;
    private selectedId: number | null = null;

    constructor() {
        this.element = document.createElement("div");
        this.element.className = "track-panel";
        this.element.innerHTML = `<ul class="track-list"></ul>`;
        this.listEl = this.element.querySelector(".track-list") as HTMLElement;

        // Closed by default — there is nothing to show until a track
        // exists, and App opens this automatically once one is selected.
        this.collapsible = makeCollapsible(this.element, "Tracks", false);
    }

    setOpen(open: boolean): void {
        this.collapsible.setOpen(open);
    }

    onSelectTrack(handler: TrackSelectHandler): void {
        this.onSelect = handler;
    }

    render(tracks: Track[]): void {
        this.listEl.innerHTML = "";

        if (tracks.length === 0) {
            const empty = document.createElement("li");
            empty.className = "track-list-empty";
            empty.textContent = "No tracks yet";
            this.listEl.appendChild(empty);
            return;
        }

        for (const track of tracks) {
            const item = document.createElement("li");
            item.className = `track-list-item track-list-item--${track.status}`;
            item.dataset.trackId = String(track.id);
            if (track.id === this.selectedId) item.classList.add("is-selected");
            const marker = track.status === "lost" ? "×" : "●";
            const statusLabel = track.status === "lost" ? "LOST" : "active";
            item.innerHTML = `
                <span class="track-marker">${marker}</span>
                <span class="track-id">Track ${String(track.id).padStart(2, "0")}</span>
                <span class="track-status">${statusLabel}</span>
                <span class="track-confidence">${(track.confidence * 100).toFixed(0)}%</span>
            `;
            item.addEventListener("click", () => this.onSelect?.(track.id));
            this.listEl.appendChild(item);
        }
    }

    /**
     * Applies a selection made elsewhere (e.g. clicking a blob in the
     * video) without waiting for the next full track-list render:
     * updates the highlighted row in place and scrolls it into view.
     */
    selectTrack(trackId: number | null): void {
        this.selectedId = trackId;

        this.listEl.querySelectorAll<HTMLElement>(".track-list-item").forEach((item) => {
            const isSelected = item.dataset.trackId === String(trackId);
            item.classList.toggle("is-selected", isSelected);
            if (isSelected) item.scrollIntoView({ block: "nearest", behavior: "smooth" });
        });
    }
}
