/**
 * The single source of truth for every user-facing setting: label,
 * description, range or options, default, and UI group. The settings
 * panel (src/ui/SettingsPanel.ts) is generated from this.
 *
 * SETTINGS_SCHEMA is typed as a complete mapping over `Settings`, so a
 * new field without a schema entry (or an entry of the wrong kind) is a
 * compile error and the UI cannot drift from the type.
 *
 * Plain data: no DOM, no inference code.
 *
 * Defaults marked "provisional" are placeholders until measured in the
 * phase that uses them (see docs/decisions.md once it exists).
 */

export type SettingGroup = "main" | "advanced" | "debug";

export type ModelSize = "n" | "s";
/** The model setting: a size, or "auto" (YOLOv8s on WebGPU with FP16, else YOLOv8n; resolved by modelPlan.ts). */
export type ModelChoice = "auto" | ModelSize;
export type InputSize = 320 | 416 | 640;
export type BackendPreference = "auto" | "webgpu" | "wasm";

export interface Settings {
    confidenceThreshold: number;
    modelSize: ModelChoice;
    iouThreshold: number;
    inputSize: InputSize;
    maxInferenceFps: number;
    confirmationFrames: number;
    lostBufferSeconds: number;
    backend: BackendPreference;
    showTrackIds: boolean;
    showRawDetections: boolean;
}

export type SettingKey = keyof Settings;

/** Lowest selectable confidence threshold. The model returns detections down to it, so the slider never needs a new inference run. */
export const MIN_CONFIDENCE = 0.05;

interface BaseDef {
    label: string;
    /** One line, shown as the control's tooltip. */
    description: string;
    group: SettingGroup;
}

export interface NumberDef extends BaseDef {
    kind: "number";
    min: number;
    max: number;
    step: number;
    /** How the value is shown next to the control. */
    format: "percent" | "fraction" | "integer" | "fps" | "frames" | "seconds";
    default: number;
}

export interface BooleanDef extends BaseDef {
    kind: "boolean";
    default: boolean;
}

export interface ChoiceDef<V extends string | number = string | number> extends BaseDef {
    kind: "choice";
    options: readonly { value: V; label: string }[];
    default: V;
}

/** Any schema entry, for code that handles every kind (the generated UI, sanitizing). */
export type AnySettingDef = NumberDef | BooleanDef | ChoiceDef;

/** Booleans get a checkbox; numbers a slider or a fixed choice; strings a choice. */
export type SettingDef<V> = [V] extends [boolean]
    ? BooleanDef
    : [V] extends [number]
      ? (NumberDef & { default: V }) | ChoiceDef<V>
      : ChoiceDef<Extract<V, string>>;

