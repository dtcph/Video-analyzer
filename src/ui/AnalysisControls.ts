import type { LayerVisibility } from "../rendering/VideoRenderer";
import type { AnalysisStats } from "../analysis/AnalysisWorkerClient";

export type LayerToggleHandler = (layer: keyof LayerVisibility, enabled: boolean) => void;
export type PlaybackToggleHandler = () => void;
export type AnalysisToggleHandler = () => void;

/**
 * Toggles for which analysis dimensions are visible — layer
 * visibility, plus playback control and worker analysis start/stop.
 * Analysis-parameter tuning (thresholds, etc.) will grow here
 * alongside blob detection. The perf readout is collapsed by default
 * so it doesn't clutter the instrument panel.
 */
export class AnalysisControls {
    readonly element: HTMLElement;
    private onLayerToggle: LayerToggleHandler | null = null;
    private onPlaybackToggle: PlaybackToggleHandler | null = null;
    private onAnalysisToggle: AnalysisToggleHandler | null = null;

    constructor() {
        this.element = document.createElement("div");
        this.element.className = "analysis-controls";
        this.element.innerHTML = `
            <button type="button" class="play-pause-button" disabled>Play</button>
            <button type="button" class="analysis-toggle-button" disabled>Start Analysis</button>
            <div class="layer-toggles">
                <label><input type="checkbox" data-layer="analysis" checked /> Exposure</label>
                <label><input type="checkbox" data-layer="tracking" checked /> Tracking</label>
                <label><input type="checkbox" data-layer="annotations" checked /> Labels</label>
            </div>
            <details class="analysis-stats">
                <summary>Perf</summary>
                <div class="analysis-stats-body">
                    <span data-stat="processed">processed 0</span>
                    <span data-stat="dropped">dropped 0</span>
                    <span data-stat="time">0.0ms</span>
                    <span data-stat="fps">0.0 fps</span>
                </div>
            </details>
        `;

        this.element.querySelectorAll<HTMLInputElement>("input[data-layer]").forEach((input) => {
            input.addEventListener("change", () => {
                const layer = input.dataset.layer as keyof LayerVisibility;
                this.onLayerToggle?.(layer, input.checked);
            });
        });

        this.playPauseButton.addEventListener("click", () => this.onPlaybackToggle?.());
        this.analysisToggleButton.addEventListener("click", () => this.onAnalysisToggle?.());
    }

    private get playPauseButton(): HTMLButtonElement {
        return this.element.querySelector(".play-pause-button") as HTMLButtonElement;
    }

    private get analysisToggleButton(): HTMLButtonElement {
        return this.element.querySelector(".analysis-toggle-button") as HTMLButtonElement;
    }

    onToggleLayer(handler: LayerToggleHandler): void {
        this.onLayerToggle = handler;
    }

    onTogglePlayback(handler: PlaybackToggleHandler): void {
        this.onPlaybackToggle = handler;
    }

    onToggleAnalysis(handler: AnalysisToggleHandler): void {
        this.onAnalysisToggle = handler;
    }

    setPlaybackEnabled(enabled: boolean): void {
        this.playPauseButton.disabled = !enabled;
    }

    setPlaybackLabel(label: "Play" | "Pause"): void {
        this.playPauseButton.textContent = label;
    }

    setAnalysisEnabled(enabled: boolean): void {
        this.analysisToggleButton.disabled = !enabled;
    }

    setAnalysisLabel(label: "Start Analysis" | "Stop Analysis"): void {
        this.analysisToggleButton.textContent = label;
    }

    updateStats(stats: AnalysisStats): void {
        const set = (name: string, text: string) => {
            const el = this.element.querySelector(`[data-stat="${name}"]`);
            if (el) el.textContent = text;
        };
        set("processed", `processed ${stats.framesProcessed}`);
        set("dropped", `dropped ${stats.framesDropped}`);
        set("time", `${stats.lastProcessingTimeMs.toFixed(1)}ms`);
        set("fps", `${stats.processingFps.toFixed(1)} fps`);
    }
}
