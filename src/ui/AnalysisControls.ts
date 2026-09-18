import type { LayerVisibility } from "../rendering/VideoRenderer";
import type { ExposureVisibility } from "../rendering/AnalysisOverlay";
import type { AnalysisStats } from "../analysis/AnalysisWorkerClient";
import type { AnalysisSettings, ExposureData } from "../analysis/AnalysisTypes";

export type LayerToggleHandler = (layer: keyof LayerVisibility, enabled: boolean) => void;
export type ExposureModeToggleHandler = (mode: keyof ExposureVisibility, enabled: boolean) => void;
export type ThresholdChangeHandler = (settings: Partial<AnalysisSettings>) => void;
export type PlaybackToggleHandler = () => void;
export type AnalysisToggleHandler = () => void;

/**
 * Toggles for which analysis dimensions are visible — layer
 * visibility, exposure-mode toggles, threshold sliders, plus playback
 * control and worker analysis start/stop. The perf readout is
 * collapsed by default so it doesn't clutter the instrument panel;
 * the exposure numeric readout stays visible since it is the actual
 * extracted data, not just a perf diagnostic.
 */
export class AnalysisControls {
    readonly element: HTMLElement;
    private onLayerToggle: LayerToggleHandler | null = null;
    private onExposureModeToggle: ExposureModeToggleHandler | null = null;
    private onThresholdChange: ThresholdChangeHandler | null = null;
    private onPlaybackToggle: PlaybackToggleHandler | null = null;
    private onAnalysisToggle: AnalysisToggleHandler | null = null;

    constructor() {
        this.element = document.createElement("div");
        this.element.className = "analysis-controls";
        this.element.innerHTML = `
            <div class="analysis-controls-row">
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
            </div>
            <div class="exposure-controls-row">
                <div class="exposure-mode-toggles">
                    <label><input type="checkbox" data-mode="clip" checked /> RGB Clip</label>
                    <label><input type="checkbox" data-mode="highlight" checked /> Highlight</label>
                    <label><input type="checkbox" data-mode="crushedBlacks" checked /> Crushed</label>
                </div>
                <label class="threshold-slider">
                    Highlight threshold
                    <input type="range" data-threshold="highlightThreshold" min="0" max="1" step="0.01" value="0.85" />
                </label>
                <label class="threshold-slider">
                    Shadow threshold
                    <input type="range" data-threshold="shadowThreshold" min="0" max="1" step="0.01" value="0.02" />
                </label>
            </div>
            <div class="exposure-readout">
                <span data-exposure-stat="clip">RGB clipping&nbsp;&nbsp;0.0%</span>
                <span data-exposure-stat="highlight">Luminance highlight&nbsp;&nbsp;0.0%</span>
                <span data-exposure-stat="crushed">Crushed blacks&nbsp;&nbsp;0.0%</span>
            </div>
        `;

        this.element.querySelectorAll<HTMLInputElement>("input[data-layer]").forEach((input) => {
            input.addEventListener("change", () => {
                const layer = input.dataset.layer as keyof LayerVisibility;
                this.onLayerToggle?.(layer, input.checked);
            });
        });

        this.element.querySelectorAll<HTMLInputElement>("input[data-mode]").forEach((input) => {
            input.addEventListener("change", () => {
                const mode = input.dataset.mode as keyof ExposureVisibility;
                this.onExposureModeToggle?.(mode, input.checked);
            });
        });

        this.element.querySelectorAll<HTMLInputElement>("input[data-threshold]").forEach((input) => {
            input.addEventListener("input", () => {
                const key = input.dataset.threshold as keyof AnalysisSettings;
                this.onThresholdChange?.({ [key]: Number(input.value) } as Partial<AnalysisSettings>);
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

    onToggleExposureMode(handler: ExposureModeToggleHandler): void {
        this.onExposureModeToggle = handler;
    }

    onChangeThreshold(handler: ThresholdChangeHandler): void {
        this.onThresholdChange = handler;
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

    updateExposureStats(exposure: ExposureData): void {
        const set = (name: string, text: string) => {
            const el = this.element.querySelector(`[data-exposure-stat="${name}"]`);
            if (el) el.textContent = text;
        };
        set("clip", `RGB clipping  ${(exposure.rgbClipRatio * 100).toFixed(1)}%`);
        set("highlight", `Luminance highlight  ${(exposure.luminanceHighlightRatio * 100).toFixed(1)}%`);
        set("crushed", `Crushed blacks  ${(exposure.crushedBlackRatio * 100).toFixed(1)}%`);
    }
}
