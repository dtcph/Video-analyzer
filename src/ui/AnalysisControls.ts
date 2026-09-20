import type { LayerVisibility } from "../rendering/VideoRenderer";
import type { AnalysisVisibility } from "../rendering/AnalysisOverlay";
import type { AnalysisStats } from "../analysis/AnalysisWorkerClient";
import type { AnalysisSettings, DetectorDebugInfo, ExposureData } from "../analysis/AnalysisTypes";
import { DEFAULT_ANALYSIS_SETTINGS } from "../analysis/AnalysisTypes";
import type { BlobData } from "../tracking/TrackTypes";
import type { CollapsiblePanel } from "./CollapsiblePanel";
import { makeCollapsible } from "./CollapsiblePanel";

export type LayerToggleHandler = (layer: keyof LayerVisibility, enabled: boolean) => void;
export type ExposureModeToggleHandler = (mode: keyof AnalysisVisibility, enabled: boolean) => void;
export type ThresholdChangeHandler = (settings: Partial<AnalysisSettings>) => void;
export type AnalysisToggleHandler = () => void;

/**
 * Toggles for which analysis dimensions are visible — layer
 * visibility, exposure-mode toggles, threshold sliders, plus worker
 * analysis start/stop. Regular video transport (play/pause/forward/
 * backward) lives in PlaybackControls, below the video stage. The perf
 * readout is collapsed by default so it doesn't clutter the instrument
 * panel; the exposure numeric readout stays visible since it is the
 * actual extracted data, not just a perf diagnostic.
 */
export class AnalysisControls {
    readonly element: HTMLElement;
    private onLayerToggle: LayerToggleHandler | null = null;
    private onExposureModeToggle: ExposureModeToggleHandler | null = null;
    private onThresholdChange: ThresholdChangeHandler | null = null;
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
            <div class="blob-controls-row">
                <label class="threshold-slider">
                    Motion threshold
                    <input type="range" data-threshold="threshold" min="0" max="1" step="0.01" value="${DEFAULT_ANALYSIS_SETTINGS.threshold}" />
                </label>
                <label class="threshold-slider">
                    Min area
                    <input type="range" data-threshold="minBlobArea" min="0" max="0.02" step="0.0001" value="${DEFAULT_ANALYSIS_SETTINGS.minBlobArea}" />
                </label>
                <label class="threshold-slider">
                    Max area
                    <input type="range" data-threshold="maxBlobArea" min="0" max="1" step="0.01" value="${DEFAULT_ANALYSIS_SETTINGS.maxBlobArea}" />
                </label>
                <label class="threshold-slider">
                    Morphology
                    <input type="range" data-threshold="morphologyStrength" min="0" max="5" step="1" value="${DEFAULT_ANALYSIS_SETTINGS.morphologyStrength}" />
                </label>
                <label class="threshold-slider">
                    Blur
                    <input type="range" data-threshold="blurRadius" min="0" max="10" step="1" value="${DEFAULT_ANALYSIS_SETTINGS.blurRadius}" />
                </label>
            </div>
            <div class="blob-stats">
                <span data-blob-stat="count">Detected blobs: 0</span>
                <span data-blob-stat="largest">Largest: —</span>
                <span data-blob-stat="smallest">Smallest: —</span>
                <span data-blob-stat="average">Average: —</span>
            </div>
            <div class="tracking-section-label">Camera motion &amp; small objects</div>
            <div class="detector-debug-row">
                <label><input type="checkbox" data-setting="cameraCompensationEnabled" ${DEFAULT_ANALYSIS_SETTINGS.cameraCompensationEnabled ? "checked" : ""} /> Camera compensation</label>
                <label><input type="checkbox" data-setting="smallObjectDetectionEnabled" ${DEFAULT_ANALYSIS_SETTINGS.smallObjectDetectionEnabled ? "checked" : ""} /> Small-object detection</label>
                <label><input type="checkbox" data-setting="detectorDebugEnabled" ${DEFAULT_ANALYSIS_SETTINGS.detectorDebugEnabled ? "checked" : ""} /> Detector debug (compute)</label>
            </div>
            <div class="detector-debug-row">
                <label><input type="checkbox" data-mode="rawDiff" /> Raw diff</label>
                <label><input type="checkbox" data-mode="compensatedDiff" /> Compensated diff</label>
                <label><input type="checkbox" data-mode="motionMask" /> Motion mask</label>
                <label><input type="checkbox" data-mode="rejectedCandidates" /> Rejected candidates</label>
            </div>
            <div class="detector-debug-readout" data-camera-motion-readout>Camera motion: —</div>
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

