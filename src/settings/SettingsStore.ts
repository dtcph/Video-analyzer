import type { SettingKey, Settings } from "./SettingsSchema";
import { SETTING_KEYS, defaultSettings, sanitizeSetting } from "./SettingsSchema";

export interface SettingsChange {
    settings: Settings;
    /** Only the fields whose value actually changed. */
    changed: Partial<Settings>;
    reason: "set" | "reset";
}

export type SettingsListener = (change: SettingsChange) => void;

/**
 * Main-thread settings state: what the generated SettingsPanel edits and
 * what App forwards to the inference worker, tracker and renderer.
 * Values are sanitized against the schema. Nothing is persisted.
 */
export class SettingsStore {
    private values: Settings = defaultSettings();
    private readonly listeners = new Set<SettingsListener>();

    getSettings(): Settings {
        return { ...this.values };
    }

    get<K extends SettingKey>(key: K): Settings[K] {
        return this.values[key];
    }

    set<K extends SettingKey>(key: K, value: Settings[K]): void {
        const clean = sanitizeSetting(key, value);
        if (this.values[key] === clean) return;
        this.values = { ...this.values, [key]: clean };
        this.emit({ [key]: clean } as Partial<Settings>, "set");
    }

    resetToDefaults(): void {
        const next = defaultSettings();
        const changed: Partial<Record<SettingKey, unknown>> = {};
        for (const key of SETTING_KEYS) {
            if (next[key] !== this.values[key]) changed[key] = next[key];
        }
        this.values = next;
        if (Object.keys(changed).length > 0) this.emit(changed as Partial<Settings>, "reset");
    }

    /** True when every setting equals its default. */
    isAtDefaults(): boolean {
        const defaults = defaultSettings();
        return SETTING_KEYS.every((key) => this.values[key] === defaults[key]);
    }

    onChange(listener: SettingsListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private emit(changed: Partial<Settings>, reason: SettingsChange["reason"]): void {
        const change: SettingsChange = { settings: this.getSettings(), changed, reason };
        for (const listener of this.listeners) listener(change);
    }
}
