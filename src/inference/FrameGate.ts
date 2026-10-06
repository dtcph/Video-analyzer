export interface FrameGateStats {
    /** Frames offered to the gate. */
    offered: number;
    /** Frames let through to the worker. */
    accepted: number;
    /** Frames never sent: replaced while waiting, discarded, or offered while the gate was closed. */
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
 * Keeps at most one frame in flight to the inference worker, plus at most
 * one waiting: a frame offered while another is being processed waits and
 * is sent as soon as the worker answers; a newer offer replaces it (the
 * older one is dropped). So a slow device lowers its inference rate instead
 * of building a backlog, and the worker never idles until the next video
 * frame (Phase 8: frames presented unevenly, 17/50 ms apart, were dropped
 * although inference took less than a frame interval; docs/performance.md).
 *
 * Pure bookkeeping (in-flight logic): the
 * gate owns waiting items and hands each dropped one to `discard` (e.g. to
 * close a VideoFrame). The clock is injectable for tests.
 */
export class FrameGate<T = unknown> {
    private open = false;
    private inFlightSince: number | null = null;
    private waiting: T | null = null;
    private stats: FrameGateStats = { ...EMPTY_FRAME_GATE_STATS };
    private idleWaiters: (() => void)[] = [];

    constructor(
        private readonly discard: (item: T) => void = () => {},
        private readonly now: () => number = () => performance.now()
    ) {}

    /** Opening clears any in-flight state; closing drops the waiting item and makes every offer a drop. */
    setOpen(open: boolean): void {
        this.open = open;
        if (!open) {
            this.inFlightSince = null;
            this.clearWaiting();
            this.wakeWaiters();
        }
    }

    isOpen(): boolean {
        return this.open;
    }

    isBusy(): boolean {
        return this.inFlightSince !== null;
    }

    /**
     * Offers an item. True: the caller sends it now. False: it waits (comes
     * back from release()) or, with the gate closed, was dropped.
     */
    offer(item: T): boolean {
        this.stats.offered++;
        if (!this.open) {
            this.stats.dropped++;
            this.discard(item);
            return false;
        }
        if (this.inFlightSince !== null) {
            this.clearWaiting();
            this.waiting = item;
            return false;
        }
        this.take();
        return true;
    }

    /** Drops the waiting item, if any (e.g. after a seek made it stale). */
    clearWaiting(): void {
        if (this.waiting === null) return;
        const item = this.waiting;
        this.waiting = null;
        this.stats.dropped++;
        this.discard(item);
    }

    /**
     * Waits until no frame is in flight or waiting, then takes the slot (for
     * one frame that must not be dropped, e.g. the paused frame). Not counted
     * as offered or dropped. Resolves false if the gate is closed.
     */
    async acquireWhenIdle(): Promise<boolean> {
        while (this.inFlightSince !== null) await new Promise<void>((resolve) => this.idleWaiters.push(resolve));
        if (!this.open) return false;
        this.take();
        return true;
    }

    /**
     * Call when the worker answers for the in-flight frame. Returns the
     * waiting item, which now holds the slot (the caller sends it), or null
     * when the gate is idle. Stray releases are ignored.
     */
    release(): T | null {
        if (this.inFlightSince === null) return null;
        this.stats.completed++;
        this.stats.lastLatencyMs = this.now() - this.inFlightSince;
        this.inFlightSince = null;
        if (this.waiting !== null && this.open) {
            const next = this.waiting;
            this.waiting = null;
            this.take();
            return next;
        }
        this.wakeWaiters();
        return null;
    }

    getStats(): FrameGateStats {
        return { ...this.stats };
    }

    resetStats(): void {
        this.stats = { ...EMPTY_FRAME_GATE_STATS };
    }

    private take(): void {
        this.stats.accepted++;
        this.inFlightSince = this.now();
    }

    private wakeWaiters(): void {
        const waiters = this.idleWaiters;
        this.idleWaiters = [];
        for (const wake of waiters) wake();
    }
}
