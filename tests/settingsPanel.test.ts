// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { SCHEMA_KEYS, SETTINGS_SCHEMA, presetFor } from "../src/settings/SettingsSchema.ts";
import type { SchemaKey } from "../src/settings/SettingsSchema.ts";
import { SettingsStore } from "../src/settings/SettingsStore.ts";
import { SettingsPanel } from "../src/ui/SettingsPanel.ts";

function setup(mode: ConstructorParameters<typeof SettingsStore>[0] = "steady") {
    const store = new SettingsStore(mode);
    const panel = new SettingsPanel(store);
    document.body.replaceChildren(panel.element);
    const q = <T extends Element>(selector: string) => panel.element.querySelector<T>(selector);
    const row = (key: SchemaKey) => q<HTMLElement>(`[data-setting="${key}"]`) as HTMLElement;
    const button = (label: string) =>
        [...panel.element.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === label) as HTMLButtonElement;
    return { store, panel, q, row, button };
}

describe("SettingsPanel (generated from SettingsSchema)", () => {
    it("renders one control per schema setting, inside its group", () => {
        const { row } = setup();
        for (const key of SCHEMA_KEYS) {
            const el = row(key);
            expect(el, key).toBeTruthy();
            const group = SETTINGS_SCHEMA[key].group;
            const container = group === "main" ? el.closest('[data-group="main"]') : el.closest(`details[data-group="${group}"]`);
            expect(container, `${key} in ${group}`).toBeTruthy();
        }
    });

    it("starts with Advanced and Debug closed, as separate sections", () => {
        const { q } = setup();
        const advanced = q<HTMLDetailsElement>('details[data-group="advanced"]') as HTMLDetailsElement;
        const debug = q<HTMLDetailsElement>('details[data-group="debug"]') as HTMLDetailsElement;
        expect(advanced.open).toBe(false);
        expect(debug.open).toBe(false);
        expect(advanced.contains(debug)).toBe(false);
        expect(debug.querySelector('input[data-debug-view="rawDiff"]')).toBeTruthy();
        expect(advanced.querySelector("[data-debug-view]")).toBeNull();
    });

    it("reveals the sub-mode selector for Moving and applies that mode's preset", () => {
        const { store, q, button, row } = setup();
        const sub = q<HTMLElement>(".segmented.is-sub") as HTMLElement;
        expect(sub.hidden).toBe(true);
        expect(row("cameraMotionMode").hidden).toBe(true);

        button("Moving camera").click();
        expect(store.getMode()).toBe("moving-handheld");
        expect(sub.hidden).toBe(false);
        expect(row("cameraMotionMode").hidden).toBe(false);

        button("Car").click();
        expect(store.getMode()).toBe("moving-car");
        expect(store.getSettings()).toEqual(presetFor("moving-car"));
        expect(button("Car").getAttribute("aria-pressed")).toBe("true");

        button("Steady camera").click();
        button("Moving camera").click();
        expect(store.getMode()).toBe("moving-car");
    });

    it("writes slider input to the store and Reset restores the current mode's preset", () => {
        const { store, row, button } = setup("moving-drone");
        const reset = button("Reset to defaults");
        expect(reset.disabled).toBe(true);

        const slider = row("threshold").querySelector<HTMLInputElement>('input[type="range"]') as HTMLInputElement;
        slider.value = "0.3";
        slider.dispatchEvent(new Event("input"));
        expect(store.get("threshold")).toBe(0.3);
        expect(reset.disabled).toBe(false);

        reset.click();
        expect(store.getSettings()).toEqual(presetFor("moving-drone"));
        expect(slider.value).toBe(String(presetFor("moving-drone").threshold));
        expect(reset.disabled).toBe(true);
    });

    it("forwards debug view toggles without touching analysis settings", () => {
        const { store, panel, q } = setup();
        const handler = vi.fn();
        panel.onToggleDebugView(handler);
        const hud = q<HTMLInputElement>('input[data-debug-view="detectorHud"]') as HTMLInputElement;
        hud.checked = true;
        hud.dispatchEvent(new Event("change"));
        expect(handler).toHaveBeenCalledWith("detectorHud", true);
        expect(store.isAtDefaults()).toBe(true);
    });
});