/** Object order is display order within each group. */
export const SETTINGS_SCHEMA: { readonly [K in SettingKey]: SettingDef<Settings[K]> } = {
    confidenceThreshold: {
        kind: "number",
        label: "Confidence threshold",
        description: "Detections below this confidence are discarded.",
        group: "main",
        min: MIN_CONFIDENCE,
        max: 0.95,
        step: 0.05,
        format: "percent",
        // Phase 7 (2026-10-06, was Ultralytics' 0.25): the best threshold against the user's ground truth for both
        // YOLOv8s and YOLOv8n (docs/clip-counts.md §5); the user's 60% missed real cars, 25% over-counted.
        default: 0.35
    },
    modelSize: {
        kind: "choice",
        label: "Model",
        description:
            "YOLOv8n is fastest; YOLOv8s is more accurate but slower. Auto uses YOLOv8s on WebGPU and YOLOv8n on the CPU (WASM).",
        group: "main",
        options: [
            { value: "auto", label: "Auto (Accurate on WebGPU)" },
            { value: "n", label: "Fast (YOLOv8n)" },
            { value: "s", label: "Accurate (YOLOv8s)" }
        ],
        // Phase 7 (user decision 2026-10-06): YOLOv8s fixes class errors YOLOv8n makes on the clips
        // (dog as horse/cow, missed motorcycles) at 18–22 fps on WebGPU (M4 Max); too slow for WASM.
        default: "auto"
    },
    iouThreshold: {
        kind: "number",
        label: "NMS IoU threshold",
        description: "Overlapping boxes of the same class above this IoU are merged into one.",
        group: "advanced",
        min: 0.1,
        max: 0.95,
        step: 0.05,
        format: "fraction",
        // Ultralytics' predict default.
        default: 0.7
    },
    inputSize: {
        kind: "choice",
        label: "Inference input size",
        description: "Square size the frame is letterboxed to. Smaller is faster but misses small objects.",
        group: "advanced",
        options: [
            { value: 320, label: "320 px" },
            { value: 416, label: "416 px" },
            { value: 640, label: "640 px" }
        ],
        // Provisional: chosen by measurement in Phase 1.
        default: 640
    },
    maxInferenceFps: {
        kind: "number",
        label: "Max inference rate",
        description: "Upper limit for frames sent to the model per second. Slow devices run below it automatically.",
        group: "advanced",
        min: 1,
        max: 30,
        step: 1,
        format: "fps",
        // Phase 3 measurement (M4 Max): 30 gives 24–29 fps on WebGPU and ~19 on WASM with no dropped video
        // frames; slower devices just drop more samples. Higher rates also help tracking (Phase 4).
        default: 30
    },
    confirmationFrames: {
        kind: "number",
        label: "Confirmation frames",
        description: "A track is counted once it has been detected in this many frames.",
        group: "advanced",
        min: 1,
        max: 10,
        step: 1,
        format: "frames",
        // Phase 4 clip tests (docs/clip-counts.md): 1–2 let flicker inflate totals 1.3–2.5×; 5 drops brief objects at low rates.
        default: 3
    },
    lostBufferSeconds: {
        kind: "number",
        label: "Track-lost buffer",
        description:
            "How long an unseen track is kept for re-association. An object that returns later is counted again.",
        group: "advanced",
        min: 0,
        max: 5,
        step: 0.5,
        format: "seconds",
        // Phase 4 clip tests (docs/clip-counts.md): fewer re-counts than 1 s on every clip; 3 s adds nothing.
        default: 2
    },
    backend: {
        kind: "choice",
        label: "Backend",
        description: "Auto picks WebGPU when available and falls back to WASM.",
        group: "advanced",
        options: [
            { value: "auto", label: "Auto" },
            { value: "webgpu", label: "WebGPU" },
            { value: "wasm", label: "WASM" }
        ],
        default: "auto"
    },
    showTrackIds: {
        kind: "boolean",
        label: "Show track IDs",
        description: "Adds each box's track ID to its label.",
        group: "debug",
        default: false
    },
    showRawDetections: {
        kind: "boolean",
        label: "Show raw detections",
        description: "Draws the model's detections before tracking, as thin dashed boxes.",
        group: "debug",
        default: false
    }
};

export const SETTING_KEYS = Object.keys(SETTINGS_SCHEMA) as SettingKey[];

export function settingDef(key: SettingKey): AnySettingDef {
    return SETTINGS_SCHEMA[key] as AnySettingDef;
}

export function settingsInGroup(group: SettingGroup): SettingKey[] {
    return SETTING_KEYS.filter((key) => SETTINGS_SCHEMA[key].group === group);
}

export function defaultSettings(): Settings {
    const values: Record<string, unknown> = {};
    for (const key of SETTING_KEYS) values[key] = SETTINGS_SCHEMA[key].default;
    return values as unknown as Settings;
}

/** Clamps/snaps a value to its definition; returns the default for anything invalid. */
export function sanitizeSetting<K extends SettingKey>(key: K, value: unknown): Settings[K] {
    const def = settingDef(key);
    const fallback = def.default as Settings[K];
    if (def.kind === "number") {
        if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
        const snapped = Math.round((value - def.min) / def.step) * def.step + def.min;
        // Strip float noise from the step multiplication (0.1 + 0.2 style).
        return Number(Math.min(def.max, Math.max(def.min, snapped)).toPrecision(10)) as Settings[K];
    }
    if (def.kind === "boolean") return (typeof value === "boolean" ? value : fallback) as Settings[K];
    return (def.options.some((option) => option.value === value) ? value : fallback) as Settings[K];
}
