import type { ModelInfo, StageTimings } from "../inference/InferenceMessages";

export interface DebugState {
    model: ModelInfo | null;
    timings: StageTimings | null;
    input: { width: number; height: number } | null;
    rawCount: number | null;
    shownCount: number | null;
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
