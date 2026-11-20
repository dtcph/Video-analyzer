import type { ClassCount } from "./countDetections";

/** One tile of the result treemap: a class and how many objects of it were counted. */
export interface TreemapDatum {
    classId: number;
    label: string;
    count: number;
    /** The class is disabled: its total stays but no longer increases. */
    inactive: boolean;
}

/** A flat hierarchy (root → one leaf per class), the shape d3-hierarchy lays out. */
export interface TreemapData {
    children: TreemapDatum[];
}

/**
 * Per-class totals → treemap data: only classes with at least one object,
 * largest first (ties by class id), so the same totals always give the same
 * tile order. The tile area is the count. Pure; the input is not changed.
 */
export function buildTreemapData(counts: readonly ClassCount[]): TreemapData {
    const children = counts
        .filter((c) => c.count > 0)
        .map((c) => ({ classId: c.classId, label: c.label, count: c.count, inactive: c.inactive === true }))
        .sort((a, b) => b.count - a.count || a.classId - b.classId);
    return { children };
}
