import type { Staleness } from "./analysisKeys";

export type PreAnalysisStatus = "idle" | "running" | "stopped" | "complete" | "stale";

/**
 * Pre-analysis state (Phase 6):
 * - idle: nothing analyzed;
 * - running: decoding and detecting;
 * - stopped: paused by Stop; the partial result is kept (user decision) and
 *   Start resumes from where it stopped;
 * - complete: the whole video is analyzed; playback is unlocked;
 * - stale: settings differ from the ones the cache was made with; the cache
 *   (complete or partial, `from`) stays in use until Re-analyze.
 * Playback is unlocked only for a complete analysis (also while stale).
 */
export interface PreAnalysisState {
    status: PreAnalysisStatus;
    /** For "stale": the state of the cached result. */
    from?: "stopped" | "complete";
    /** For "stale": what Re-analyze has to redo. */
    kind?: Exclude<Staleness, "none">;
}

export type PreAnalysisEvent =
    | { type: "start" }
    | { type: "stop" }
    | { type: "finish" }
    /** Current settings compared with the cache's. */
    | { type: "settings"; staleness: Staleness }
    /** Re-analyze pressed: a "full" one starts over; a "tracking" one has already been re-run by the caller. */
    | { type: "reanalyze" }
    /** New file, mode switch away, or an analysis error with nothing usable. */
    | { type: "reset" };

export const INITIAL_STATE: PreAnalysisState = { status: "idle" };

export function reducePreAnalysis(state: PreAnalysisState, event: PreAnalysisEvent): PreAnalysisState {
    if (event.type === "reset") return INITIAL_STATE;
    switch (state.status) {
        case "idle":
            return event.type === "start" ? { status: "running" } : state;
        case "running":
            if (event.type === "stop") return { status: "stopped" };
            if (event.type === "finish") return { status: "complete" };
            // A settings change mid-run: the caller stops the run; the partial cache becomes stale.
            if (event.type === "settings" && event.staleness !== "none") {
                return { status: "stale", from: "stopped", kind: event.staleness };
            }
            return state;
        case "stopped":
            if (event.type === "start") return { status: "running" };
            if (event.type === "settings" && event.staleness !== "none") {
                return { status: "stale", from: "stopped", kind: event.staleness };
            }
            return state;
        case "complete":
            if (event.type === "settings" && event.staleness !== "none") {
                return { status: "stale", from: "complete", kind: event.staleness };
            }
            return state;
        case "stale": {
            const from = state.from ?? "complete";
            if (event.type === "settings") {
                return event.staleness === "none" ? { status: from } : { ...state, kind: event.staleness };
            }
            if (event.type === "reanalyze") return state.kind === "full" ? { status: "running" } : { status: from };
            return state;
        }
    }
}

export function isPlaybackUnlocked(state: PreAnalysisState): boolean {
    return state.status === "complete" || (state.status === "stale" && state.from === "complete");
}

export function canStart(state: PreAnalysisState): boolean {
    return state.status === "idle" || state.status === "stopped";
}
