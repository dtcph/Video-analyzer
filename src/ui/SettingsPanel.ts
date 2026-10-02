import type { DetectorDebugInfo } from "../analysis/AnalysisTypes";
import type { AnalysisModeId, MovingSubMode } from "../settings/AnalysisModes";
import { MOVING_SUB_MODES, SUB_MODE_LABELS, cameraKindOf, movingMode, subModeOf } from "../settings/AnalysisModes";
import type { AnySettingDef, DebugViewKey, NumberDef, SchemaKey, SettingGroup } from "../settings/SettingsSchema";
import { DEBUG_VIEWS, SCHEMA_KEYS, appliesToMode, settingDef } from "../settings/SettingsSchema";
import type { SettingsStore } from "../settings/SettingsStore";
import type { CollapsiblePanel } from "./CollapsiblePanel";
import { makeCollapsible } from "./CollapsiblePanel";

export type DebugViewToggleHandler = (view: DebugViewKey, enabled: boolean) => void;

/**
 * The detection settings panel, generated entirely from SettingsSchema:
 * - mode selector (Steady / Moving, with Handheld / Drone / Car revealed
 *   for Moving) — choosing a mode applies its preset via SettingsStore;
 * - the "main" group, always visible;
 * - "Advanced" (all other non-debug settings) — a <details> that starts
 *   closed on every load; its open state is deliberately not persisted;
 * - "Debug" — a separate <details>: the detector-debug compute toggle plus
 *   the render-only debug views (DEBUG_VIEWS) and the camera-motion readout;
 * - "Reset to defaults" — restores the current mode's preset.
 *
 * Only settings that apply to the current mode are shown. The panel owns no
 * settings state: it renders SettingsStore and writes user input back to it.
 */
export class SettingsPanel {
    readonly element: HTMLElement;
    private readonly controls = new Map<SchemaKey, { row: HTMLElement; sync: () => void }>();
    private readonly groupContainers = new Map<SettingGroup, HTMLElement>();
    private readonly debugViewInputs = new Map<DebugViewKey, HTMLInputElement>();
    private readonly cameraButtons: HTMLButtonElement[] = [];
    private readonly subModeButtons: HTMLButtonElement[] = [];
    private readonly subModeRow: HTMLElement;
    private readonly resetButton: HTMLButtonElement;
    private readonly readout: HTMLElement;
    private readonly advanced: HTMLDetailsElement;
    private onDebugView: DebugViewToggleHandler | null = null;
    /** Sub-mode to return to when switching back to Moving — starts at Handheld. */
    private lastSubMode: MovingSubMode = "handheld";
    private collapsible: CollapsiblePanel;

    constructor(private readonly store: SettingsStore) {
        this.element = document.createElement("div");
        this.element.className = "settings-panel";

        const modeSection = document.createElement("div");
        modeSection.className = "mode-selector";
        const cameraRow = segmented("Camera", [
            { value: "steady", label: "Steady camera" },
            { value: "moving", label: "Moving camera" }
        ]);
        cameraRow.buttons.forEach((button) => {
            button.addEventListener("click", () => {
                this.store.setMode(button.dataset.value === "steady" ? "steady" : movingMode(this.lastSubMode));
            });
        });
        this.cameraButtons.push(...cameraRow.buttons);

        const subRow = segmented(
            "Moving camera type",
            MOVING_SUB_MODES.map((sub) => ({ value: sub, label: SUB_MODE_LABELS[sub] }))
        );
        subRow.element.classList.add("is-sub");
        subRow.buttons.forEach((button) => {
            button.addEventListener("click", () => this.store.setMode(movingMode(button.dataset.value as MovingSubMode)));
        });
        this.subModeButtons.push(...subRow.buttons);
        this.subModeRow = subRow.element;
        modeSection.append(cameraRow.element, subRow.element);

        const main = document.createElement("div");
        main.className = "settings-group";
        main.dataset.group = "main";

        this.advanced = section("Advanced", "advanced");
        const debug = section("Debug", "debug");

        this.groupContainers.set("main", main);
        this.groupContainers.set("advanced", this.advanced.querySelector(".settings-section-body") as HTMLElement);
        this.groupContainers.set("debug", debug.querySelector(".settings-section-body") as HTMLElement);

        for (const key of SCHEMA_KEYS) {
            const def = settingDef(key);
            const control = this.buildControl(key, def);
            this.controls.set(key, control);
            this.groupContainers.get(def.group)?.appendChild(control.row);
        }

        const debugBody = this.groupContainers.get("debug") as HTMLElement;
        const views = document.createElement("div");
        views.className = "settings-debug-views";
        for (const view of DEBUG_VIEWS) {
            const label = document.createElement("label");
            label.className = "settings-check";
            label.title = view.description;
            const input = document.createElement("input");
            input.type = "checkbox";
            input.dataset.debugView = view.key;
            input.addEventListener("change", () => this.onDebugView?.(view.key, input.checked));
            label.append(input, document.createTextNode(` ${view.label}`));
            views.appendChild(label);
            this.debugViewInputs.set(view.key, input);
        }
        this.readout = document.createElement("div");
        this.readout.className = "detector-debug-readout";
        this.readout.textContent = "Camera motion: —";
        debugBody.append(views, this.readout);

        this.resetButton = document.createElement("button");
        this.resetButton.type = "button";
        this.resetButton.className = "settings-reset-button";
        this.resetButton.textContent = "Reset to defaults";
        this.resetButton.title = "Restore the current mode's preset";
        this.resetButton.addEventListener("click", () => this.store.resetToDefaults());

        this.element.append(modeSection, main, this.advanced, debug, this.resetButton);
        this.store.onChange(() => this.sync());
        this.sync();

        this.collapsible = makeCollapsible(this.element, "Detection", true);
    }

