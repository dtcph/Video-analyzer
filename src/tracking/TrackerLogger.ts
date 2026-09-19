/**
 * Structured, toggleable debug logging for tracker decisions —
 * lifecycle transitions and reidentification scoring, in the format
 * described in the tracking README. Off by default (console noise at
 * 12fps analysis would otherwise be unusable); flip on with
 * `trackerLogger.setEnabled(true)` from the browser console, or via
 * the "Debug logging" checkbox in TrackingControls.
 */
class TrackerLogger {
    private enabled = false;

    setEnabled(enabled: boolean): void {
        this.enabled = enabled;
    }

    isEnabled(): boolean {
        return this.enabled;
    }

    trackState(trackId: number, fields: Record<string, string | number>): void {
        if (!this.enabled) return;
        const body = Object.entries(fields)
            .map(([key, value]) => `${key}: ${value}`)
            .join("\n");
        // eslint-disable-next-line no-console -- intentional, gated by `enabled`
        console.log(`[TRACK ${String(trackId).padStart(2, "0")}]\n${body}`);
    }

    reidentified(trackId: number, blobId: number, scores: Record<string, number>): void {
        if (!this.enabled) return;
        const body = Object.entries(scores)
            .map(([key, value]) => `${key}: ${value.toFixed(3)}`)
            .join("\n");
        console.log(`[TRACK ${String(trackId).padStart(2, "0")}]\nREIDENTIFIED\ncandidate: blob ${blobId}\n${body}`);
    }
}

export const trackerLogger = new TrackerLogger();
