import { describe, expect, it, vi } from "vitest";
import { DEFAULT_ANALYSIS_SETTINGS } from "../src/analysis/AnalysisTypes.ts";
import { ANALYSIS_MODES } from "../src/settings/AnalysisModes.ts";
import type { AnalysisModeId } from "../src/settings/AnalysisModes.ts";
import {
    FIXED_SETTINGS,
    SCHEMA_KEYS,
    SETTINGS_SCHEMA,
    applicableSettings,
    presetFor,
    sanitizeSetting,
    settingDef
} from "../src/settings/SettingsSchema.ts";
import { SettingsStore } from "../src/settings/SettingsStore.ts";

describe("settings schema", () => {
    it("covers every AnalysisSettings field except the per-video resolution, the mode and strategy-fixed settings", () => {
        const expected = Object.keys(DEFAULT_ANALYSIS_SETTINGS)
            .filter((k) => !["analysisWidth", "analysisHeight", "mode", "cameraCompensationEnabled"].includes(k))
            .sort();
        expect([...SCHEMA_KEYS].sort()).toEqual(expected);
    });

    it("gives every setting a valid default in every mode (in range, on a step, or a listed option)", () => {
        for (const key of SCHEMA_KEYS) {
            const def = settingDef(key);
            for (const mode of ANALYSIS_MODES) {
                const value = def.defaults[mode];
                if (def.kind === "number") {
                    expect(value, `${key}/${mode}`).toBeGreaterThanOrEqual(def.min);
                    expect(value, `${key}/${mode}`).toBeLessThanOrEqual(def.max);
                    const steps = ((value as number) - def.min) / def.step;
                    expect(Math.abs(steps - Math.round(steps)), `${key}/${mode} on step`).toBeLessThan(1e-6);
                } else if (def.kind === "boolean") {
                    expect(typeof value).toBe("boolean");
                } else {
                    expect(def.options.map((o) => o.value)).toContain(value);
                }
            }
        }
    });

    it("puts threshold, min area, blur and small-object detection in the always-visible group", () => {
        for (const key of ["threshold", "minBlobArea", "blurRadius", "smallObjectDetectionEnabled"] as const) {
            expect(SETTINGS_SCHEMA[key].group).toBe("main");
        }
        expect(SETTINGS_SCHEMA.detectorDebugEnabled.group).toBe("debug");
    });

    it("only exposes the camera-motion estimator to the moving modes", () => {
        expect(applicableSettings("steady")).not.toContain("cameraMotionMode");
        for (const mode of ["moving-handheld", "moving-drone", "moving-car"] as AnalysisModeId[]) {
            expect(applicableSettings(mode)).toContain("cameraMotionMode");
        }
    });
});

describe("presetFor", () => {
    it("returns a complete settings set: the mode, its fixed settings and every schema default", () => {
        for (const mode of ANALYSIS_MODES) {
            const preset = presetFor(mode);
            expect(preset.mode).toBe(mode);
            expect(preset.cameraCompensationEnabled).toBe(FIXED_SETTINGS[mode].cameraCompensationEnabled);
            for (const key of SCHEMA_KEYS) expect(preset[key]).toBe(SETTINGS_SCHEMA[key].defaults[mode]);
        }
    });

    it("turns camera compensation off for steady and on for every moving mode", () => {
        expect(presetFor("steady").cameraCompensationEnabled).toBe(false);
        expect(presetFor("moving-car").cameraCompensationEnabled).toBe(true);
    });

    it("keeps the steady preset equal to V1's values with compensation off (the verified no-regression configuration)", () => {
        const { mode: _mode, analysisWidth: _w, analysisHeight: _h, ...v1 } = { ...DEFAULT_ANALYSIS_SETTINGS, cameraCompensationEnabled: false };
        const { mode: _m, ...steady } = presetFor("steady");
        expect(steady).toEqual(v1);
    });
});

describe("sanitizeSetting", () => {
    it("clamps, snaps to the step, and falls back to the preset for invalid input", () => {
        expect(sanitizeSetting("threshold", 5, "steady")).toBe(SETTINGS_SCHEMA.threshold.max);
        expect(sanitizeSetting("blurRadius", 2.4, "steady")).toBe(2);
        expect(sanitizeSetting("threshold", Number.NaN, "steady")).toBe(SETTINGS_SCHEMA.threshold.defaults.steady);
        expect(sanitizeSetting("cameraMotionMode", "nope" as never, "moving-car")).toBe(SETTINGS_SCHEMA.cameraMotionMode.defaults["moving-car"]);
        expect(sanitizeSetting("smallObjectDetectionEnabled", "yes" as never, "steady")).toBe(true);
    });
});

describe("SettingsStore", () => {
    it("starts in steady mode on the steady preset", () => {
        const store = new SettingsStore();
        expect(store.getMode()).toBe("steady");
        expect(store.getSettings()).toEqual(presetFor("steady"));
        expect(store.isAtDefaults()).toBe(true);
    });

    it("applies the new mode's preset immediately on a mode switch, replacing user changes", () => {
        const store = new SettingsStore();
        const listener = vi.fn();
        store.onChange(listener);
        store.set("threshold", 0.3);
        store.setMode("moving-car");
        expect(store.getSettings()).toEqual(presetFor("moving-car"));
        const last = listener.mock.calls[listener.mock.calls.length - 1][0];
        expect(last.reason).toBe("mode");
        expect(last.changed.mode).toBe("moving-car");
    });

    it("notifies on a mode switch even when the two presets share every value", () => {
        const store = new SettingsStore("moving-handheld");
        const listener = vi.fn();
        store.onChange(listener);
        store.setMode("moving-drone");
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it("restores the current mode's preset on reset", () => {
        const store = new SettingsStore("moving-drone");
        store.set("blurRadius", 7);
        store.set("smallObjectDetectionEnabled", false);
        expect(store.isAtDefaults()).toBe(false);
        store.resetToDefaults();
        expect(store.getSettings()).toEqual(presetFor("moving-drone"));
        expect(store.isAtDefaults()).toBe(true);
    });

    it("sanitizes set() and reports only what changed", () => {
        const store = new SettingsStore();
        const listener = vi.fn();
        store.onChange(listener);
        store.set("threshold", 9);
        expect(store.get("threshold")).toBe(SETTINGS_SCHEMA.threshold.max);
        expect(listener.mock.calls[0][0].changed).toEqual({ threshold: SETTINGS_SCHEMA.threshold.max });
        store.set("threshold", 9);
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it("ignores settings that don't apply to the current mode", () => {
        const store = new SettingsStore("steady");
        store.set("cameraMotionMode", "motion-field");
        expect(store.get("cameraMotionMode")).toBe(presetFor("steady").cameraMotionMode);
    });
});
