import { select } from "d3-selection";
import "d3-transition"; // adds selection.transition()
import type { ClassCount } from "../counting/countDetections";
import { pluralLabel } from "../counting/countDetections";
import { buildTreemapData } from "../counting/treemapData";
import { classColor, classTextColor } from "../rendering/classColors";
import type { TreemapTile } from "../rendering/treemapLayout";
import { layoutTreemap } from "../rendering/treemapLayout";

/** A tile smaller than this in either direction shows no label, only a tooltip. */
export const MIN_LABEL_WIDTH_PX = 88;
export const MIN_LABEL_HEIGHT_PX = 76;
/** Space between tiles. */
export const TILE_GAP_PX = 4;
export const EMPTY_MESSAGE = "Nothing counted yet";
/** How long a tile takes to slide and grow, or to fade in. */
export const TREEMAP_DURATION_MS = 300;
/** A tile that moves or resizes by less than this snaps instead of animating. */
export const SNAP_PX = 24;
/** Live totals redraw the treemap at most this often: more would keep the page re-laying out for nothing. */
export const REDRAW_INTERVAL_MS = 250;

const prefersReducedMotion = (): boolean =>
    typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** "People 22": the class (plural for more than one) and its total. */
function tileText(tile: { label: string; count: number }): { name: string; count: string } {
    const name = pluralLabel(tile.label, tile.count);
    return { name: name.charAt(0).toUpperCase() + name.slice(1), count: String(tile.count) };
}

/**
 * Treemap of the per-class totals: one tile per class, its area the count,
 * labeled with class and number. Tiles are absolutely positioned elements
 * (d3-hierarchy computes the layout, d3-selection joins them to the data,
 * d3-transition slides and grows them, so a change does not jump; no
 * animation under prefers-reduced-motion). While inactive (the dialog is closed) it only keeps the latest
 * totals and draws nothing.
 */
export class TreemapChart {
    readonly element: HTMLElement;
    private readonly tilesEl: HTMLElement;
    private readonly emptyEl: HTMLElement;
    private counts: readonly ClassCount[] = [];
    private width = 0;
    private height = 0;
    private active = false;
    private lastKey = "";
    /** Where each tile is (or is moving to), to tell a small shift from a big one. */
    private geometry = new Map<number, TreemapTile>();
    private readonly resizeObserver: ResizeObserver | null;
    private lastDrawAt = Number.NEGATIVE_INFINITY;
    private pendingDraw: number | null = null;

    constructor(private readonly minIntervalMs = REDRAW_INTERVAL_MS) {
        this.element = document.createElement("div");
        this.element.className = "treemap";
        this.element.innerHTML = `
            <div class="treemap-tiles"></div>
            <p class="treemap-empty" role="status"></p>
        `;
        this.tilesEl = this.element.querySelector(".treemap-tiles") as HTMLElement;
        this.emptyEl = this.element.querySelector(".treemap-empty") as HTMLElement;
        this.emptyEl.textContent = EMPTY_MESSAGE;
        this.resizeObserver =
            typeof ResizeObserver === "undefined"
                ? null
                : new ResizeObserver((entries) => {
                      const box = entries[0]?.contentRect;
                      if (box) this.resize(box.width, box.height);
                  });
        this.resizeObserver?.observe(this.element);
    }

    /** The latest per-class totals; drawn right away only while active. */
    update(counts: readonly ClassCount[]): void {
        this.counts = counts;
        if (!this.active) return;
        // The first change draws at once; the ones that follow within the interval are drawn together at its end.
        const wait = this.lastDrawAt + this.minIntervalMs - performance.now();
        if (wait <= 0) {
            this.draw();
        } else if (this.pendingDraw === null) {
            this.pendingDraw = window.setTimeout(() => {
                this.pendingDraw = null;
                this.draw();
            }, wait);
        }
    }

    /** Active = visible: drawing is skipped while the result dialog is closed. */
    setActive(active: boolean): void {
        this.active = active;
        if (!active) {
            this.cancelPendingDraw();
            return;
        }
        if (this.element.clientWidth > 0 && this.element.clientHeight > 0) {
            this.width = this.element.clientWidth;
            this.height = this.element.clientHeight;
        }
        this.draw();
    }

