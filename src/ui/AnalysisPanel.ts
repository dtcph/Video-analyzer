import type { PreAnalysisStatus } from "../analysis/PreAnalysisMachine";
import { formatClock } from "../utils/format";

export type AnalysisMode = "realtime" | "pre";

export interface AnalysisPanelView {
    mode: AnalysisMode;
    status: PreAnalysisStatus;
    /** For "stale": what Re-analyze redoes. */
    staleKind?: "tracking" | "full";
    canStart: boolean;
    /** "Resume" after Stop. */
    resume: boolean;
    progress: { framesDone: number; framesTotal: number; elapsedMs: number; etaMs: number | null } | null;
    message: string | null;
    error: string | null;
}

/**
 * Realtime / Pre-analysis selector for uploaded videos, and the pre-analysis
 * controls: Start (Resume) / Stop, a progress bar with percent, frames,
 * elapsed time and ETA, and the "Settings changed" prompt with Re-analyze.
 * Reports user actions only.
 */
export class AnalysisPanel {
    readonly element: HTMLElement;
    private readonly realtimeRadio: HTMLInputElement;
    private readonly preRadio: HTMLInputElement;
    private readonly preSection: HTMLElement;
    private readonly startButton: HTMLButtonElement;
    private readonly stopButton: HTMLButtonElement;
    private readonly progressBar: HTMLProgressElement;
    private readonly progressText: HTMLElement;
    private readonly messageEl: HTMLElement;
    private readonly staleEl: HTMLElement;
    private readonly staleText: HTMLElement;
    private readonly reanalyzeButton: HTMLButtonElement;
    private readonly errorEl: HTMLElement;
    private onModeHandler: ((mode: AnalysisMode) => void) | null = null;
    private onStartHandler: (() => void) | null = null;
    private onStopHandler: (() => void) | null = null;
    private onReanalyzeHandler: (() => void) | null = null;

    constructor() {
        this.element = document.createElement("div");
        this.element.className = "analysis-panel";
        this.element.hidden = true;
        this.element.innerHTML = `
            <div class="analysis-mode" role="radiogroup" aria-label="Analysis mode">
                <label class="settings-check"><input type="radio" name="analysis-mode" value="realtime" checked /> Realtime</label>
                <label class="settings-check"><input type="radio" name="analysis-mode" value="pre" /> Pre-analysis</label>
            </div>
            <div class="analysis-pre" hidden>
                <div class="analysis-controls">
                    <button type="button" class="analysis-start">Start analysis</button>
                    <button type="button" class="analysis-stop" hidden>Stop</button>
                    <progress class="analysis-progress" max="100" value="0"></progress>
                    <span class="analysis-progress-text"></span>
                </div>
                <p class="analysis-message panel-note"></p>
                <div class="analysis-stale" hidden>
                    <span class="analysis-stale-text"></span>
                    <button type="button" class="analysis-reanalyze">Re-analyze</button>
                </div>
                <p class="analysis-error upload-error" role="alert" hidden></p>
            </div>
        `;
        const q = <T extends Element>(selector: string) => this.element.querySelector(selector) as T;
        this.realtimeRadio = q<HTMLInputElement>('input[value="realtime"]');
        this.preRadio = q<HTMLInputElement>('input[value="pre"]');
        this.preSection = q<HTMLElement>(".analysis-pre");
        this.startButton = q<HTMLButtonElement>(".analysis-start");
        this.stopButton = q<HTMLButtonElement>(".analysis-stop");
        this.progressBar = q<HTMLProgressElement>(".analysis-progress");
        this.progressText = q<HTMLElement>(".analysis-progress-text");
        this.messageEl = q<HTMLElement>(".analysis-message");
        this.staleEl = q<HTMLElement>(".analysis-stale");
        this.staleText = q<HTMLElement>(".analysis-stale-text");
        this.reanalyzeButton = q<HTMLButtonElement>(".analysis-reanalyze");
        this.errorEl = q<HTMLElement>(".analysis-error");

        for (const radio of [this.realtimeRadio, this.preRadio]) {
            radio.addEventListener("change", () => {
                if (radio.checked) this.onModeHandler?.(radio.value as AnalysisMode);
            });
        }
        this.startButton.addEventListener("click", () => this.onStartHandler?.());
        this.stopButton.addEventListener("click", () => this.onStopHandler?.());
        this.reanalyzeButton.addEventListener("click", () => this.onReanalyzeHandler?.());
    }

    onModeChange(handler: (mode: AnalysisMode) => void): void {
        this.onModeHandler = handler;
    }

    onStart(handler: () => void): void {
        this.onStartHandler = handler;
    }

    onStop(handler: () => void): void {
        this.onStopHandler = handler;
    }

    onReanalyze(handler: () => void): void {
        this.onReanalyzeHandler = handler;
    }

    show(visible: boolean): void {
        this.element.hidden = !visible;
    }

    render(view: AnalysisPanelView): void {
        this.element.dataset.mode = view.mode;
        this.element.dataset.status = view.status;
        this.realtimeRadio.checked = view.mode === "realtime";
        this.preRadio.checked = view.mode === "pre";
        this.preSection.hidden = view.mode !== "pre";

        const running = view.status === "running";
        this.startButton.hidden = running || view.status === "complete" || view.status === "stale";
        this.startButton.disabled = !view.canStart;
        this.startButton.textContent = view.resume ? "Resume analysis" : "Start analysis";
        this.stopButton.hidden = !running;

        const p = view.progress;
        const percent = p && p.framesTotal > 0 ? Math.min(100, (100 * p.framesDone) / p.framesTotal) : 0;
        this.progressBar.value = view.status === "complete" ? 100 : percent;
        this.progressBar.hidden = !p;
        this.progressText.textContent = p
            ? [
                  `${(view.status === "complete" ? 100 : percent).toFixed(0)}%`,
                  `${p.framesDone} / ${p.framesTotal} frames`,
                  `${formatClock(p.elapsedMs / 1000)} elapsed`,
                  running ? `ETA ${p.etaMs === null ? "…" : formatClock(Math.ceil(p.etaMs / 1000))}` : null
              ]
                  .filter(Boolean)
                  .join(" · ")
            : "";

        this.messageEl.textContent = view.message ?? "";
        this.messageEl.hidden = !view.message;
        this.staleEl.hidden = view.status !== "stale";
        this.staleText.textContent =
            view.staleKind === "tracking"
                ? "Settings changed since this analysis. Re-analyze re-runs tracking on the cached detections (seconds)."
                : "Settings changed since this analysis. Re-analyze runs the whole analysis again.";
        this.errorEl.textContent = view.error ?? "";
        this.errorEl.hidden = !view.error;
    }
}
