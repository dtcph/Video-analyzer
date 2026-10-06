import type { MediaFileCheck, MediaKind } from "../input/MediaFiles";

export type MediaSelectedHandler = (file: File, kind: MediaKind) => void;

/** Drop zone + file picker for images and videos. Validation is injected; this panel only reports results. */
export class UploadPanel {
    readonly element: HTMLElement;
    private readonly errorEl: HTMLElement;
    private onSelected: MediaSelectedHandler | null = null;

    constructor(private readonly check: (file: File) => MediaFileCheck) {
        this.element = document.createElement("div");
        this.element.className = "upload-panel";
        this.element.innerHTML = `
            <div class="upload-dropzone" tabindex="0" role="button">
                <p class="upload-title">Drop an image or video here</p>
                <p class="upload-subtitle">or click to browse: JPEG / PNG / WebP, MP4 / WebM up to 500 MB</p>
                <input type="file" accept="image/*,video/mp4,video/webm,video/*" class="upload-input" hidden />
            </div>
            <p class="upload-error" role="alert" hidden></p>
        `;

        const dropzone = this.element.querySelector(".upload-dropzone") as HTMLElement;
        const input = this.element.querySelector(".upload-input") as HTMLInputElement;
        this.errorEl = this.element.querySelector(".upload-error") as HTMLElement;

        dropzone.addEventListener("click", () => input.click());
        dropzone.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                input.click();
            }
        });
        dropzone.addEventListener("dragover", (event) => {
            event.preventDefault();
            dropzone.classList.add("is-dragover");
        });
        dropzone.addEventListener("dragleave", () => dropzone.classList.remove("is-dragover"));
        dropzone.addEventListener("drop", (event) => {
            event.preventDefault();
            dropzone.classList.remove("is-dragover");
            const file = event.dataTransfer?.files?.[0];
            if (file) this.handleFile(file);
        });
        input.addEventListener("change", () => {
            const file = input.files?.[0];
            if (file) this.handleFile(file);
            input.value = "";
        });
    }

    onSelect(handler: MediaSelectedHandler): void {
        this.onSelected = handler;
    }

    showError(message: string): void {
        this.errorEl.textContent = message;
        this.errorEl.hidden = false;
    }

    clearError(): void {
        this.errorEl.hidden = true;
        this.errorEl.textContent = "";
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
