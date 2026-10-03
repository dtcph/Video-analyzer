import { describe, expect, it } from "vitest";
import { TotalCounter } from "../../src/counting/TotalCounter";

describe("TotalCounter", () => {
    it("counts per class, most frequent first", () => {
        const counter = new TotalCounter();
        counter.add(2);
        counter.add(0);
        counter.add(2);
        expect(counter.totals()).toEqual([
            { classId: 2, label: "car", count: 2 },
            { classId: 0, label: "person", count: 1 }
        ]);
        expect(counter.total()).toBe(3);
    });

    it("marks totals of disabled classes inactive but keeps them", () => {
        const counter = new TotalCounter();
        counter.add(2);
        counter.add(16);
        const enabled = new Uint8Array(80);
        enabled[2] = 1;
        expect(counter.totals(enabled)).toEqual([
            { classId: 2, label: "car", count: 1 },
            { classId: 16, label: "dog", count: 1, inactive: true }
        ]);
    });

    it("moves a count to another class without changing the total", () => {
        const counter = new TotalCounter();
        counter.add(2);
        counter.add(2);
        counter.add(17);
        counter.move(17, 16);
        counter.move(2, 7);
        expect(
            counter
                .totals()
                .map((c) => [c.classId, c.count])
                .sort()
        ).toEqual([
            [16, 1],
            [2, 1],
            [7, 1]
        ]);
        expect(counter.total()).toBe(3);
        counter.move(5, 6); // nothing counted under class 5: ignored
        expect(counter.total()).toBe(3);
    });

    it("resets", () => {
        const counter = new TotalCounter();
        counter.add(1);
        counter.reset();
        expect(counter.totals()).toEqual([]);
        expect(counter.total()).toBe(0);
    });
});
