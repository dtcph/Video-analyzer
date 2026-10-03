import type { ModelInfo, StageTimings } from "../inference/InferenceMessages";

export interface VideoDebugState {
    effectiveFps: number;
    maxFps: number;
    offered: number;
    dropped: number;
    latencyMs: number;
    /** HTMLVideoElement.getVideoPlaybackQuality(): frames the browser failed to present. */
    playbackDropped: number;
    playbackTotal: number;
}

export interface TrackerDebugState {
    tentative: number;
    confirmed: number;
    lost: number;
    /** Main-thread time of the latest tracker update. */
    updateMs: number;
}

export interface DebugState {
    model: ModelInfo | null;
    timings: StageTimings | null;
    input: { width: number; height: number } | null;
    rawCount: number | null;
    shownCount: number | null;
    video?: VideoDebugState | null;
    tracker?: TrackerDebugState | null;
}

/** Read-only diagnostics in the Debug section: backend, model, per-stage timings. */
export class DebugReadout {
    readonly element: HTMLElement;

    constructor() {
        this.element = document.createElement("dl");
        this.element.className = "debug-readout";
        this.render({ model: null, timings: null, input: null, rawCount: null, shownCount: null });
    }

    render(state: DebugState): void {
        const { model, timings } = state;
        const rows: [string, string][] = [
            ["Backend", model ? (model.backend === "webgpu" ? "WebGPU" : `WASM ×${model.threads}`) : "—"],
            ["Model file", model?.file ?? "—"],
            ["Cross-origin isolated", model ? String(model.crossOriginIsolated) : "—"],
            [
                "Model load",
                model
                    ? `${model.fromCache ? "cache" : "network"} ${model.downloadMs.toFixed(0)} ms, session ${model.sessionMs.toFixed(0)} ms`
                    : "—"
            ],
            ["Input", state.input ? `${state.input.width}×${state.input.height}` : "—"],
            [
                "ms pre / infer / post",
                timings
                    ? `${timings.preprocessMs.toFixed(1)} / ${timings.inferenceMs.toFixed(1)} / ${timings.postprocessMs.toFixed(1)}`
                    : "—"
            ],
            ["Detections raw / shown", state.rawCount === null ? "—" : `${state.rawCount} / ${state.shownCount ?? 0}`]
        ];
        const video = state.video;
        if (video) {
            const dropRatio = video.offered > 0 ? (100 * video.dropped) / video.offered : 0;
            rows.push(
                ["Inference FPS", `${video.effectiveFps.toFixed(1)} (max ${video.maxFps})`],
                ["Sampled frames dropped", `${video.dropped} / ${video.offered} (${dropRatio.toFixed(0)}%)`],
                ["Latency capture→result", `${video.latencyMs.toFixed(0)} ms`],
                ["Video frames dropped", `${video.playbackDropped} / ${video.playbackTotal}`]
            );
        }
        const tracker = state.tracker;
        if (tracker) {
            rows.push(
                [
                    "Tracks tentative / confirmed / lost",
                    `${tracker.tentative} / ${tracker.confirmed} / ${tracker.lost}`
                ],
                ["Tracker update", `${tracker.updateMs.toFixed(2)} ms`]
            );
        }
        this.element.replaceChildren(
            ...rows.flatMap(([term, value]) => {
                const dt = document.createElement("dt");
                dt.textContent = term;
                const dd = document.createElement("dd");
                dd.textContent = value;
                return [dt, dd];
            })
        );
    }
}
