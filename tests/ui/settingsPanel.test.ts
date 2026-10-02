// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { SETTING_KEYS } from "../../src/settings/SettingsSchema";
import { SettingsStore } from "../../src/settings/SettingsStore";
import { SettingsPanel } from "../../src/ui/SettingsPanel";

function setup() {
    const store = new SettingsStore();
    const panel = new SettingsPanel(store);
    const control = (key: string) => panel.element.querySelector(`[data-setting="${key}"]`) as HTMLElement;
    return { store, panel, control };
}

describe("SettingsPanel", () => {
    it("generates one control per schema entry, in its group", () => {
        const { panel, control } = setup();
        for (const key of SETTING_KEYS) expect(control(key), key).not.toBeNull();

        const groupOf = (key: string) => control(key).closest("[data-group]")?.getAttribute("data-group");
        expect(groupOf("confidenceThreshold")).toBe("main");
        expect(groupOf("backend")).toBe("advanced");
        expect(groupOf("showTrackIds")).toBe("debug");
        expect(panel.element.querySelectorAll("details")).toHaveLength(2);
    });

    it("starts with Advanced and Debug closed", () => {
        const { panel } = setup();
        for (const details of panel.element.querySelectorAll("details")) expect(details.open).toBe(false);
    });

    it("writes slider, select and checkbox input to the store", () => {
        const { store, control } = setup();

        const slider = control("confidenceThreshold").querySelector("input") as HTMLInputElement;
        slider.value = "0.6";
        slider.dispatchEvent(new Event("input"));
        expect(store.get("confidenceThreshold")).toBe(0.6);
        expect(control("confidenceThreshold").querySelector(".settings-value")?.textContent).toBe("60%");

        const select = control("inputSize").querySelector("select") as HTMLSelectElement;
        select.value = "0";
        select.dispatchEvent(new Event("change"));
        expect(store.get("inputSize")).toBe(320);

        const checkbox = control("showTrackIds").querySelector("input") as HTMLInputElement;
        checkbox.checked = true;
        checkbox.dispatchEvent(new Event("change"));
        expect(store.get("showTrackIds")).toBe(true);
    });

    it("Reset to defaults restores the store and is disabled at defaults", () => {
        const { store, panel, control } = setup();
        const reset = panel.element.querySelector(".settings-reset-button") as HTMLButtonElement;
        expect(reset.disabled).toBe(true);

        store.set("modelSize", "s");
        expect(reset.disabled).toBe(false);
        expect((control("modelSize").querySelector("select") as HTMLSelectElement).value).toBe("1");

        reset.click();
        expect(store.isAtDefaults()).toBe(true);
        expect(reset.disabled).toBe(true);
        expect((control("modelSize").querySelector("select") as HTMLSelectElement).value).toBe("0");
    });
});
