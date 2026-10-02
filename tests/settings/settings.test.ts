import { describe, expect, it } from "vitest";
import {
    SETTINGS_SCHEMA,
    SETTING_KEYS,
    defaultSettings,
    sanitizeSetting,
    settingDef
} from "../../src/settings/SettingsSchema";
import type { SettingsChange } from "../../src/settings/SettingsStore";
import { SettingsStore } from "../../src/settings/SettingsStore";

describe("SettingsSchema", () => {
    it("has valid defaults: in range, on step, or among the options", () => {
        for (const key of SETTING_KEYS) {
            const def = settingDef(key);
            expect(sanitizeSetting(key, def.default), key).toBe(def.default);
            if (def.kind === "number") expect(def.min, key).toBeLessThan(def.max);
        }
    });

    it("keeps the brief's main/advanced/debug split", () => {
        const groups = Object.fromEntries(SETTING_KEYS.map((key) => [key, SETTINGS_SCHEMA[key].group]));
        expect(groups).toMatchObject({
            confidenceThreshold: "main",
            modelSize: "main",
            iouThreshold: "advanced",
            inputSize: "advanced",
            maxInferenceFps: "advanced",
            confirmationFrames: "advanced",
            lostBufferSeconds: "advanced",
            backend: "advanced",
            showTrackIds: "debug",
            showRawDetections: "debug"
        });
    });

    it("sanitizes numbers by clamping and snapping to the step", () => {
        expect(sanitizeSetting("confidenceThreshold", 0.33)).toBe(0.35);
        expect(sanitizeSetting("confidenceThreshold", 5)).toBe(0.95);
        expect(sanitizeSetting("confidenceThreshold", -1)).toBe(0.05);
        expect(sanitizeSetting("confidenceThreshold", Number.NaN)).toBe(0.25);
        expect(sanitizeSetting("maxInferenceFps", 12.4)).toBe(12);
    });

    it("sanitizes choices and booleans", () => {
        expect(sanitizeSetting("inputSize", 416)).toBe(416);
        expect(sanitizeSetting("inputSize", 500)).toBe(640);
        expect(sanitizeSetting("inputSize", "416")).toBe(640);
        expect(sanitizeSetting("backend", "webgl")).toBe("auto");
        expect(sanitizeSetting("showTrackIds", "yes")).toBe(false);
    });
});

describe("SettingsStore", () => {
    it("starts at defaults", () => {
        const store = new SettingsStore();
        expect(store.getSettings()).toEqual(defaultSettings());
        expect(store.isAtDefaults()).toBe(true);
    });

    it("sanitizes, emits only real changes, and reports what changed", () => {
        const store = new SettingsStore();
        const changes: SettingsChange[] = [];
        store.onChange((change) => changes.push(change));

        store.set("confidenceThreshold", 0.5);
        store.set("confidenceThreshold", 0.5);
        store.set("inputSize", 320);

        expect(changes.map((change) => change.changed)).toEqual([{ confidenceThreshold: 0.5 }, { inputSize: 320 }]);
        expect(changes[1].settings.confidenceThreshold).toBe(0.5);
        expect(store.isAtDefaults()).toBe(false);
    });

    it("resetToDefaults restores defaults and reports the reverted fields", () => {
        const store = new SettingsStore();
        store.set("modelSize", "s");
        store.set("showTrackIds", true);
        const changes: SettingsChange[] = [];
        store.onChange((change) => changes.push(change));

        store.resetToDefaults();
        store.resetToDefaults();

        expect(store.isAtDefaults()).toBe(true);
        expect(changes).toHaveLength(1);
        expect(changes[0]).toMatchObject({ reason: "reset", changed: { modelSize: "n", showTrackIds: false } });
    });

    it("getSettings returns a copy", () => {
        const store = new SettingsStore();
        store.getSettings().confidenceThreshold = 0.9;
        expect(store.get("confidenceThreshold")).toBe(0.25);
    });
});
