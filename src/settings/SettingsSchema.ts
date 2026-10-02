/**
 * The single source of truth for every user-facing analysis setting:
 * label, range, group (main / advanced / debug), which analysis modes it
 * applies to, and its default per mode. Everything else derives from here:
 * - each mode's preset (presetFor) — what switching mode and "Reset to
 *   defaults" apply, and what the evaluation harness runs per strategy;
 * - which settings a strategy exposes (applicableSettings);
 * - the generated settings UI (src/ui/SettingsPanel.ts).
 *
 * SETTINGS_SCHEMA is typed as a complete mapping over SchemaKey, so adding
 * a field to AnalysisSettings without a schema entry (or giving an entry
 * the wrong value type) is a compile error — the UI cannot drift from the
 * settings type. How each per-mode value was chosen: docs/v2/presets.md.
 */
import type { AnalysisSettings } from "../analysis/AnalysisTypes";
import type { AnalysisVisibility } from "../rendering/AnalysisOverlay";
import type { AnalysisModeId } from "./AnalysisModes";

export type SettingGroup = "main" | "advanced" | "debug";

/**
 * AnalysisSettings fields that are NOT user settings:
 * - analysisWidth/Height are derived per loaded video;
 * - mode is chosen with the mode selector, not a schema control;
 * - cameraCompensationEnabled is decided by the strategy (FIXED_SETTINGS),
 *   not something that makes sense to toggle inside a mode.
 */
export type NonSchemaKey = "analysisWidth" | "analysisHeight" | "mode" | "cameraCompensationEnabled";
export type SchemaKey = Exclude<keyof AnalysisSettings, NonSchemaKey>;

export type PerMode<T> = Readonly<Record<AnalysisModeId, T>>;

interface BaseDef {
    label: string;
    /** One line, shown as the control's tooltip. */
    description: string;
    group: SettingGroup;
    /** Modes the setting applies to; omitted = all. A setting that doesn't apply is hidden and keeps its preset value. */
    modes?: readonly AnalysisModeId[];
}

export interface NumberDef extends BaseDef {
    kind: "number";
    min: number;
    max: number;
    step: number;
    /** How the value is shown next to the control. */
    format: "fraction" | "area" | "integer" | "px" | "fps";
    defaults: PerMode<number>;
}

export interface BooleanDef extends BaseDef {
    kind: "boolean";
    defaults: PerMode<boolean>;
}

export interface ChoiceDef<V extends string = string> extends BaseDef {
    kind: "choice";
    options: readonly { value: V; label: string }[];
    defaults: PerMode<V>;
}

/** Any schema entry, for code that handles every kind (the generated UI, sanitizing). */
export type AnySettingDef = NumberDef | BooleanDef | ChoiceDef;

export type SettingDef<K extends SchemaKey> = AnalysisSettings[K] extends number
    ? NumberDef
    : AnalysisSettings[K] extends boolean
      ? BooleanDef
      : ChoiceDef<Extract<AnalysisSettings[K], string>>;

/** Same value in every mode. */
function all<T>(value: T): PerMode<T> {
    return { steady: value, "moving-handheld": value, "moving-drone": value, "moving-car": value };
}

const MOVING: readonly AnalysisModeId[] = ["moving-handheld", "moving-drone", "moving-car"];

/**
 * Object order is display order within each group. Steady = V1's values
 * (verified no-regression). Moving-camera values are provisional until
 * Phase 2 — chosen from a measured grid by the rule in docs/v2/presets.md.
 */
export const SETTINGS_SCHEMA: { readonly [K in SchemaKey]: SettingDef<K> } = {
    threshold: {
        kind: "number",
        label: "Motion threshold",
        description: "How much a pixel must change between analyzed frames to count as motion (0..1 of full scale).",
        group: "main",
        min: 0.02,
        max: 0.6,
        step: 0.01,
        format: "fraction",
        defaults: { steady: 0.12, "moving-handheld": 0.18, "moving-drone": 0.12, "moving-car": 0.25 }
    },
    minBlobArea: {
        kind: "number",
        label: "Min blob area",
        description: "Smallest region reported as a blob, as a fraction of the frame area.",
        group: "main",
        min: 0,
        max: 0.02,
        step: 0.0001,
        format: "area",
        defaults: all(0.0002)
    },
    blurRadius: {
        kind: "number",
        label: "Blur",
        description: "Gaussian blur radius (px at analysis resolution) applied before diffing — suppresses texture/noise flicker.",
        group: "main",
        min: 0,
        max: 10,
        step: 1,
        format: "px",
        defaults: { steady: 0, "moving-handheld": 2, "moving-drone": 0, "moving-car": 2 }
    },
    smallObjectDetectionEnabled: {
        kind: "boolean",
        label: "Small-object detection",
        description: "Second, more sensitive pass for small/distant objects, held to stricter persistence rules.",
        group: "main",
        defaults: all(true)
    },
    morphologyStrength: {
        kind: "number",
        label: "Morphology",
        description: "Morphological open iterations on the motion mask — removes speckle, but erases thin slow-motion slivers.",
        group: "main",
        min: 0,
        max: 5,
        step: 1,
        format: "integer",
        defaults: { steady: 0, "moving-handheld": 1, "moving-drone": 1, "moving-car": 1 }
    },
    maxBlobArea: {
        kind: "number",
        label: "Max blob area",
        description: "Largest region reported as a blob, as a fraction of the frame area.",
        group: "advanced",
        min: 0.01,
        max: 1,
        step: 0.01,
        format: "fraction",
        defaults: all(0.5)
    },
    cameraMotionMode: {
        kind: "choice",
        label: "Camera-motion estimator",
        description: "How background motion is estimated before diffing: block matching (legacy) or sparse optical flow (motion field).",
        group: "advanced",
        modes: MOVING,
        options: [
            { value: "legacy", label: "Block matching" },
            { value: "motion-field", label: "Sparse optical flow" }
        ],
        defaults: { steady: "legacy", "moving-handheld": "legacy", "moving-drone": "motion-field", "moving-car": "motion-field" }
    },
    sampleFps: {
        kind: "number",
        label: "Sample rate",
        description: "Frames per second sampled for analysis, independent of playback frame rate.",
        group: "advanced",
        min: 4,
        max: 30,
        step: 1,
        format: "fps",
        defaults: all(12)
    },
    highlightThreshold: {
        kind: "number",
        label: "Highlight threshold",
        description: "Luminance at/above which a pixel counts as a highlight.",
        group: "advanced",
        min: 0,
        max: 1,
        step: 0.01,
        format: "fraction",
        defaults: all(0.85)
    },
    shadowThreshold: {
        kind: "number",
        label: "Shadow threshold",
        description: "Luminance at/below which a pixel counts as a crushed black.",
        group: "advanced",
        min: 0,
        max: 1,
        step: 0.01,
        format: "fraction",
        defaults: all(0.02)
    },
    clipThreshold: {
        kind: "number",
        label: "Clip threshold",
        description: "RGB channel value at/above which that channel counts as clipped.",
        group: "advanced",
        min: 0.5,
        max: 1,
        step: 0.01,
        format: "fraction",
        defaults: all(0.98)
    },
    detectorDebugEnabled: {
        kind: "boolean",
        label: "Compute detector debug data",
        description: "Has the detector report its intermediate buffers (diffs, mask, candidates, camera motion). Costs time per frame; the views below need it.",
        group: "debug",
        defaults: all(false)
    }
};

