import { describe, expect, it } from "vitest";
import { buildTreemapData } from "../../src/counting/treemapData";
import { layoutTreemap } from "../../src/rendering/treemapLayout";

const data = buildTreemapData([
    { classId: 0, label: "person", count: 60 },
    { classId: 2, label: "car", count: 30 },
    { classId: 7, label: "truck", count: 10 }
]);

describe("layoutTreemap", () => {
    it("returns no tiles for no data or an empty box", () => {
        expect(layoutTreemap({ children: [] }, 800, 500)).toEqual([]);
        expect(layoutTreemap(data, 0, 500)).toEqual([]);
        expect(layoutTreemap(data, 800, 0)).toEqual([]);
    });

    it("fills a single class with the whole box", () => {
        const [tile] = layoutTreemap(buildTreemapData([{ classId: 0, label: "person", count: 5 }]), 800, 500);
        expect(tile).toMatchObject({ classId: 0, x: 0, y: 0, width: 800, height: 500 });
    });

    it("keeps every tile inside the box and the tiles apart", () => {
        const tiles = layoutTreemap(data, 800, 500, 4);
        expect(tiles).toHaveLength(3);
        for (const t of tiles) {
            expect(t.x).toBeGreaterThanOrEqual(0);
            expect(t.y).toBeGreaterThanOrEqual(0);
            expect(t.x + t.width).toBeLessThanOrEqual(800);
            expect(t.y + t.height).toBeLessThanOrEqual(500);
        }
        for (const a of tiles) {
            for (const b of tiles) {
                if (a === b) continue;
                const apart =
                    a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
                expect(apart).toBe(true);
            }
        }
    });

    it("gives each tile an area in proportion to its count", () => {
        const tiles = layoutTreemap(data, 800, 500);
        const area = (classId: number) => {
            const t = tiles.find((tile) => tile.classId === classId);
            return (t?.width ?? 0) * (t?.height ?? 0);
        };
        expect(area(0) / area(2)).toBeCloseTo(2, 1);
        expect(area(2) / area(7)).toBeCloseTo(3, 1);
    });

    it("carries the data of each class", () => {
        const tile = layoutTreemap(data, 800, 500).find((t) => t.classId === 2);
        expect(tile).toMatchObject({ label: "car", count: 30, inactive: false });
    });
});
