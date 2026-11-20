import { hierarchy, treemap, treemapSquarify } from "d3-hierarchy";
import type { TreemapData, TreemapDatum } from "../counting/treemapData";

export interface TreemapTile extends TreemapDatum {
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * Squarified treemap layout (d3-hierarchy) of the class totals inside a
 * `width` × `height` box, with `gap` pixels between tiles. Pure: no DOM.
 * Returns no tiles for empty data or an empty box.
 */
export function layoutTreemap(data: TreemapData, width: number, height: number, gap = 0): TreemapTile[] {
    if (data.children.length === 0 || width <= 0 || height <= 0) return [];
    const root = hierarchy<TreemapData | TreemapDatum>(data, (d) => ("children" in d ? d.children : null))
        .sum((d) => ("count" in d ? d.count : 0))
        .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    const laidOut = treemap<TreemapData | TreemapDatum>()
        .tile(treemapSquarify)
        .size([width, height])
        .paddingInner(gap)
        .round(true)(root);
    return laidOut.leaves().map((leaf) => ({
        ...(leaf.data as TreemapDatum),
        x: leaf.x0,
        y: leaf.y0,
        width: leaf.x1 - leaf.x0,
        height: leaf.y1 - leaf.y0
    }));
}