/** Settings each strategy forces — not user-editable, applied on top of the preset (and re-applied by the strategy in the worker). */
export const FIXED_SETTINGS: PerMode<Pick<AnalysisSettings, "cameraCompensationEnabled">> = {
    steady: { cameraCompensationEnabled: false },
    "moving-handheld": { cameraCompensationEnabled: true },
    "moving-drone": { cameraCompensationEnabled: true },
    "moving-car": { cameraCompensationEnabled: true }
};

/** Everything a mode defines — i.e. AnalysisSettings minus the per-video analysis resolution. */
export type ModeSettings = Omit<AnalysisSettings, "analysisWidth" | "analysisHeight">;

export const SCHEMA_KEYS = Object.keys(SETTINGS_SCHEMA) as SchemaKey[];

export function settingDef(key: SchemaKey): AnySettingDef {
    return SETTINGS_SCHEMA[key] as AnySettingDef;
}

export function appliesToMode(key: SchemaKey, mode: AnalysisModeId): boolean {
    const modes = SETTINGS_SCHEMA[key].modes;
    return modes === undefined || modes.includes(mode);
}

/** The settings a mode exposes, in display order. */
export function applicableSettings(mode: AnalysisModeId, group?: SettingGroup): SchemaKey[] {
    return SCHEMA_KEYS.filter((key) => appliesToMode(key, mode) && (group === undefined || SETTINGS_SCHEMA[key].group === group));
}

/** A mode's complete preset: every schema default for that mode plus the strategy's fixed settings. */
export function presetFor(mode: AnalysisModeId): ModeSettings {
    const values: Record<string, unknown> = { mode, ...FIXED_SETTINGS[mode] };
    for (const key of SCHEMA_KEYS) values[key] = SETTINGS_SCHEMA[key].defaults[mode];
    return values as ModeSettings;
}

/** Clamps/snaps a user-entered value to its definition; returns the preset value for anything invalid. */
export function sanitizeSetting<K extends SchemaKey>(key: K, value: unknown, mode: AnalysisModeId): AnalysisSettings[K] {
    const def = SETTINGS_SCHEMA[key] as AnySettingDef;
    const fallback = def.defaults[mode] as AnalysisSettings[K];
    if (def.kind === "number") {
        if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
        const snapped = Math.round((value - def.min) / def.step) * def.step + def.min;
        // Strip float noise from the step multiplication (0.1 + 0.2 style).
        const clean = Number(Math.min(def.max, Math.max(def.min, snapped)).toPrecision(10));
        return clean as AnalysisSettings[K];
    }
    if (def.kind === "boolean") return (typeof value === "boolean" ? value : fallback) as AnalysisSettings[K];
    return (def.options.some((o) => o.value === value) ? value : fallback) as AnalysisSettings[K];
}

/** Debug views (render-only toggles, not analysis settings) shown in the Debug section next to detectorDebugEnabled. Typed against AnalysisVisibility so a renamed view can't silently disappear. */
export type DebugViewKey = Extract<keyof AnalysisVisibility, "rawDiff" | "compensatedDiff" | "motionMask" | "rejectedCandidates" | "sparseFlow" | "detectorHud">;

export const DEBUG_VIEWS: readonly { key: DebugViewKey; label: string; description: string }[] = [
    { key: "detectorHud", label: "Detector HUD", description: "Camera-motion vector, model, inliers and per-region residual arrows." },
    { key: "rawDiff", label: "Raw diff", description: "Frame difference before camera compensation." },
    { key: "compensatedDiff", label: "Compensated diff", description: "Frame difference after camera compensation." },
    { key: "motionMask", label: "Motion mask", description: "Thresholded mask after morphology, before candidate filtering." },
    { key: "rejectedCandidates", label: "Rejected candidates", description: "Candidates the filter rejected, with the reason." },
    { key: "sparseFlow", label: "Sparse flow", description: "Tracked features and their residuals (sparse-optical-flow estimator only)." }
];