    resize(width: number, height: number): void {
        this.width = width;
        this.height = height;
        if (this.active) this.draw();
    }

    dispose(): void {
        this.resizeObserver?.disconnect();
        this.cancelPendingDraw();
    }

    private cancelPendingDraw(): void {
        if (this.pendingDraw !== null) window.clearTimeout(this.pendingDraw);
        this.pendingDraw = null;
    }

    private draw(): void {
        this.cancelPendingDraw();
        this.lastDrawAt = performance.now();
        const data = buildTreemapData(this.counts);
        const key = JSON.stringify([data.children, this.width, this.height]);
        if (key === this.lastKey) return;
        this.lastKey = key;

        this.emptyEl.hidden = data.children.length > 0;
        const tiles = layoutTreemap(data, this.width, this.height, TILE_GAP_PX);
        const duration = prefersReducedMotion() ? 0 : TREEMAP_DURATION_MS;
        const placement = (tile: TreemapTile) => ({
            width: `${tile.width}px`,
            height: `${tile.height}px`,
            transform: `translate(${tile.x}px, ${tile.y}px)`
        });

        const bound = select(this.tilesEl)
            .selectAll<HTMLDivElement, TreemapTile>(".treemap-tile")
            .data(tiles, (tile) => tile.classId);
        bound.exit().remove();

        // A new class appears in place and fades in.
        const entered = bound
            .enter()
            .append("div")
            .attr("class", "treemap-tile")
            .style("opacity", "0")
            .each((tile, index, nodes) => Object.assign(nodes[index].style, placement(tile)));
        // Named transitions: a later update (moving a tile) must not cancel the fade-in of a tile that just appeared.
        entered.transition("fade").duration(duration).style("opacity", "1");

        // A class already shown slides and grows to its new place. A shift of a few pixels (the usual
        // effect of one more object) is applied at once: animating it would keep the page re-laying out
        // every frame while the totals change, for a movement nobody sees.
        bound.each((tile, index, nodes) => {
            const el = nodes[index];
            const before = this.geometry.get(tile.classId);
            const shift = before
                ? Math.max(
                      Math.abs(tile.x - before.x),
                      Math.abs(tile.y - before.y),
                      Math.abs(tile.width - before.width),
                      Math.abs(tile.height - before.height)
                  )
                : Infinity;
            if (duration === 0 || shift < SNAP_PX) {
                select(el).interrupt("move");
                Object.assign(el.style, placement(tile));
            } else {
                select(el)
                    .transition("move")
                    .duration(duration)
                    .style("width", placement(tile).width)
                    .style("height", placement(tile).height)
                    .style("transform", placement(tile).transform);
            }
        });
        this.geometry = new Map(tiles.map((tile) => [tile.classId, tile]));

        bound.merge(entered).each((tile, index, nodes) => {
            const el = nodes[index];
            el.style.setProperty("--tile-color", classColor(tile.classId));
            el.style.setProperty("--tile-text", classTextColor(tile.classId));
            el.classList.toggle("is-inactive", tile.inactive);
            el.dataset.classId = String(tile.classId);
            el.dataset.count = String(tile.count);
            const text = tileText(tile);
            if (tile.width >= MIN_LABEL_WIDTH_PX && tile.height >= MIN_LABEL_HEIGHT_PX) {
                el.removeAttribute("title");
                let label = el.querySelector(".treemap-label");
                if (!label) {
                    label = document.createElement("span");
                    label.className = "treemap-label";
                    label.innerHTML = `<span class="treemap-name"></span> <span class="treemap-count"></span>`;
                    el.replaceChildren(label);
                }
                (label.querySelector(".treemap-name") as HTMLElement).textContent = text.name;
                (label.querySelector(".treemap-count") as HTMLElement).textContent = text.count;
            } else {
                el.replaceChildren();
                el.title = `${text.name} ${text.count}`;
            }
        });
    }
}
