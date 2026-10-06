import type { AnalysisCache, AnalysisSample } from "../analysis/AnalysisCache";
import { InMemoryAnalysisCache } from "../analysis/AnalysisCache";
import type { InferenceKey, TrackingKey } from "../analysis/analysisKeys";
import { staleness } from "../analysis/analysisKeys";
import type { PreAnalysisEvent, PreAnalysisState } from "../analysis/PreAnalysisMachine";
import { INITIAL_STATE, canStart, isPlaybackUnlocked, reducePreAnalysis } from "../analysis/PreAnalysisMachine";
import type { AnalysisProgress, VideoInfo } from "../analysis/PreAnalysisRunner";
import { PreAnalysisRunner, UndecodableVideoError } from "../analysis/PreAnalysisRunner";
import type { TrackingSettings } from "../analysis/TrackingRun";
import { TrackingRun } from "../analysis/TrackingRun";
import type { DetectResult } from "../inference/InferenceClient";

/** The keys and tracking settings for the current settings (null while no model is loaded). */
export interface CurrentAnalysisSettings {
    inference: InferenceKey;
    tracking: TrackingKey;
    trackingSettings: TrackingSettings;
}

export interface PreAnalysisDeps {
    detect(frame: VideoFrame): Promise<DetectResult | null>;
    /** Resolves once a model is loaded; null if none could be loaded. */
    currentSettings(): Promise<CurrentAnalysisSettings | null>;
    /** Synchronous variant for staleness checks (a model still loading counts as a different model). */
    currentSettingsNow(): CurrentAnalysisSettings;
    onChange(): void;
}

/**
 * One video file's pre-analysis (Phase 6): the cache, the tracking run, the
 * runner and the state machine. Stop keeps the partial result and Start
 * resumes it; a settings change keeps the cache and marks it stale; only
 * Re-analyze replaces it (tracking-only when only tracking settings changed).
 */
export class PreAnalysisSession {
    state: PreAnalysisState = INITIAL_STATE;
    cache: AnalysisCache | null = null;
    tracking: TrackingRun | null = null;
    progress: AnalysisProgress | null = null;
    info: VideoInfo | null = null;
    error: string | null = null;
    /** The file cannot be decoded with WebCodecs here: pre-analysis is unavailable for it. */
    undecodable = false;
    /** Wall time of the last completed full analysis, ms (for the "× realtime" readout). */
    completedInMs: number | null = null;
    private keys: { inference: InferenceKey; tracking: TrackingKey } | null = null;
    private runner: PreAnalysisRunner | null = null;
    private disposed = false;

    constructor(
        private readonly file: File,
        private readonly deps: PreAnalysisDeps
    ) {}

    get unlocked(): boolean {
        return isPlaybackUnlocked(this.state);
    }

    get canStart(): boolean {
        return canStart(this.state) && !this.undecodable;
    }

    /** Start, or resume after Stop. */
    async start(): Promise<void> {
        if (!this.canStart) return;
        this.error = null;
        const settings = await this.deps.currentSettings();
        if (this.disposed) return;
        if (!settings) {
            this.error = "The model is not loaded.";
            this.deps.onChange();
            return;
        }
        if (this.state.status === "idle") this.begin(settings);
        this.dispatch({ type: "start" });
        await this.runUntilDoneOrStopped();
    }

    stop(): void {
        if (this.state.status !== "running") return;
        this.runner?.stop();
    }

    /** Re-checks the cache against the current settings (call after any settings or class change). */
    settingsChanged(): void {
        if (!this.keys) return;
        const current = this.deps.currentSettingsNow();
        const change = staleness(this.keys, current);
        if (change !== "none" && this.state.status === "running") this.runner?.stop();
        this.dispatch({ type: "settings", staleness: change });
    }

    /** Replaces the cache: re-runs tracking only, or the whole analysis, as the change requires. */
    async reanalyze(): Promise<void> {
        if (this.state.status !== "stale") return;
        const settings = await this.deps.currentSettings();
        if (this.disposed || !settings) return;
        const change = this.keys ? staleness(this.keys, settings) : "full";
        if (change === "none") {
            this.dispatch({ type: "settings", staleness: "none" });
            return;
        }
        if (change === "tracking" && this.cache) {
            this.tracking = TrackingRun.over(samplesOf(this.cache), settings.trackingSettings);
            this.keys = { inference: settings.inference, tracking: settings.tracking };
            this.dispatch({ type: "settings", staleness: "tracking" }); // keep `kind` in sync before resolving
            this.dispatch({ type: "reanalyze" });
            return;
        }
        this.begin(settings);
        this.dispatch({ type: "settings", staleness: "full" });
        this.dispatch({ type: "reanalyze" });
        await this.runUntilDoneOrStopped();
    }

    dispose(): void {
        this.disposed = true;
        this.runner?.dispose();
        this.runner = null;
    }

    /** A fresh cache, tracking run and runner for the given settings. */
    private begin(settings: CurrentAnalysisSettings): void {
        this.runner?.dispose();
        this.runner = new PreAnalysisRunner(this.file, settings.inference.maxInferenceFps, (frame) =>
            this.deps.detect(frame)
        );
        this.cache = new InMemoryAnalysisCache();
        this.tracking = new TrackingRun(settings.trackingSettings);
        this.keys = { inference: settings.inference, tracking: settings.tracking };
        this.progress = null;
        this.completedInMs = null;
    }

    private async runUntilDoneOrStopped(): Promise<void> {
        const runner = this.runner;
        const cache = this.cache;
        const tracking = this.tracking;
        if (!runner || !cache || !tracking) return;
        try {
            this.info = await runner.prepare();
            this.deps.onChange();
            const outcome = await runner.run(cache, tracking, (progress) => {
                this.progress = progress;
                this.deps.onChange();
            });
            if (this.disposed || runner !== this.runner) return;
            if (outcome === "finished") this.completedInMs = this.progress?.elapsedMs ?? null;
            // A settings change during the run already moved the state to "stale"; stop/finish then do nothing.
            this.dispatch({ type: outcome === "finished" ? "finish" : "stop" });
        } catch (error) {
            if (this.disposed || runner !== this.runner) return;
            this.error = error instanceof Error ? error.message : String(error);
            if (error instanceof UndecodableVideoError) this.undecodable = true;
            // Keep what was analyzed (stopped); with nothing analyzed there is nothing to keep.
            this.dispatch(cache.length > 0 ? { type: "stop" } : { type: "reset" });
            if (cache.length === 0) this.keys = null;
        }
    }

    private dispatch(event: PreAnalysisEvent): void {
        this.state = reducePreAnalysis(this.state, event);
        this.deps.onChange();
    }
}

function* samplesOf(cache: AnalysisCache): Generator<AnalysisSample> {
    for (let i = 0; i < cache.length; i++) yield cache.at(i);
}
