import type { Track } from "../tracking/TrackTypes";

export type TrackSelectHandler = (trackId: number) => void;

export class TrackPanel {
    readonly element: HTMLElement;
    private listEl: HTMLElement;
    private onSelect: TrackSelectHandler | null = null;
    private selectedId: number | null = null;

    constructor() {
        this.element = document.createElement("div");
        this.element.className = "track-panel";
        this.element.innerHTML = `
            <h3 class="track-panel-title">Tracks</h3>
            <ul class="track-list"></ul>
        `;
        this.listEl = this.element.querySelector(".track-list") as HTMLElement;
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
            if (track.id === this.selectedId) item.classList.add("is-selected");
            item.innerHTML = `
                <span class="track-id">#${track.id}</span>
                <span class="track-status">${track.status}</span>
                <span class="track-confidence">${(track.confidence * 100).toFixed(0)}%</span>
            `;
            item.addEventListener("click", () => {
                this.selectedId = track.id;
                this.onSelect?.(track.id);
            });
            this.listEl.appendChild(item);
        }
    }
}
