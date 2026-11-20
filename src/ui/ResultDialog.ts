import type { ClassCount } from "../counting/countDetections";
import { DialogController } from "./DialogController";
import { iconSvg } from "./icons";
import { TreemapChart } from "./TreemapChart";

/**
 * The "Analysis Result" dialog: a treemap of the per-class totals in a window
 * of about 85% of the viewport. It slides in from the top and out again; the
 * close button, a click outside the window and Esc close it. Reset counts sits
 * in its header. Opening or closing it never touches the analysis behind it:
 * the treemap just follows the totals it is given (`update`), and draws only
 * while the dialog is open.
 */
export class ResultDialog {
    /** Opens the dialog. */
    readonly triggerButton: HTMLButtonElement;
    /** The overlay (backdrop + window): append it once to the page. */
    readonly element: HTMLElement;
    private readonly resetButton: HTMLButtonElement;
    private readonly chart = new TreemapChart();
    private readonly controller: DialogController;
    private onResetHandler: (() => void) | null = null;

    constructor() {
        this.triggerButton = document.createElement("button");
        this.triggerButton.type = "button";
        this.triggerButton.className = "result-open";
        this.triggerButton.setAttribute("aria-label", "Open the analysis result");
        this.triggerButton.title = "Analysis result";
        this.triggerButton.innerHTML = iconSvg("chart", 28);

        this.element = document.createElement("div");
        this.element.className = "result-overlay";
        this.element.innerHTML = `
            <div class="result-dialog" role="dialog" aria-modal="true" aria-labelledby="result-title">
                <header class="result-header">
                    <h2 class="result-title" id="result-title">Analysis Result</h2>
                    <div class="result-actions">
                        <button type="button" class="result-reset" aria-label="Reset counts" title="Reset counts" hidden>${iconSvg("reset")}</button>
                        <button type="button" class="result-close" aria-label="Close analysis result" title="Close">${iconSvg("close")}</button>
                    </div>
                </header>
                <div class="result-body"></div>
            </div>
        `;
        this.resetButton = this.element.querySelector(".result-reset") as HTMLButtonElement;
        const closeButton = this.element.querySelector(".result-close") as HTMLButtonElement;
        (this.element.querySelector(".result-body") as HTMLElement).appendChild(this.chart.element);

        this.controller = new DialogController(this.element, this.triggerButton, closeButton, {
            onShow: () => this.chart.setActive(true),
            onHide: () => this.chart.setActive(false)
        });
        closeButton.addEventListener("click", () => this.hide());
        this.resetButton.addEventListener("click", () => this.onResetHandler?.());
    }

    onReset(handler: () => void): void {
        this.onResetHandler = handler;
    }

    /** Reset counts is offered for video and camera only (an image has nothing to reset). */
    setCanReset(canReset: boolean): void {
        this.resetButton.hidden = !canReset;
    }

    isOpen(): boolean {
        return this.controller.isOpen();
    }

    /** The latest per-class totals (null: nothing analyzed yet). */
    update(counts: readonly ClassCount[] | null): void {
        this.chart.update(counts ?? []);
    }

    show(): void {
        this.controller.show();
    }

    hide(): void {
        this.controller.hide();
    }
}
