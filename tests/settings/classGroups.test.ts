import { describe, expect, it } from "vitest";
import { COCO_CLASSES } from "../../src/inference/cocoClasses";
import { ClassSelectionStore } from "../../src/settings/ClassSelectionStore";
import {
    CLASS_GROUPS,
    classIdOf,
    defaultEnabledClasses,
    enabledMask,
    groupById,
    groupState
} from "../../src/settings/classGroups";

const group = (id: string) => {
    const found = groupById(id);
    if (!found) throw new Error(id);
    return found;
};

describe("CLASS_GROUPS", () => {
    it("puts every COCO class in exactly one group", () => {
        const all = CLASS_GROUPS.flatMap((g) => g.classes);
        expect(all).toHaveLength(COCO_CLASSES.length);
        expect(new Set(all)).toEqual(new Set(COCO_CLASSES));
    });

    it("matches the brief's group order and default groups", () => {
        expect(CLASS_GROUPS.map((g) => g.label)).toEqual([
            "People",
            "Animals",
            "Transportation",
            "Street & outdoor",
            "Personal items",
            "Sports",
            "Kitchen & food",
            "Furniture & household",
            "Electronics & appliances"
        ]);
        const defaults = defaultEnabledClasses();
        expect(defaults.size).toBe(1 + 10 + 8);
        expect(defaults.has(classIdOf("person"))).toBe(true);
        expect(defaults.has(classIdOf("dog"))).toBe(true);
        expect(defaults.has(classIdOf("truck"))).toBe(true);
        expect(defaults.has(classIdOf("frisbee"))).toBe(false);
    });

    it("reports all / some / none per group", () => {
        const enabled = new Set([classIdOf("car")]);
        expect(groupState(group("transportation"), enabled)).toBe("some");
        expect(groupState(group("people"), enabled)).toBe("none");
        expect(groupState(group("people"), new Set([0]))).toBe("all");
    });

    it("builds a per-class mask", () => {
        const mask = enabledMask(new Set([0, 79]));
        expect(mask).toHaveLength(80);
        expect(mask[0]).toBe(1);
        expect(mask[79]).toBe(1);
        expect(mask.reduce((a, b) => a + b, 0)).toBe(2);
    });
});

describe("ClassSelectionStore", () => {
    it("toggles groups: partial → all → none", () => {
        const store = new ClassSelectionStore();
        const transport = group("transportation");
        store.setClass(classIdOf("car"), false);
        expect(groupState(transport, store.getEnabled())).toBe("some");
        store.toggleGroup(transport);
        expect(groupState(transport, store.getEnabled())).toBe("all");
        store.toggleGroup(transport);
        expect(groupState(transport, store.getEnabled())).toBe("none");
    });

    it("keeps the mask in sync and notifies only on real changes", () => {
        const store = new ClassSelectionStore();
        const calls: number[] = [];
        store.onChange((enabled) => calls.push(enabled.size));
        store.setClass(classIdOf("person"), true); // already on
        store.setClass(classIdOf("person"), false);
        expect(calls).toEqual([18]);
        expect(store.getMask()[classIdOf("person")]).toBe(0);
        store.resetToDefaults();
        expect(store.isAtDefaults()).toBe(true);
        expect(store.getMask()[classIdOf("person")]).toBe(1);
    });
});
