// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ResultDialog } from "../../src/ui/ResultDialog";
import { EMPTY_MESSAGE, MIN_LABEL_WIDTH_PX, TreemapChart } from "../../src/ui/TreemapChart";

function setup() {
    const dialog = new ResultDialog();
    document.body.replaceChildren(dialog.triggerButton, dialog.element);
    return {
        dialog,
        overlay: dialog.element,
        windowEl: dialog.element.querySelector(".result-dialog") as HTMLElement,
        close: dialog.element.querySelector(".result-close") as HTMLButtonElement
    };
}

const press = (key: string, init: KeyboardEventInit = {}) =>
    document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init }));

describe("ResultDialog", () => {
    beforeEach(() => {
        document.body.replaceChildren();
    });
    afterEach(() => {
        document.body.replaceChildren();
    });

    it("is a labeled modal dialog, closed and out of reach at first", () => {
        const { overlay, windowEl, dialog } = setup();
        expect(windowEl.getAttribute("role")).toBe("dialog");
        expect(windowEl.getAttribute("aria-modal")).toBe("true");
        const title = document.getElementById(windowEl.getAttribute("aria-labelledby") ?? "");
        expect(title?.textContent).toBe("Analysis Result");
        expect(overlay.dataset.state).toBe("closed");
        expect(overlay.hasAttribute("inert")).toBe(true);
        expect(dialog.isOpen()).toBe(false);
    });

    it("opens from the button: state, focus in the dialog, aria-expanded", () => {
        const { dialog, overlay, close } = setup();
        dialog.triggerButton.focus();
        dialog.triggerButton.click();
        expect(dialog.isOpen()).toBe(true);
        expect(overlay.dataset.state).toBe("open");
        expect(overlay.classList.contains("is-open")).toBe(true);
        expect(overlay.hasAttribute("inert")).toBe(false);
        expect(dialog.triggerButton.getAttribute("aria-expanded")).toBe("true");
        expect(document.activeElement).toBe(close);
    });

    it.each([
        ["the close button", ({ close }: ReturnType<typeof setup>) => close.click()],
        ["a click outside the window", ({ overlay }: ReturnType<typeof setup>) => overlay.click()],
        ["Escape", () => press("Escape")]
    ])("closes with %s and returns the focus to the button", (_name, closeIt) => {
        const ctx = setup();
        ctx.dialog.triggerButton.focus();
        ctx.dialog.triggerButton.click();
        closeIt(ctx);
        expect(ctx.dialog.isOpen()).toBe(false);
        expect(ctx.overlay.dataset.state).toBe("closed");
        expect(ctx.overlay.hasAttribute("inert")).toBe(true);
        expect(ctx.dialog.triggerButton.getAttribute("aria-expanded")).toBe("false");
        expect(document.activeElement).toBe(ctx.dialog.triggerButton);
    });

    it("stays open for a click inside the window", () => {
        const { dialog, windowEl } = setup();
        dialog.show();
        windowEl.click();
        expect(dialog.isOpen()).toBe(true);
    });

    it("keeps the focus inside while open (Tab and Shift+Tab)", () => {
        const { dialog, close } = setup();
        dialog.show();
        press("Tab");
        expect(document.activeElement).toBe(close);
        press("Tab", { shiftKey: true });
        expect(document.activeElement).toBe(close);
    });

    it("offers Reset counts in the header only when it applies, and reports the click", () => {
        const { dialog, overlay } = setup();
        const reset = overlay.querySelector(".result-reset") as HTMLButtonElement;
        let resets = 0;
        dialog.onReset(() => resets++);
        expect(reset.hidden).toBe(true);
        dialog.setCanReset(true);
        expect(reset.hidden).toBe(false);
        reset.click();
        expect(resets).toBe(1);
        dialog.setCanReset(false);
        expect(reset.hidden).toBe(true);
    });

    it("ignores Escape while closed", () => {
        const { dialog } = setup();
        press("Escape");
        expect(dialog.isOpen()).toBe(false);
    });
});