    setOpen(open: boolean): void {
        this.collapsible.setOpen(open);
    }

    onToggleDebugView(handler: DebugViewToggleHandler): void {
        this.onDebugView = handler;
    }

    /** Unchecks every debug view (render-only, so not part of the settings store) — App calls this alongside resetting the renderer's visibility. */
    resetDebugViews(): void {
        this.debugViewInputs.forEach((input) => (input.checked = false));
        this.updateDetectorDebug(undefined);
    }

    /** Text readout of this frame's global-motion estimate — undefined when detector debug isn't computed or no frame has been analyzed yet. */
    updateDetectorDebug(debug: DetectorDebugInfo | undefined): void {
        if (!debug) {
            this.readout.textContent = "Camera motion: —";
            return;
        }
        const { dx, dy, confidence, valid, model, inlierRatio, residualError, parallaxDetected, featureCount, validCount } = debug.globalMotion;
        const featureSuffix = featureCount !== undefined ? ` | features ${validCount ?? 0}/${featureCount}` : "";
        this.readout.textContent =
            `Camera motion: dx ${dx.toFixed(1)}px dy ${dy.toFixed(1)}px confidence ${confidence.toFixed(2)} ${valid ? "(compensating)" : "(not compensating)"} | ` +
            `model ${model} | inliers ${(inlierRatio * 100).toFixed(0)}% | residual ${residualError.toFixed(2)}px | parallax ${parallaxDetected ? "yes" : "no"}${featureSuffix}`;
    }

    private sync(): void {
        const mode: AnalysisModeId = this.store.getMode();
        const kind = cameraKindOf(mode);
        const sub = subModeOf(mode);
        if (sub) this.lastSubMode = sub;

        this.cameraButtons.forEach((button) => setPressed(button, button.dataset.value === kind));
        this.subModeButtons.forEach((button) => setPressed(button, button.dataset.value === sub));
        this.subModeRow.hidden = kind !== "moving";

        for (const [key, control] of this.controls) {
            control.row.hidden = !appliesToMode(key, mode);
            control.sync();
        }
        // A section with nothing applicable in this mode disappears entirely rather than opening onto an empty body.
        this.advanced.hidden = SCHEMA_KEYS.every((key) => settingDef(key).group !== "advanced" || !appliesToMode(key, mode));
        this.resetButton.disabled = this.store.isAtDefaults();
    }

    private buildControl(key: SchemaKey, def: AnySettingDef): { row: HTMLElement; sync: () => void } {
        const row = document.createElement("div");
        row.className = `settings-control is-${def.kind}`;
        row.dataset.setting = key;
        row.title = def.description;
        const store = this.store;

        if (def.kind === "boolean") {
            const label = document.createElement("label");
            label.className = "settings-check";
            const input = document.createElement("input");
            input.type = "checkbox";
            input.addEventListener("change", () => store.set(key, input.checked as never));
            label.append(input, document.createTextNode(` ${def.label}`));
            row.appendChild(label);
            return { row, sync: () => (input.checked = Boolean(store.get(key))) };
        }

        const header = document.createElement("div");
        header.className = "settings-control-header";
        const name = document.createElement("span");
        name.textContent = def.label;
        header.appendChild(name);
        row.appendChild(header);

        if (def.kind === "choice") {
            const select = document.createElement("select");
            for (const option of def.options) {
                const el = document.createElement("option");
                el.value = option.value;
                el.textContent = option.label;
                select.appendChild(el);
            }
            select.addEventListener("change", () => store.set(key, select.value as never));
            row.appendChild(select);
            return { row, sync: () => (select.value = String(store.get(key))) };
        }

        const value = document.createElement("span");
        value.className = "settings-value";
        header.appendChild(value);
        const input = document.createElement("input");
        input.type = "range";
        input.min = String(def.min);
        input.max = String(def.max);
        input.step = String(def.step);
        input.addEventListener("input", () => {
            value.textContent = formatValue(def, Number(input.value));
            store.set(key, Number(input.value) as never);
        });
        row.appendChild(input);
        return {
            row,
            sync: () => {
                const current = Number(store.get(key));
                input.value = String(current);
                value.textContent = formatValue(def, current);
            }
        };
    }
}

export function formatValue(def: NumberDef, value: number): string {
    switch (def.format) {
        case "area":
            return `${(value * 100).toFixed(2)}%`;
        case "integer":
            return String(Math.round(value));
        case "px":
            return `${Math.round(value)} px`;
        case "fps":
            return `${Math.round(value)} fps`;
        default:
            return value.toFixed(2);
    }
}

function segmented(label: string, options: { value: string; label: string }[]): { element: HTMLElement; buttons: HTMLButtonElement[] } {
    const element = document.createElement("div");
    element.className = "segmented";
    element.setAttribute("role", "group");
    element.setAttribute("aria-label", label);
    const buttons = options.map((option) => {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.value = option.value;
        button.textContent = option.label;
        element.appendChild(button);
        return button;
    });
    return { element, buttons };
}

function setPressed(button: HTMLButtonElement, pressed: boolean): void {
    button.setAttribute("aria-pressed", String(pressed));
    button.classList.toggle("is-active", pressed);
}

/** A collapsible group. Starts closed and is never restored from storage — "closed on every load" is a requirement, not a default. */
function section(title: string, group: SettingGroup): HTMLDetailsElement {
    const details = document.createElement("details");
    details.className = "settings-section";
    details.dataset.group = group;
    const summary = document.createElement("summary");
    summary.textContent = title;
    const body = document.createElement("div");
    body.className = "settings-section-body";
    details.append(summary, body);
    return details;
}
