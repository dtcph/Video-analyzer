import type { LayerVisibility } from "../rendering/VideoRenderer";

export type LayerToggleHandler = (layer: keyof LayerVisibility, enabled: boolean) => void;
export type PlaybackToggleHandler = () => void;

/**
 * Toggles for which analysis dimensions are visible — layer
 * visibility, plus playback control. Analysis-parameter tuning
 * (thresholds, etc.) will grow here alongside blob detection.
 */
export class AnalysisControls {
    readonly element: HTMLElement;
    private onLayerToggle: LayerToggleHandler | null = null;
    private onPlaybackToggle: PlaybackToggleHandler | null = null;

    constructor() {
        this.element = document.createElement("div");
        this.element.className = "analysis-controls";
        this.element.innerHTML = `
            <button type="button" class="play-pause-button" disabled>Play</button>
            <div class="layer-toggles">
                <label><input type="checkbox" data-layer="analysis" checked /> Exposure</label>
                <label><input type="checkbox" data-layer="tracking" checked /> Tracking</label>
                <label><input type="checkbox" data-layer="annotations" checked /> Labels</label>
            </div>
        `;

        this.element.querySelectorAll<HTMLInputElement>("input[data-layer]").forEach((input) => {
            input.addEventListener("change", () => {
                const layer = input.dataset.layer as keyof LayerVisibility;
                this.onLayerToggle?.(layer, input.checked);
            });
        });

        this.playPauseButton.addEventListener("click", () => this.onPlaybackToggle?.());
    }

    private get playPauseButton(): HTMLButtonElement {
        return this.element.querySelector(".play-pause-button") as HTMLButtonElement;
    }

    onToggleLayer(handler: LayerToggleHandler): void {
        this.onLayerToggle = handler;
    }

    onTogglePlayback(handler: PlaybackToggleHandler): void {
        this.onPlaybackToggle = handler;
    }

    setPlaybackEnabled(enabled: boolean): void {
        this.playPauseButton.disabled = !enabled;
    }

    setPlaybackLabel(label: "Play" | "Pause"): void {
        this.playPauseButton.textContent = label;
    }
}
