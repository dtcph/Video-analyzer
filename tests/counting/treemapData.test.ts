import { describe, expect, it } from "vitest";
import type { ClassCount } from "../../src/counting/countDetections";
import { buildTreemapData } from "../../src/counting/treemapData";

describe("buildTreemapData", () => {
    it("is empty for no totals", () => {
        expect(buildTreemapData([])).toEqual({ children: [] });
    });

    it("makes one leaf for a single class, its count as the value", () => {
        const data = buildTreemapData([{ classId: 0, label: "person", count: 22 }]);
        expect(data.children).toEqual([{ classId: 0, label: "person", count: 22, inactive: false }]);
    });

    it("drops classes without objects", () => {
        const data = buildTreemapData([
            { classId: 2, label: "car", count: 3 },
            { classId: 5, label: "bus", count: 0 }
        ]);
        expect(data.children.map((c) => c.label)).toEqual(["car"]);
    });

    it("orders by count, then class id, whatever the input order", () => {
        const counts: ClassCount[] = [
            { classId: 7, label: "truck", count: 2 },
            { classId: 0, label: "person", count: 5 },
            { classId: 2, label: "car", count: 2 }
        ];
        expect(buildTreemapData(counts).children.map((c) => c.classId)).toEqual([0, 2, 7]);
        expect(buildTreemapData([...counts].reverse()).children.map((c) => c.classId)).toEqual([0, 2, 7]);
    });

    it("keeps the inactive flag of disabled classes", () => {
        const data = buildTreemapData([
            { classId: 0, label: "person", count: 1, inactive: true },
            { classId: 2, label: "car", count: 1 }
        ]);
        expect(data.children.map((c) => c.inactive)).toEqual([true, false]);
    });

    it("does not change its input", () => {
        const counts: ClassCount[] = [
            { classId: 2, label: "car", count: 1 },
            { classId: 0, label: "person", count: 4 }
        ];
        const snapshot = structuredClone(counts);
        Object.freeze(counts);
        for (const c of counts) Object.freeze(c);
        buildTreemapData(counts);
        expect(counts).toEqual(snapshot);
    });
});