describe("TreemapChart", () => {
    const counts = [
        { classId: 0, label: "person", count: 22 },
        { classId: 2, label: "car", count: 8 },
        { classId: 7, label: "truck", count: 1 }
    ];

    function chartWithSize(width: number, height: number) {
        const chart = new TreemapChart(0);
        document.body.replaceChildren(chart.element);
        chart.resize(width, height);
        chart.setActive(true);
        return chart;
    }

    it("shows the empty message until something is counted", () => {
        const chart = chartWithSize(800, 500);
        chart.update([]);
        expect((chart.element.querySelector(".treemap-empty") as HTMLElement).hidden).toBe(false);
        expect(chart.element.querySelector(".treemap-empty")?.textContent).toBe(EMPTY_MESSAGE);
        expect(chart.element.querySelectorAll(".treemap-tile")).toHaveLength(0);
        chart.update(counts);
        expect((chart.element.querySelector(".treemap-empty") as HTMLElement).hidden).toBe(true);
    });

    it("labels each tile with the class and its count", () => {
        const chart = chartWithSize(800, 500);
        chart.update(counts);
        const tile = chart.element.querySelector('.treemap-tile[data-class-id="0"]') as HTMLElement;
        expect(tile.textContent?.trim()).toBe("People 22");
        expect(tile.dataset.count).toBe("22");
    });

    it("follows new totals: the same tile grows, a new class gets a tile", () => {
        const chart = chartWithSize(800, 500);
        chart.update(counts);
        chart.update([...counts.slice(0, 1).map((c) => ({ ...c, count: 30 })), ...counts.slice(1)]);
        expect(chart.element.querySelectorAll(".treemap-tile")).toHaveLength(3);
        expect((chart.element.querySelector('[data-class-id="0"]') as HTMLElement).dataset.count).toBe("30");
        chart.update([...counts, { classId: 5, label: "bus", count: 2 }]);
        expect(chart.element.querySelectorAll(".treemap-tile")).toHaveLength(4);
    });

    it("applies a small shift of a tile at once, without an animation", () => {
        const chart = chartWithSize(800, 500);
        chart.update(counts);
        const tile = () => chart.element.querySelector('[data-class-id="0"]') as HTMLElement;
        const before = tile().style.width;
        chart.update([{ classId: 0, label: "person", count: 23 }, ...counts.slice(1)]);
        // 22 → 23 of 31 moves the edges by a few pixels: the new size is there without waiting for a timer.
        expect(tile().style.width).not.toBe(before);
    });

    it("draws a burst of updates once at the end of the redraw interval", async () => {
        const chart = new TreemapChart(40);
        document.body.replaceChildren(chart.element);
        chart.resize(800, 500);
        chart.update(counts);
        chart.setActive(true); // opening draws at once
        const count = () => (chart.element.querySelector('[data-class-id="0"]') as HTMLElement).dataset.count;
        expect(count()).toBe("22");
        chart.update([{ classId: 0, label: "person", count: 25 }]);
        chart.update([{ classId: 0, label: "person", count: 30 }]);
        expect(count()).toBe("22"); // held back
        await new Promise((done) => setTimeout(done, 80));
        expect(count()).toBe("30"); // only the latest is drawn
    });

    it("removes the tile of a class that is no longer counted", () => {
        const chart = chartWithSize(800, 500);
        chart.update(counts);
        chart.update(counts.slice(0, 2));
        expect(chart.element.querySelector('[data-class-id="7"]')).toBeNull();
    });

    it("shows small tiles without a label, with a tooltip instead", () => {
        const chart = chartWithSize(MIN_LABEL_WIDTH_PX * 2, 300);
        chart.update([
            { classId: 0, label: "person", count: 500 },
            { classId: 7, label: "truck", count: 1 }
        ]);
        const small = chart.element.querySelector('[data-class-id="7"]') as HTMLElement;
        expect(small.querySelector(".treemap-label")).toBeNull();
        expect(small.title).toBe("Truck 1");
        const big = chart.element.querySelector('[data-class-id="0"]') as HTMLElement;
        expect(big.querySelector(".treemap-label")).not.toBeNull();
        expect(big.hasAttribute("title")).toBe(false);
    });

    it("draws nothing while inactive and catches up when activated", () => {
        const chart = new TreemapChart(0);
        document.body.replaceChildren(chart.element);
        chart.resize(800, 500);
        chart.update(counts);
        expect(chart.element.querySelectorAll(".treemap-tile")).toHaveLength(0);
        chart.setActive(true);
        expect(chart.element.querySelectorAll(".treemap-tile")).toHaveLength(3);
    });
});
