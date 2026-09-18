import type { TrackingSettings } from "../tracking/TrackTypes";
import { DEFAULT_TRACKING_SETTINGS } from "../tracking/TrackTypes";
import type { CollapsiblePanel } from "./CollapsiblePanel";
import { makeCollapsible } from "./CollapsiblePanel";

export type TrackingSettingsChangeHandler = (partial: Partial<TrackingSettings>) => void;

/**
 * Exposes the tracker's association/lifecycle thresholds as sliders —
 * separate from AnalysisControls, which governs per-frame blob
 * detection rather than how blobs get associated into tracks over
 * time.
 */
export class TrackingControls {
    readonly element: HTMLElement;
    private onChange: TrackingSettingsChangeHandler | null = null;
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
        `;

        this.element.querySelectorAll<HTMLInputElement>("input[data-tracking]").forEach((input) => {
            input.addEventListener("input", () => {
                const key = input.dataset.tracking as keyof TrackingSettings;
                this.onChange?.({ [key]: Number(input.value) } as Partial<TrackingSettings>);
            });
        });

        this.collapsible = makeCollapsible(this.element, "Tracking", true);
    }

    onSettingsChange(handler: TrackingSettingsChangeHandler): void {
        this.onChange = handler;
    }

    setOpen(open: boolean): void {
        this.collapsible.setOpen(open);
    }
}