        this.element.querySelectorAll<HTMLInputElement>("input[data-threshold]").forEach((input) => {
            input.addEventListener("input", () => {
                const key = input.dataset.threshold as keyof AnalysisSettings;
                this.onThresholdChange?.({ [key]: Number(input.value) } as Partial<AnalysisSettings>);
            });
        });

        this.element.querySelectorAll<HTMLInputElement>("input[data-setting]").forEach((input) => {
            input.addEventListener("change", () => {
                const key = input.dataset.setting as keyof AnalysisSettings;
                this.onThresholdChange?.({ [key]: input.checked } as Partial<AnalysisSettings>);
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

    onChangeThreshold(handler: ThresholdChangeHandler): void {
        this.onThresholdChange = handler;
    }

    onToggleAnalysis(handler: AnalysisToggleHandler): void {
        this.onAnalysisToggle = handler;
    }

    /**
     * Resets every widget in this panel to its shipped default — layer/
     * exposure-mode checkboxes back to checked, threshold sliders back
     * to DEFAULT_ANALYSIS_SETTINGS, and the stat readouts cleared. Only
     * touches the DOM; App owns pushing the corresponding default
     * settings into AnalysisEngine/AnalysisWorkerClient/VideoRenderer.
     */
    resetToDefaults(): void {
        this.element.querySelectorAll<HTMLInputElement>("input[data-layer]").forEach((input) => {
            input.checked = true;
        });
        // The exposure-mode checkboxes default checked; the detector-debug
        // view checkboxes (also data-mode, see AnalysisVisibility) default
        // unchecked — both live under the same attribute since they're
        // wired through the same onToggleExposureMode handler.
        this.element.querySelectorAll<HTMLInputElement>('input[data-mode="clip"], input[data-mode="highlight"], input[data-mode="crushedBlacks"], input[data-mode="blobs"]').forEach((input) => {
            input.checked = true;
        });
        this.element
            .querySelectorAll<HTMLInputElement>(
                'input[data-mode="rawDiff"], input[data-mode="compensatedDiff"], input[data-mode="motionMask"], input[data-mode="rejectedCandidates"]'
            )
            .forEach((input) => {
                input.checked = false;
            });
        this.element.querySelectorAll<HTMLInputElement>("input[data-threshold]").forEach((input) => {
            const key = input.dataset.threshold as keyof AnalysisSettings;
            input.value = String(DEFAULT_ANALYSIS_SETTINGS[key]);
        });
        this.element.querySelectorAll<HTMLInputElement>("input[data-setting]").forEach((input) => {
            const key = input.dataset.setting as keyof AnalysisSettings;
            input.checked = Boolean(DEFAULT_ANALYSIS_SETTINGS[key]);
        });
        this.element.querySelectorAll("[data-stat]").forEach((el) => (el.textContent = ""));
        this.element.querySelectorAll("[data-exposure-stat]").forEach((el) => (el.textContent = ""));
        this.updateBlobStats([]);
        this.updateDetectorDebug(undefined);
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

    /** Text readout of this frame's global-motion estimate — pass undefined when detector debug isn't enabled or no frame has been analyzed yet. */
    updateDetectorDebug(debug: DetectorDebugInfo | undefined): void {
        const el = this.element.querySelector("[data-camera-motion-readout]");
        if (!el) return;
        if (!debug) {
            el.textContent = "Camera motion: —";
            return;
        }
        const { dx, dy, confidence, valid } = debug.globalMotion;
        el.textContent = `Camera motion: dx ${dx.toFixed(1)}px dy ${dy.toFixed(1)}px confidence ${confidence.toFixed(2)} ${valid ? "(compensating)" : "(not compensating)"}`;
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
