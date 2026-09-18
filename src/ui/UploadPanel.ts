import { VideoLoader } from "../video/VideoLoader";
import { formatFileSize } from "../utils/timing";

export type FileSelectedHandler = (file: File) => void;

export class UploadPanel {
    readonly element: HTMLElement;
    private onFileSelected: FileSelectedHandler | null = null;
    private errorEl: HTMLElement;

    constructor() {
        this.element = document.createElement("div");
        this.element.className = "upload-panel";
        this.element.innerHTML = `
            <div class="upload-dropzone" tabindex="0">
                <p class="upload-title">Drop a video file here</p>
                <p class="upload-subtitle">or click to browse — MP4 / WebM, up to ~500MB</p>
                <input type="file" accept="video/mp4,video/webm,video/*" class="upload-input" hidden />
            </div>
            <p class="upload-error" hidden></p>
        `;

        const dropzone = this.element.querySelector(".upload-dropzone") as HTMLElement;
        const input = this.element.querySelector(".upload-input") as HTMLInputElement;
        this.errorEl = this.element.querySelector(".upload-error") as HTMLElement;

        dropzone.addEventListener("click", () => input.click());
        dropzone.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") input.click();
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

    onSelect(handler: FileSelectedHandler): void {
        this.onFileSelected = handler;
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

        const validationError = VideoLoader.validate(file);
        if (validationError) {
            this.showError(validationError);
            return;
        }

        if (!VideoLoader.isRecommendedSize(file)) {
            this.showError(
                `Warning: ${formatFileSize(file.size)} exceeds the ~500MB target — playback may be slow. Loading anyway.`
            );
        }

        this.onFileSelected?.(file);
    }
}
