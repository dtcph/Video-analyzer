// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { SettingsDialog } from "../../src/ui/SettingsDialog";

function setup() {
    const content = document.createElement("p");
    content.className = "settings-content";
    content.textContent = "Confidence threshold";
    const dialog = new SettingsDialog([content]);
    document.body.replaceChildren(dialog.triggerButton, dialog.element);
    return {
        dialog,
        content,
        overlay: dialog.element,
        close: dialog.element.querySelector(".settings-close") as HTMLElement
    };
}

describe("SettingsDialog", () => {
    afterEach(() => document.body.replaceChildren());

    it("has a labeled gear button and a closed, inert pop-up with the given content", () => {
        const { dialog, overlay, content } = setup();
        expect(dialog.triggerButton.getAttribute("aria-label")).toBe("Settings");
        expect(overlay.dataset.state).toBe("closed");
        expect(overlay.hasAttribute("inert")).toBe(true);
        expect(overlay.querySelector(".settings-dialog-body")?.contains(content)).toBe(true);
        expect(overlay.querySelector(".settings-dialog")?.getAttribute("role")).toBe("dialog");
    });

    it("opens from the gear and closes with the X, a click outside and Escape", () => {
        const { dialog, overlay, close } = setup();
        for (const closeIt of [
            () => close.click(),
            () => overlay.click(),
            () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
        ]) {
            dialog.triggerButton.focus();
            dialog.triggerButton.click();
            expect(dialog.isOpen()).toBe(true);
            expect(overlay.dataset.state).toBe("open");
            expect(document.activeElement).toBe(close);
            closeIt();
            expect(dialog.isOpen()).toBe(false);
            expect(overlay.hasAttribute("inert")).toBe(true);
            expect(document.activeElement).toBe(dialog.triggerButton);
        }
    });
});
