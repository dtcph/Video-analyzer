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
});
