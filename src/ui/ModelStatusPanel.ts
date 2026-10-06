import type { LoadProgress, ModelInfo } from "../inference/InferenceMessages";
import { formatFileSize } from "../utils/format";

const STAGE_TEXT: Record<LoadProgress["stage"], string> = {
    runtime: "Loading the inference runtime…",
    download: "Downloading the model…",
    session: "Preparing the model…"
};

/**
 * Model loading state: progress bar while loading, the active model and
 * backend when ready (plus any fallback notes), and errors with a Retry button.
 */
export class ModelStatusPanel {
    readonly element: HTMLElement;
    private readonly text: HTMLElement;
    private readonly bar: HTMLProgressElement;
    private readonly notes: HTMLElement;
    private readonly retryButton: HTMLButtonElement;
    private onRetryHandler: (() => void) | null = null;

    constructor() {
        this.element = document.createElement("section");
        this.element.className = "panel model-status";
        this.element.innerHTML = `
            <p class="model-status-text" role="status"></p>
            <progress class="model-status-bar" max="1" value="0"></progress>
            <ul class="model-status-notes"></ul>
            <button type="button" class="model-status-retry" hidden>Retry</button>
        `;
        this.text = this.element.querySelector(".model-status-text") as HTMLElement;
        this.bar = this.element.querySelector(".model-status-bar") as HTMLProgressElement;
        this.notes = this.element.querySelector(".model-status-notes") as HTMLElement;
        this.retryButton = this.element.querySelector(".model-status-retry") as HTMLButtonElement;
        this.retryButton.addEventListener("click", () => this.onRetryHandler?.());
    }

    onRetry(handler: () => void): void {
        this.onRetryHandler = handler;
    }

    showProgress(progress: LoadProgress | null): void {
        this.element.dataset.state = "loading";
        this.retryButton.hidden = true;
        this.bar.hidden = false;
        if (!progress) {
            this.text.textContent = "Loading the model…";
            this.bar.removeAttribute("value");
            return;
        }
        const fraction = progress.totalBytes > 0 ? progress.loadedBytes / progress.totalBytes : 0;
        this.text.textContent =
            progress.stage === "download"
                ? `${STAGE_TEXT.download} ${formatFileSize(progress.loadedBytes)} / ${formatFileSize(progress.totalBytes)}`
                : STAGE_TEXT[progress.stage];
        if (progress.stage === "download") this.bar.value = fraction;
        else this.bar.removeAttribute("value");
    }

    showReady(info: ModelInfo): void {
        this.element.dataset.state = "ready";
        this.retryButton.hidden = true;
        this.bar.hidden = true;
        const model = info.modelSize === "s" ? "YOLOv8s" : "YOLOv8n";
        const backend =
            info.backend === "webgpu"
                ? "WebGPU"
                : `WASM (CPU, ${info.threads} ${info.threads === 1 ? "thread" : "threads"})`;
        this.text.textContent = `${model} ready on ${backend}.`;
        this.setNotes(info.notes);
    }

    showError(message: string): void {
        this.element.dataset.state = "error";
        this.bar.hidden = true;
        this.text.textContent = `The model failed to load: ${message}`;
        this.setNotes([]);
        this.retryButton.hidden = false;
    }

    private setNotes(notes: readonly string[]): void {
        this.notes.replaceChildren(
            ...notes.map((note) => {
                const item = document.createElement("li");
                item.textContent = note;
                return item;
            })
        );
    }
}
