export interface FrameGateStats {
    /** Frames offered to the gate. */
    offered: number;
    /** Frames let through to the worker. */
    accepted: number;
    /** Frames refused because one was already in flight (or the gate was closed). */
    dropped: number;
    /** Frames whose result came back. */
    completed: number;
    /** Round trip of the most recent completed frame, ms. */
    lastLatencyMs: number;
}

export const EMPTY_FRAME_GATE_STATS: Readonly<FrameGateStats> = {
    offered: 0,
    accepted: 0,
    dropped: 0,
    completed: 0,
    lastLatencyMs: 0
};

/**
 * Keeps at most one frame in flight to the inference worker. A frame
 * offered while the previous one is still being processed is dropped
 * rather than queued, so a slow device lowers its inference rate instead
 * of building a backlog that makes overlays lag behind playback.
 *
 * Pure bookkeeping (ported from the V1 worker client's in-flight logic):
 * the caller owns the frame and must close it when tryAcquire() is false.
 * The clock is injectable for tests.
 */
export class FrameGate {
    private open = false;
    private inFlightSince: number | null = null;
    private stats: FrameGateStats = { ...EMPTY_FRAME_GATE_STATS };
    private idleWaiters: (() => void)[] = [];

    constructor(private readonly now: () => number = () => performance.now()) {}

    /** Opening clears any in-flight state; closing makes every offer a drop. */
    setOpen(open: boolean): void {
        this.open = open;
        if (!open) {
            this.inFlightSince = null;
            const waiters = this.idleWaiters;
            this.idleWaiters = [];
            for (const wake of waiters) wake();
        }
    }

    isOpen(): boolean {
        return this.open;
    }

    isBusy(): boolean {
        return this.inFlightSince !== null;
    }

    /** True if the caller may send this frame now. */
    tryAcquire(): boolean {
        this.stats.offered++;
        if (!this.open || this.inFlightSince !== null) {
            this.stats.dropped++;
            return false;
        }
        this.stats.accepted++;
        this.inFlightSince = this.now();
        return true;
    }

    /**
     * Waits until no frame is in flight, then takes the slot (for one frame
     * that must not be dropped, e.g. the paused frame). Not counted as offered
     * or dropped. Resolves false if the gate is closed.
     */
    async acquireWhenIdle(): Promise<boolean> {
        while (this.inFlightSince !== null) await new Promise<void>((resolve) => this.idleWaiters.push(resolve));
        if (!this.open) return false;
        this.stats.accepted++;
        this.inFlightSince = this.now();
        return true;
    }

    /** Call when the worker answers for the in-flight frame. Stray releases are ignored. */
    release(): void {
        if (this.inFlightSince === null) return;
        this.stats.completed++;
        this.stats.lastLatencyMs = this.now() - this.inFlightSince;
        this.inFlightSince = null;
        const waiters = this.idleWaiters;
        this.idleWaiters = [];
        for (const wake of waiters) wake();
    }

    getStats(): FrameGateStats {
        return { ...this.stats };
    }

    resetStats(): void {
        this.stats = { ...EMPTY_FRAME_GATE_STATS };
    }
}
