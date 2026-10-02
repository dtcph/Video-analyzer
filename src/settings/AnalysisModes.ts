/**
 * The analysis modes the user picks between — one per AnalysisStrategy
 * (see src/analysis/strategies/). Plain data only: the UI and the settings
 * schema import this without pulling in any CV code.
 *
 * The choice is always the user's; there is deliberately no camera-motion
 * auto-detection (out of scope for V2).
 */
export const ANALYSIS_MODES = ["steady", "moving-handheld", "moving-drone", "moving-car"] as const;
export type AnalysisModeId = (typeof ANALYSIS_MODES)[number];

export type CameraKind = "steady" | "moving";
export type MovingSubMode = "handheld" | "drone" | "car";

export const MOVING_SUB_MODES: readonly MovingSubMode[] = ["handheld", "drone", "car"];

export const MODE_LABELS: Record<AnalysisModeId, string> = {
    steady: "Steady camera",
    "moving-handheld": "Moving · Handheld",
    "moving-drone": "Moving · Drone",
    "moving-car": "Moving · Car"
};

export const SUB_MODE_LABELS: Record<MovingSubMode, string> = {
    handheld: "Handheld",
    drone: "Drone",
    car: "Car"
};

export function cameraKindOf(mode: AnalysisModeId): CameraKind {
    return mode === "steady" ? "steady" : "moving";
}

/** The sub-mode of a moving mode, or null for steady. */
export function subModeOf(mode: AnalysisModeId): MovingSubMode | null {
    return mode === "steady" ? null : (mode.slice("moving-".length) as MovingSubMode);
}

export function movingMode(subMode: MovingSubMode): AnalysisModeId {
    return `moving-${subMode}`;
}

export function isAnalysisMode(value: unknown): value is AnalysisModeId {
    return typeof value === "string" && (ANALYSIS_MODES as readonly string[]).includes(value);
}
