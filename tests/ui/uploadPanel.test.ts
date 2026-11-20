// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import type { MediaFileCheck } from "../../src/input/MediaFiles";
import { UploadPanel } from "../../src/ui/UploadPanel";

const accept = (): MediaFileCheck => ({ ok: true, kind: "video" });
const drop = (target: HTMLElement, file: File) => {
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: { files: [file] } });
    target.dispatchEvent(event);
};

describe("UploadPanel", () => {
    it("reports a file dropped on an attached target, with its kind", () => {
        const panel = new UploadPanel(accept);
        const onSelect = vi.fn();
        panel.onSelect(onSelect);
        const target = document.createElement("div");
        panel.attachDropTarget(target);
        const file = new File(["x"], "clip.mp4", { type: "video/mp4" });
        drop(target, file);
        expect(onSelect).toHaveBeenCalledWith(file, "video");
    });

    it("marks the target while a file is over it", () => {
        const panel = new UploadPanel(accept);
        const target = document.createElement("div");
        panel.attachDropTarget(target);
        target.dispatchEvent(new Event("dragover", { cancelable: true }));
        expect(target.classList.contains("is-dragover")).toBe(true);
        target.dispatchEvent(new Event("dragleave"));
        expect(target.classList.contains("is-dragover")).toBe(false);
    });

    it("reports the error of a rejected file instead of loading it, and clears it on the next file", () => {
        const check = vi
            .fn<(file: File) => MediaFileCheck>()
            .mockReturnValueOnce({ ok: false, error: "Unsupported file type: text/plain." })
            .mockReturnValueOnce({ ok: true, kind: "image" });
        const panel = new UploadPanel(check);
        const messages: (string | null)[] = [];
        const onSelect = vi.fn();
        panel.onError((message) => messages.push(message));
        panel.onSelect(onSelect);
        const target = document.createElement("div");
        panel.attachDropTarget(target);
        drop(target, new File(["x"], "a.txt", { type: "text/plain" }));
        expect(onSelect).not.toHaveBeenCalled();
        expect(messages).toEqual([null, "Unsupported file type: text/plain."]);
        drop(target, new File(["x"], "a.jpg", { type: "image/jpeg" }));
        expect(onSelect).toHaveBeenCalledTimes(1);
        expect(messages.at(-1)).toBeNull();
    });

    it("opens the file picker through its hidden input", () => {
        const panel = new UploadPanel(accept);
        const input = panel.element.querySelector(".upload-input") as HTMLInputElement;
        const click = vi.spyOn(input, "click");
        panel.openPicker();
        expect(click).toHaveBeenCalledTimes(1);
    });
});
