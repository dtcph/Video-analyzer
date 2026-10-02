import { describe, expect, it } from "vitest";
import { countByClass, pluralLabel, summarize } from "../../src/counting/countDetections";

describe("countByClass", () => {
    it("counts per class, most frequent first, ties alphabetical", () => {
        const detections = [
            { classId: 2 },
            { classId: 0 },
            { classId: 2 },
            { classId: 16 },
            { classId: 0 },
            { classId: 2 }
        ];
        expect(countByClass(detections)).toEqual([
            { classId: 2, label: "car", count: 3 },
            { classId: 0, label: "person", count: 2 },
            { classId: 16, label: "dog", count: 1 }
        ]);
        expect(countByClass([])).toEqual([]);
    });
});

describe("summarize", () => {
    it("writes an English summary line", () => {
        expect(
            summarize(
                countByClass([
                    { classId: 0 },
                    { classId: 0 },
                    { classId: 0 },
                    { classId: 16 },
                    { classId: 16 },
                    { classId: 2 }
                ])
            )
        ).toBe("3 people, 2 dogs, 1 car");
        expect(pluralLabel("bus", 2)).toBe("buses");
        expect(pluralLabel("sheep", 4)).toBe("sheep");
        expect(pluralLabel("traffic light", 2)).toBe("traffic lights");
        expect(pluralLabel("bench", 2)).toBe("benches");
    });
});
