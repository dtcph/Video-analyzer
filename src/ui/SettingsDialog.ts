import { DialogController } from "./DialogController";
import { iconSvg } from "./icons";

/**
 * The settings pop-up (bottom right): opened by the gear button, it holds the
 * given content (threshold, model, advanced settings, camera choice). The
 * close button, a click outside and Esc close it.
 */
export class SettingsDialog {
    /** The gear: opens the dialog. */
    readonly triggerButton: HTMLButtonElement;
    /** The overlay (transparent backdrop + window): append it once to the page. */
    readonly element: HTMLElement;
    private readonly controller: DialogController;

    constructor(content: readonly HTMLElement[]) {
        this.triggerButton = document.createElement("button");
        this.triggerButton.type = "button";
        this.triggerButton.className = "settings-open";
        this.triggerButton.setAttribute("aria-label", "Settings");
        this.triggerButton.title = "Settings";
        this.triggerButton.innerHTML = iconSvg("gear");

        this.element = document.createElement("div");
        this.element.className = "settings-overlay";
        this.element.innerHTML = `
            <div class="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
                <header class="settings-dialog-header">
                    <h2 class="settings-dialog-title" id="settings-title">Settings</h2>
                    <button type="button" class="settings-close" aria-label="Close settings" title="Close">${iconSvg("close")}</button>
                </header>
                <div class="settings-dialog-body"></div>
            </div>
        `;
        (this.element.querySelector(".settings-dialog-body") as HTMLElement).append(...content);
        const closeButton = this.element.querySelector(".settings-close") as HTMLButtonElement;
        this.controller = new DialogController(this.element, this.triggerButton, closeButton);
        closeButton.addEventListener("click", () => this.hide());
    }

    isOpen(): boolean {
        return this.controller.isOpen();
    }

    show(): void {
        this.controller.show();
    }

    hide(): void {
        this.controller.hide();
    }
}
