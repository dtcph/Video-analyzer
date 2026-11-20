import type { ClassCount } from "../counting/countDetections";
import { summarize } from "../counting/countDetections";
import { classColor } from "../rendering/classColors";

export interface CountsView {
    /** Heading of the always-visible section, e.g. "Total (this image)". */
    totalTitle: string;
    /** null = nothing analyzed yet; shows `message` instead. */
    total: readonly ClassCount[] | null;
    // Current frame (disabled in V4): section shown only when given (paused video). null shows `currentMessage`.
    // current?: readonly ClassCount[] | null;
    // currentMessage?: string;
    message?: string;
    busy?: boolean;
    /** Reset counts is offered (video and webcam): the result dialog shows its button. */
    canReset?: boolean;
}

/**
 * The per-class counts as text with the class colors. It is the source of the
 * totals shown elsewhere (`onRender`) and stays on the page as a screen-reader
 * live region, visually hidden: the visible summary is the result dialog's treemap.
 */
export class CountsPanel {
    readonly element: HTMLElement;
    private readonly totalTitle: HTMLElement;
    private readonly totalBody: HTMLElement;
    // Current frame (disabled in V4):
    // private readonly currentSection: HTMLElement;
    // private readonly currentBody: HTMLElement;
    private readonly renderListeners: ((view: CountsView) => void)[] = [];

    constructor() {
        this.element = document.createElement("section");
        this.element.className = "panel counts-panel";
        this.element.setAttribute("aria-live", "polite");
        this.element.innerHTML = `
            <div class="counts-section">
                <h2 class="panel-title counts-total-title">Total</h2>
                <div class="counts-total"></div>
            </div>
            <!-- Current frame (disabled in V4):
            <div class="counts-section counts-current" hidden>
                <h2 class="panel-title">Current frame</h2>
                <div class="counts-current-body"></div>
            </div>
            -->
        `;
        this.totalTitle = this.element.querySelector(".counts-total-title") as HTMLElement;
        this.totalBody = this.element.querySelector(".counts-total") as HTMLElement;
        // Current frame (disabled in V4):
        // this.currentSection = this.element.querySelector(".counts-current") as HTMLElement;
        // this.currentBody = this.element.querySelector(".counts-current-body") as HTMLElement;
        this.render({
            totalTitle: "Total",
            total: null,
            message: "Load an image or video, or start the camera, to start counting."
        });
    }

    /** Called with every rendered view, e.g. to feed the result treemap with `view.total` (null: nothing analyzed yet). */
    onRender(listener: (view: CountsView) => void): void {
        this.renderListeners.push(listener);
    }

    render(view: CountsView): void {
        // Monotonic render counter: lets automated tests wait for the next update.
        this.element.dataset.revision = String(Number(this.element.dataset.revision ?? 0) + 1);
        this.totalTitle.textContent = view.totalTitle;
        this.element.classList.toggle("is-busy", Boolean(view.busy));
        fillCounts(this.totalBody, view.total, view.message);
        // Current frame (disabled in V4):
        // this.currentSection.hidden = view.current === undefined;
        // if (view.current !== undefined) fillCounts(this.currentBody, view.current, view.currentMessage);
        for (const listener of this.renderListeners) listener(view);
    }
}

function fillCounts(
    container: HTMLElement,
    counts: readonly ClassCount[] | null | undefined,
    message: string | undefined
): void {
    container.replaceChildren();
    if (!counts) {
        const p = document.createElement("p");
        p.className = "panel-empty";
        p.textContent = message ?? "";
        container.appendChild(p);
        return;
    }
    if (counts.length === 0) {
        const p = document.createElement("p");
        p.className = "panel-empty";
        p.textContent = message ?? "No objects of the selected classes found.";
        container.appendChild(p);
        return;
    }

    const summary = document.createElement("p");
    summary.className = "counts-summary";
    summary.textContent = summarize(counts);

    const list = document.createElement("ul");
    list.className = "counts-list";
    for (const count of counts) {
        const item = document.createElement("li");
        item.className = count.inactive ? "counts-row is-inactive" : "counts-row";
        item.dataset.classId = String(count.classId);
        const swatch = document.createElement("span");
        swatch.className = "class-swatch";
        swatch.style.background = classColor(count.classId);
        const label = document.createElement("span");
        label.className = "counts-label";
        label.textContent = count.label;
        if (count.inactive) {
            const tag = document.createElement("span");
            tag.className = "counts-tag";
            tag.textContent = "not counting";
            tag.title = "This class is disabled: its total is kept but no longer increases.";
            label.append(" ", tag);
        }
        const value = document.createElement("span");
        value.className = "counts-value";
        value.textContent = String(count.count);
        item.append(swatch, label, value);
        list.appendChild(item);
    }
    container.append(summary, list);
    if (message) {
        const note = document.createElement("p");
        note.className = "panel-note";
        note.textContent = message;
        container.appendChild(note);
    }
}
