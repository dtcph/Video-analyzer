import type { VideoMetadata } from "../video/VideoTypes";
import { formatFileSize, formatTimecode } from "../utils/timing";

/**
 * Read-only strip of source-file facts (dimensions, fps, size,
 * duration) — instrument-panel readout, not an editable properties
 * form.
 */
export class MetadataPanel {
    readonly element: HTMLElement;

    constructor() {
        this.element = document.createElement("div");
        this.element.className = "metadata-panel";
        this.element.hidden = true;
    }

    show(metadata: VideoMetadata): void {
        const fps = metadata.frameRateDetected ? `${metadata.frameRate}` : `${metadata.frameRate} (assumed)`;

        this.element.innerHTML = `
            <span class="metadata-item"><span class="metadata-label">File</span>${escapeHtml(metadata.fileName)}</span>
            <span class="metadata-item"><span class="metadata-label">Dimensions</span>${metadata.width}×${metadata.height}</span>
            <span class="metadata-item"><span class="metadata-label">FPS</span>${fps}</span>
            <span class="metadata-item"><span class="metadata-label">Duration</span>${formatTimecode(metadata.durationSeconds)}</span>
            <span class="metadata-item"><span class="metadata-label">Size</span>${formatFileSize(metadata.fileSizeBytes)}</span>
        `;
        this.element.hidden = false;
    }

    hide(): void {
        this.element.hidden = true;
        this.element.innerHTML = "";
    }
}

function escapeHtml(value: string): string {
    const div = document.createElement("div");
    div.textContent = value;
    return div.innerHTML;
}
