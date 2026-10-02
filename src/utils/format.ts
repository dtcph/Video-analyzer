/** mm:ss.mmm, used by the timeline readout. */
export function formatTimecode(seconds: number): string {
    const totalMs = Math.max(0, Math.round(seconds * 1000));
    const ms = totalMs % 1000;
    const totalSeconds = Math.floor(totalMs / 1000);
    const s = totalSeconds % 60;
    const m = Math.floor(totalSeconds / 60);
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

/** Binary units (1 KB = 1024 B), matching how browsers and OSes report file sizes. */
export function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    const units = ["KB", "MB", "GB"];
    let value = bytes / 1024;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex++;
    }
    return `${value.toFixed(1)} ${units[unitIndex]}`;
}
