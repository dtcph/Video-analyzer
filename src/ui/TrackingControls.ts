import type { TrackingSettings } from "../tracking/TrackTypes";
import { DEFAULT_TRACKING_SETTINGS } from "../tracking/TrackTypes";
import { trackerLogger } from "../tracking/TrackerLogger";
import type { CollapsiblePanel } from "./CollapsiblePanel";
import { makeCollapsible } from "./CollapsiblePanel";

export type TrackingSettingsChangeHandler = (partial: Partial<TrackingSettings>) => void;
export type DebugToggleHandler = (enabled: boolean) => void;

/**
 * Exposes the tracker's association/lifecycle thresholds as sliders —
 * separate from AnalysisControls, which governs per-frame blob
 * detection rather than how blobs get associated into tracks over
 * time. Includes reidentification/merge tuning (how long and how close
 * a lost track can be revived, when it's abandoned instead, when two
 * simultaneous tracks count as duplicates), prediction/camera-motion
 * tuning, and toggles for the tracker's debug visualization and
 * structured console logging (see TrackingOverlay's debug mode and
 * TrackerLogger) alongside the original match/loss thresholds.
 */
export class TrackingControls {
    readonly element: HTMLElement;
    private onChange: TrackingSettingsChangeHandler | null = null;
    private onDebugToggle: DebugToggleHandler | null = null;
    private collapsible: CollapsiblePanel;

    constructor() {
        this.element = document.createElement("div");
        this.element.className = "tracking-controls";
        this.element.innerHTML = `
            <label class="threshold-slider">
                Match threshold
                <input type="range" data-tracking="matchThreshold" min="0" max="1" step="0.01"
                    value="${DEFAULT_TRACKING_SETTINGS.matchThreshold}" />
            </label>
            <label class="threshold-slider">
                Loss threshold
                <input type="range" data-tracking="lossThreshold" min="0" max="1" step="0.01"
                    value="${DEFAULT_TRACKING_SETTINGS.lossThreshold}" />
            </label>
            <label class="threshold-slider">
                Max frames lost
                <input type="range" data-tracking="maxFramesLost" min="1" max="30" step="1"
                    value="${DEFAULT_TRACKING_SETTINGS.maxFramesLost}" />
            </label>
            <label class="threshold-slider">
                Confirmation frames
                <input type="range" data-tracking="confirmationFrames" min="1" max="10" step="1"
                    value="${DEFAULT_TRACKING_SETTINGS.confirmationFrames}" />
            </label>
            <label class="threshold-slider">
                Reidentify window (frames)
                <input type="range" data-tracking="reidentifyWindowFrames" min="0" max="150" step="1"
                    value="${DEFAULT_TRACKING_SETTINGS.reidentifyWindowFrames}" />
            </label>
            <label class="threshold-slider">
                Reidentify distance
                <input type="range" data-tracking="reidentifyDistance" min="0" max="0.4" step="0.005"
                    value="${DEFAULT_TRACKING_SETTINGS.reidentifyDistance}" />
            </label>
            <label class="threshold-slider">
                Max reidentify distance
                <input type="range" data-tracking="maxReidentifyDistance" min="0" max="0.6" step="0.005"
                    value="${DEFAULT_TRACKING_SETTINGS.maxReidentifyDistance}" />
            </label>
            <label class="threshold-slider">
                Edge margin
                <input type="range" data-tracking="edgeMargin" min="0" max="0.15" step="0.005"
                    value="${DEFAULT_TRACKING_SETTINGS.edgeMargin}" />
            </label>
            <label class="threshold-slider">
                Merge distance
                <input type="range" data-tracking="mergeDistance" min="0" max="0.2" step="0.005"
                    value="${DEFAULT_TRACKING_SETTINGS.mergeDistance}" />
            </label>
            <div class="tracking-section-label">Association weights</div>
            <label class="threshold-slider">
                Aspect weight
                <input type="range" data-tracking="weightAspect" min="0" max="1" step="0.01"
                    value="${DEFAULT_TRACKING_SETTINGS.weightAspect}" />
            </label>
            <div class="tracking-section-label">Prediction &amp; camera motion</div>
            <label class="threshold-slider">
                Stability tightening
                <input type="range" data-tracking="stabilityTightening" min="0" max="1" step="0.01"
                    value="${DEFAULT_TRACKING_SETTINGS.stabilityTightening}" />
            </label>
            <label class="threshold-slider">
                Min radius fraction
                <input type="range" data-tracking="minRadiusFraction" min="0.05" max="1" step="0.01"
                    value="${DEFAULT_TRACKING_SETTINGS.minRadiusFraction}" />
            </label>
            <label class="threshold-slider">
                Max association distance
                <input type="range" data-tracking="maxAssociationDistance" min="0.05" max="0.6" step="0.005"
                    value="${DEFAULT_TRACKING_SETTINGS.maxAssociationDistance}" />
            </label>
            <label class="threshold-slider">
                Camera shake radius boost
                <input type="range" data-tracking="cameraShakeRadiusBoost" min="1" max="4" step="0.1"
                    value="${DEFAULT_TRACKING_SETTINGS.cameraShakeRadiusBoost}" />
            </label>
            <label class="threshold-slider">
                Camera motion sensitivity
                <input type="range" data-tracking="cameraMotionSensitivity" min="1.1" max="5" step="0.1"
                    value="${DEFAULT_TRACKING_SETTINGS.cameraMotionSensitivity}" />
            </label>
            <div class="tracking-section-label">Debugging</div>
            <label class="tracking-debug-toggle">
                <input type="checkbox" data-debug="view" />
                Debug view (prediction, gate, velocity, camera vector)
            </label>
            <label class="tracking-debug-toggle">
                <input type="checkbox" data-debug="log" />
                Debug logging (console)
            </label>
        `;

        this.element.querySelectorAll<HTMLInputElement>("input[data-tracking]").forEach((input) => {
            input.addEventListener("input", () => {
                const key = input.dataset.tracking as keyof TrackingSettings;
                this.onChange?.({ [key]: Number(input.value) } as Partial<TrackingSettings>);
            });
        });

        const viewToggle = this.element.querySelector<HTMLInputElement>('input[data-debug="view"]');
        viewToggle?.addEventListener("change", () => this.onDebugToggle?.(viewToggle.checked));

        const logToggle = this.element.querySelector<HTMLInputElement>('input[data-debug="log"]');
        logToggle?.addEventListener("change", () => trackerLogger.setEnabled(logToggle.checked));

        this.collapsible = makeCollapsible(this.element, "Tracking", true);
    }

    onSettingsChange(handler: TrackingSettingsChangeHandler): void {
        this.onChange = handler;
    }

    /** Fires when the "Debug view" checkbox changes — App wires this to VideoRenderer.setDebugMode. */
    onDebugViewToggle(handler: DebugToggleHandler): void {
        this.onDebugToggle = handler;
    }

    setOpen(open: boolean): void {
        this.collapsible.setOpen(open);
    }
}
