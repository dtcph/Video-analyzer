import { describe, expect, it } from "vitest";
import { FrameGate } from "../../src/inference/FrameGate";

function gateWithClock() {
    let time = 0;
    const discarded: string[] = [];
    const gate = new FrameGate<string>(
        (item) => discarded.push(item),
        () => time
    );
    return { gate, discarded, advance: (ms: number) => (time += ms) };
}

describe("FrameGate", () => {
    it("drops everything while closed", () => {
        const { gate, discarded } = gateWithClock();
        expect(gate.offer("a")).toBe(false);
        expect(discarded).toEqual(["a"]);
        expect(gate.getStats()).toMatchObject({ offered: 1, accepted: 0, dropped: 1 });
    });

    it("keeps one frame in flight and the newest one waiting; older waiting frames are dropped", () => {
        const { gate, discarded, advance } = gateWithClock();
        gate.setOpen(true);

        expect(gate.offer("a")).toBe(true);
        expect(gate.isBusy()).toBe(true);
        expect(gate.offer("b")).toBe(false);
        expect(gate.offer("c")).toBe(false);
        expect(discarded).toEqual(["b"]);

        advance(42);
        expect(gate.release()).toBe("c"); // sent right away: the gate stays busy
        expect(gate.isBusy()).toBe(true);
        advance(10);
        expect(gate.release()).toBeNull();
        expect(gate.isBusy()).toBe(false);
        expect(gate.offer("d")).toBe(true);

        expect(gate.getStats()).toEqual({ offered: 4, accepted: 3, dropped: 1, completed: 2, lastLatencyMs: 10 });
    });

    it("clearWaiting drops the waiting frame (stale after a seek)", () => {
        const { gate, discarded } = gateWithClock();
        gate.setOpen(true);
        gate.offer("a");
        gate.offer("b");
        gate.clearWaiting();
        expect(discarded).toEqual(["b"]);
        expect(gate.release()).toBeNull();
        expect(gate.getStats().dropped).toBe(1);
    });

    it("ignores stray releases", () => {
        const { gate } = gateWithClock();
        gate.setOpen(true);
        expect(gate.release()).toBeNull();
        expect(gate.getStats().completed).toBe(0);
    });

    it("closing clears the in-flight and waiting frames so a reopened gate starts fresh", () => {
        const { gate, discarded } = gateWithClock();
        gate.setOpen(true);
        gate.offer("a");
        gate.offer("b");
        gate.setOpen(false);
        expect(discarded).toEqual(["b"]);
        gate.setOpen(true);
        expect(gate.offer("c")).toBe(true);
    });

    it("resetStats zeroes the counters", () => {
        const { gate } = gateWithClock();
        gate.setOpen(true);
        gate.offer("a");
        gate.resetStats();
        expect(gate.getStats()).toEqual({ offered: 0, accepted: 0, dropped: 0, completed: 0, lastLatencyMs: 0 });
    });

    it("acquireWhenIdle waits for the in-flight and the waiting frame, then takes the slot without counting a drop", async () => {
        const { gate } = gateWithClock();
        gate.setOpen(true);
        gate.offer("a");
        gate.offer("b");
        let acquired = false;
        const waiting = gate.acquireWhenIdle().then((ok) => (acquired = ok));
        await Promise.resolve();
        expect(gate.release()).toBe("b");
        await Promise.resolve();
        expect(acquired).toBe(false);
        expect(gate.release()).toBeNull();
        await waiting;
        expect(acquired).toBe(true);
        expect(gate.isBusy()).toBe(true);
        expect(gate.getStats()).toMatchObject({ offered: 2, accepted: 3, dropped: 0 });
    });

    it("acquireWhenIdle resolves false when the gate closes", async () => {
        const { gate } = gateWithClock();
        gate.setOpen(true);
        gate.offer("a");
        const waiting = gate.acquireWhenIdle();
        gate.setOpen(false);
        expect(await waiting).toBe(false);
    });
});
