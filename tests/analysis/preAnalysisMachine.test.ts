import { describe, expect, it } from "vitest";
import type { PreAnalysisEvent, PreAnalysisState } from "../../src/analysis/PreAnalysisMachine";
import { INITIAL_STATE, canStart, isPlaybackUnlocked, reducePreAnalysis } from "../../src/analysis/PreAnalysisMachine";

const run = (...events: PreAnalysisEvent[]): PreAnalysisState => events.reduce(reducePreAnalysis, INITIAL_STATE);
const start = { type: "start" } as const;
const stop = { type: "stop" } as const;
const finish = { type: "finish" } as const;
const reanalyze = { type: "reanalyze" } as const;
const changed = (staleness: "none" | "tracking" | "full") => ({ type: "settings", staleness }) as const;

describe("pre-analysis state machine", () => {
    it("idle → running → complete unlocks playback", () => {
        expect(run()).toEqual({ status: "idle" });
        expect(run(start)).toEqual({ status: "running" });
        expect(run(start, finish)).toEqual({ status: "complete" });
        expect(isPlaybackUnlocked(run(start))).toBe(false);
        expect(isPlaybackUnlocked(run(start, finish))).toBe(true);
    });

    it("Stop keeps a resumable partial result; playback stays locked", () => {
        const stopped = run(start, stop);
        expect(stopped).toEqual({ status: "stopped" });
        expect(isPlaybackUnlocked(stopped)).toBe(false);
        expect(canStart(stopped)).toBe(true);
        expect(run(start, stop, start)).toEqual({ status: "running" });
        expect(run(start, stop, start, finish)).toEqual({ status: "complete" });
    });

    it("a settings change makes a complete result stale but keeps it playable", () => {
        const stale = run(start, finish, changed("tracking"));
        expect(stale).toEqual({ status: "stale", from: "complete", kind: "tracking" });
        expect(isPlaybackUnlocked(stale)).toBe(true);
        expect(canStart(stale)).toBe(false);
        // A further change can escalate what Re-analyze must redo.
        expect(reducePreAnalysis(stale, changed("full"))).toEqual({ status: "stale", from: "complete", kind: "full" });
    });

    it("changing settings back clears the stale state", () => {
        expect(run(start, finish, changed("full"), changed("none"))).toEqual({ status: "complete" });
        expect(run(start, stop, changed("tracking"), changed("none"))).toEqual({ status: "stopped" });
    });

    it("a stale partial result stays locked and cannot be resumed", () => {
        const stale = run(start, stop, changed("full"));
        expect(stale).toEqual({ status: "stale", from: "stopped", kind: "full" });
        expect(isPlaybackUnlocked(stale)).toBe(false);
        expect(canStart(stale)).toBe(false);
    });

    it("a settings change while running stops the run and makes the partial result stale", () => {
        expect(run(start, changed("tracking"))).toEqual({ status: "stale", from: "stopped", kind: "tracking" });
    });

    it("Re-analyze: a full one starts over, a tracking one returns to the cached state", () => {
        expect(run(start, finish, changed("full"), reanalyze)).toEqual({ status: "running" });
        expect(run(start, finish, changed("tracking"), reanalyze)).toEqual({ status: "complete" });
        expect(run(start, stop, changed("tracking"), reanalyze)).toEqual({ status: "stopped" });
    });

    it("ignores events that do not apply, and reset always returns to idle", () => {
        expect(run(stop, finish, reanalyze, changed("full"))).toEqual({ status: "idle" });
        expect(run(start, finish, start, stop)).toEqual({ status: "complete" });
        expect(run(start, finish, changed("full"), { type: "reset" })).toEqual({ status: "idle" });
    });
});
