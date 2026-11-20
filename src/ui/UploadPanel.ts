import type { MediaFileCheck, MediaKind } from "../input/MediaFiles";

export type MediaSelectedHandler = (file: File, kind: MediaKind) => void;

/**
 * File picker and drop targets for images and videos. It owns only the hidden
 * file input; the elements that open the picker or accept a drop (the start
 * screen's button, the analysis box) belong to the page. Validation is
 * injected; this class only reports results and messages.
 */
export class UploadPanel {
    readonly element: HTMLElement;
    private readonly input: HTMLInputElement;
    private onSelected: MediaSelectedHandler | null = null;
    private onMessage: ((message: string | null) => void) | null = null;

    constructor(private readonly check: (file: File) => MediaFileCheck) {
        this.element = document.createElement("div");
        this.element.className = "upload-panel";
        this.element.innerHTML = `<input type="file" accept="image/*,video/mp4,video/webm,video/*" class="upload-input" hidden />`;
        this.input = this.element.querySelector(".upload-input") as HTMLInputElement;
        this.input.addEventListener("change", () => {
            const file = this.input.files?.[0];
            if (file) this.handleFile(file);
            this.input.value = "";
        });
    }

    onSelect(handler: MediaSelectedHandler): void {
        this.onSelected = handler;
    }

    /** Called with an error text, or null when it is cleared. */
    onError(handler: (message: string | null) => void): void {
        this.onMessage = handler;
    }

    openPicker(): void {
        this.input.click();
    }

    /** A file dropped on `target` is loaded; `target` gets `is-dragover` while a file is over it. */
    attachDropTarget(target: HTMLElement): void {
        target.addEventListener("dragover", (event) => {
            event.preventDefault();
            target.classList.add("is-dragover");
        });
        target.addEventListener("dragleave", () => target.classList.remove("is-dragover"));
        target.addEventListener("drop", (event) => {
            event.preventDefault();
            target.classList.remove("is-dragover");
            const file = event.dataTransfer?.files?.[0];
            if (file) this.handleFile(file);
        });
    }

    showError(message: string): void {
        this.onMessage?.(message);
    }

    clearError(): void {
        this.onMessage?.(null);
    }

    private handleFile(file: File): void {
        this.clearError();
        const result = this.check(file);
        if (!result.ok) {
            this.showError(result.error);
            return;
        }
        this.onSelected?.(file, result.kind);
    }
}
