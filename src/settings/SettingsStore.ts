import type { AnalysisModeId } from "./AnalysisModes";
import type { ModeSettings, SchemaKey } from "./SettingsSchema";
import { SCHEMA_KEYS, appliesToMode, presetFor, sanitizeSetting } from "./SettingsSchema";

export interface SettingsChange {
    settings: ModeSettings;
    /** Only the fields whose value actually changed. */
    changed: Partial<ModeSettings>;
    reason: "mode" | "set" | "reset";
}

export type SettingsListener = (change: SettingsChange) => void;

/**
 * Main-thread state of the current analysis mode and its settings — what
 * the generated SettingsPanel edits and what App pushes to AnalysisEngine /
 * the worker. No DOM, no CV: unit-tested directly (tests/settings.test.ts).
 *
 * - setMode applies that mode's preset immediately, replacing any values
 *   the user changed (switching mode means "use this mode's tuning").
 * - resetToDefaults restores the CURRENT mode's preset.
 * - set() sanitizes against the schema (clamp/snap/validate) and ignores
 *   settings that don't apply to the current mode.
 */
export class SettingsStore {
    private mode: AnalysisModeId;
    private values: ModeSettings;
    private readonly listeners = new Set<SettingsListener>();

    constructor(mode: AnalysisModeId = "steady") {
        this.mode = mode;
        this.values = presetFor(mode);
    }

    getMode(): AnalysisModeId {
        return this.mode;
    }

    getSettings(): ModeSettings {
        return { ...this.values };
    }

    get<K extends SchemaKey>(key: K): ModeSettings[K] {
        return this.values[key];
    }

    setMode(mode: AnalysisModeId): void {
        if (mode === this.mode) return;
        this.mode = mode;
        this.replace(presetFor(mode), "mode");
    }

    set<K extends SchemaKey>(key: K, value: ModeSettings[K]): void {
        if (!appliesToMode(key, this.mode)) return;
        const clean = sanitizeSetting(key, value, this.mode);
        if (this.values[key] === clean) return;
        this.values = { ...this.values, [key]: clean };
        this.emit({ [key]: clean } as Partial<ModeSettings>, "set");
    }

    resetToDefaults(): void {
        this.replace(presetFor(this.mode), "reset");
    }

    /** True when every setting equals the current mode's preset. */
    isAtDefaults(): boolean {
        const preset = presetFor(this.mode);
        return SCHEMA_KEYS.every((key) => this.values[key] === preset[key]);
    }

    onChange(listener: SettingsListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private replace(next: ModeSettings, reason: SettingsChange["reason"]): void {
        const changed: Record<string, unknown> = {};
        for (const key of Object.keys(next) as (keyof ModeSettings)[]) {
            if (next[key] !== this.values[key]) changed[key] = next[key];
        }
        this.values = next;
        // A mode switch always notifies, even if the two presets happen to be identical — the strategy itself changed.
        if (Object.keys(changed).length > 0 || reason === "mode" || reason === "reset") this.emit(changed as Partial<ModeSettings>, reason);
    }

    private emit(changed: Partial<ModeSettings>, reason: SettingsChange["reason"]): void {
        const change: SettingsChange = { settings: this.getSettings(), changed, reason };
        for (const listener of this.listeners) listener(change);
    }
}
