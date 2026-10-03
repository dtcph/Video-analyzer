import type { BackendKind } from "../inference/ortRuntime";

/** Everything that changes the detections themselves: a change needs a full decode + inference pass. */
export interface InferenceKey {
    modelFile: string;
    backend: BackendKind;
    inputSize: number;
    iouThreshold: number;
    maxInferenceFps: number;
}

/** Everything that changes tracking and counting only: a change re-runs tracking over the cache. */
export interface TrackingKey {
    confidenceThreshold: number;
    /** Enabled class ids, ascending, comma-separated. */
    classes: string;
    confirmationFrames: number;
    lostBufferSeconds: number;
}

/** What a settings change means for a cached analysis. */
export type Staleness = "none" | "tracking" | "full";

export function trackingKey(
    settings: { confidenceThreshold: number; confirmationFrames: number; lostBufferSeconds: number },
    enabled: Uint8Array
): TrackingKey {
    const classes: number[] = [];
    enabled.forEach((on, id) => {
        if (on === 1) classes.push(id);
    });
    return {
        confidenceThreshold: settings.confidenceThreshold,
        classes: classes.join(","),
        confirmationFrames: settings.confirmationFrames,
        lostBufferSeconds: settings.lostBufferSeconds
    };
}

/** Compares the keys an analysis was made with against the current ones. Debug settings are in neither key. */
export function staleness(
    cached: { inference: InferenceKey; tracking: TrackingKey },
    current: { inference: InferenceKey; tracking: TrackingKey }
): Staleness {
    if (!sameValues(cached.inference, current.inference)) return "full";
    if (!sameValues(cached.tracking, current.tracking)) return "tracking";
    return "none";
}

function sameValues<T extends object>(a: T, b: T): boolean {
    return (Object.keys(a) as (keyof T)[]).every((key) => a[key] === b[key]);
}
