import type { LayerVisibility } from "../rendering/VideoRenderer";
import type { AnalysisVisibility } from "../rendering/AnalysisOverlay";
import type { AnalysisStats } from "../analysis/AnalysisWorkerClient";
import type { ExposureData } from "../analysis/AnalysisTypes";
import type { BlobData } from "../tracking/TrackTypes";
import type { CollapsiblePanel } from "./CollapsiblePanel";
import { makeCollapsible } from "./CollapsiblePanel";

export type LayerToggleHandler = (layer: keyof LayerVisibility, enabled: boolean) => void;
export type ExposureModeToggleHandler = (mode: keyof AnalysisVisibility, enabled: boolean) => void;
export type AnalysisToggleHandler = () => void;

/**
 * Toggles for which analysis dimensions are visible — layer
 * visibility and exposure-view toggles — plus worker analysis
 * start/stop and the live readouts. Detection settings (thresholds,
 * mode, debug) are generated from the settings schema in SettingsPanel. Regular video transport (play/pause/forward/
 * backward) lives in PlaybackControls, below the video stage. The perf
 * readout is collapsed by default so it doesn't clutter the instrument
 * panel; the exposure numeric readout stays visible since it is the
 * actual extracted data, not just a perf diagnostic.
 */
export class AnalysisControls {
    readonly element: HTMLElement;
    private onLayerToggle: LayerToggleHandler | null = null;
    private onExposureModeToggle: ExposureModeToggleHandler | null = null;
    private onAnalysisToggle: AnalysisToggleHandler | null = null;
    private collapsible!: CollapsiblePanel;

    constructor() {
        this.element = document.createElement("div");
        this.element.className = "analysis-controls";
        this.element.innerHTML = `
            <div class="analysis-controls-row">
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
                    <label><input type="checkbox" data-mode="blobs" checked /> Blobs</label>
                </div>
            </div>
            <div class="exposure-readout">
                <span data-exposure-stat="clip">RGB clipping&nbsp;&nbsp;0.0%</span>
                <span data-exposure-stat="highlight">Luminance highlight&nbsp;&nbsp;0.0%</span>
                <span data-exposure-stat="crushed">Crushed blacks&nbsp;&nbsp;0.0%</span>
            </div>
            <div class="blob-stats">
                <span data-blob-stat="count">Detected blobs: 0</span>
                <span data-blob-stat="largest">Largest: —</span>
                <span data-blob-stat="smallest">Smallest: —</span>
                <span data-blob-stat="average">Average: —</span>
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
                const mode = input.dataset.mode as keyof AnalysisVisibility;
                this.onExposureModeToggle?.(mode, input.checked);
            });
        });




        this.analysisToggleButton.addEventListener("click", () => this.onAnalysisToggle?.());

        this.collapsible = makeCollapsible(this.element, "Analysis", true);
    }

    setOpen(open: boolean): void {
        this.collapsible.setOpen(open);
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


    onToggleAnalysis(handler: AnalysisToggleHandler): void {
        this.onAnalysisToggle = handler;
    }

    /**
     * Resets every widget in this panel to its shipped default — layer and
     * exposure-view checkboxes back to checked, stat readouts cleared. Only
     * touches the DOM; App owns resetting the renderer. Detection settings
     * live in SettingsPanel/SettingsStore.
     */
    resetToDefaults(): void {
        this.element.querySelectorAll<HTMLInputElement>("input[data-layer], input[data-mode]").forEach((input) => {
            input.checked = true;
        });
        this.element.querySelectorAll("[data-stat]").forEach((el) => (el.textContent = ""));
        this.element.querySelectorAll("[data-exposure-stat]").forEach((el) => (el.textContent = ""));
        this.updateBlobStats([]);
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


    updateBlobStats(blobs: BlobData[]): void {
        const set = (name: string, text: string) => {
            const el = this.element.querySelector(`[data-blob-stat="${name}"]`);
            if (el) el.textContent = text;
        };

        set("count", `Detected blobs: ${blobs.length}`);

        if (blobs.length === 0) {
            set("largest", "Largest: —");
            set("smallest", "Smallest: —");
            set("average", "Average: —");
            return;
        }

        const areas = blobs.map((blob) => blob.area);
        const largest = Math.max(...areas);
        const smallest = Math.min(...areas);
        const average = areas.reduce((sum, area) => sum + area, 0) / areas.length;

        set("largest", `Largest: ${largest.toLocaleString(undefined, { maximumFractionDigits: 0 })} px`);
        set("smallest", `Smallest: ${smallest.toLocaleString(undefined, { maximumFractionDigits: 0 })} px`);
        set("average", `Average: ${average.toLocaleString(undefined, { maximumFractionDigits: 0 })} px`);
    }
}
