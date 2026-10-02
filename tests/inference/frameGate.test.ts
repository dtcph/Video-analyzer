import { describe, expect, it } from "vitest";
import { FrameGate } from "../../src/inference/FrameGate";

function gateWithClock() {
    let time = 0;
    const gate = new FrameGate(() => time);
    return { gate, advance: (ms: number) => (time += ms) };
}

describe("FrameGate", () => {
    it("drops everything while closed", () => {
        const { gate } = gateWithClock();
        expect(gate.tryAcquire()).toBe(false);
        expect(gate.getStats()).toMatchObject({ offered: 1, accepted: 0, dropped: 1 });
    });

    it("keeps at most one frame in flight and drops the rest", () => {
        const { gate, advance } = gateWithClock();
        gate.setOpen(true);

        expect(gate.tryAcquire()).toBe(true);
        expect(gate.isBusy()).toBe(true);
        expect(gate.tryAcquire()).toBe(false);
        expect(gate.tryAcquire()).toBe(false);

        advance(42);
        gate.release();
        expect(gate.isBusy()).toBe(false);
        expect(gate.tryAcquire()).toBe(true);

        expect(gate.getStats()).toEqual({ offered: 4, accepted: 2, dropped: 2, completed: 1, lastLatencyMs: 42 });
    });

    it("ignores stray releases", () => {
        const { gate } = gateWithClock();
        gate.setOpen(true);
        gate.release();
        expect(gate.getStats().completed).toBe(0);
    });

    it("closing clears the in-flight frame so a reopened gate starts fresh", () => {
        const { gate } = gateWithClock();
        gate.setOpen(true);
        gate.tryAcquire();
        gate.setOpen(false);
        gate.setOpen(true);
        expect(gate.tryAcquire()).toBe(true);
    });

    it("resetStats zeroes the counters", () => {
        const { gate } = gateWithClock();
        gate.setOpen(true);
        gate.tryAcquire();
        gate.resetStats();
        expect(gate.getStats()).toEqual({ offered: 0, accepted: 0, dropped: 0, completed: 0, lastLatencyMs: 0 });
    });

    it("acquireWhenIdle waits for the in-flight frame, then takes the slot without counting a drop", async () => {
        const { gate } = gateWithClock();
        gate.setOpen(true);
        gate.tryAcquire();
        let acquired = false;
        const waiting = gate.acquireWhenIdle().then((ok) => (acquired = ok));
        await Promise.resolve();
        expect(acquired).toBe(false);
        gate.release();
        await waiting;
        expect(acquired).toBe(true);
        expect(gate.isBusy()).toBe(true);
        expect(gate.getStats()).toMatchObject({ offered: 1, accepted: 2, dropped: 0 });
    });

    it("acquireWhenIdle resolves false when the gate closes", async () => {
        const { gate } = gateWithClock();
        gate.setOpen(true);
        gate.tryAcquire();
        const waiting = gate.acquireWhenIdle();
        gate.setOpen(false);
        expect(await waiting).toBe(false);
    });
});
