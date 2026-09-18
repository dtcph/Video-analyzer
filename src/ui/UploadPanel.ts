import { VideoLoader } from "../video/VideoLoader";

export type FileSelectedHandler = (file: File) => void;

export class UploadPanel {
    readonly element: HTMLElement;
    private onFileSelected: FileSelectedHandler | null = null;

    constructor() {
        this.element = document.createElement("div");
        this.element.className = "upload-panel";
        this.element.innerHTML = `
            <div class="upload-dropzone" tabindex="0">
                <p class="upload-title">Drop a video file here</p>
                <p class="upload-subtitle">or click to browse — up to ~500MB</p>
                <input type="file" accept="video/*" class="upload-input" hidden />
            </div>
        `;

        const dropzone = this.element.querySelector(".upload-dropzone") as HTMLElement;
        const input = this.element.querySelector(".upload-input") as HTMLInputElement;

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
        });
    }

    onSelect(handler: FileSelectedHandler): void {
        this.onFileSelected = handler;
    }

    private handleFile(file: File): void {
        if (!VideoLoader.isSupported(file)) {
            window.alert(`Unsupported file type: ${file.type || "unknown"}`);
            return;
        }
        this.onFileSelected?.(file);
    }
}
