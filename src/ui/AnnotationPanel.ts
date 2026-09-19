import type { TextAnnotation } from "../annotations/AnnotationTypes";
import type { CollapsiblePanel } from "./CollapsiblePanel";
import { makeCollapsible } from "./CollapsiblePanel";

export type AnnotationTextHandler = (id: string, text: string) => void;
export type AnnotationOffsetHandler = (id: string, offsetX: number, offsetY: number) => void;

const OFFSET_RANGE = 0.3;
const OFFSET_STEP = 0.005;

/**
 * Editing surface for the label attached to the currently selected
 * track: rename it, nudge its X/Y offset from the track's position.
 * Unlike Inspector this is an editing panel, not a read-only readout —
 * it's the primary way a user turns tracking data into the labeled
 * visualization the app is meant to produce.
 */
export class AnnotationPanel {
    readonly element: HTMLElement;
    private collapsible: CollapsiblePanel;
    private onText: AnnotationTextHandler | null = null;
    private onOffset: AnnotationOffsetHandler | null = null;
    private currentId: string | null = null;

    constructor() {
        this.element = document.createElement("div");
        this.element.className = "annotation-panel";
        this.collapsible = makeCollapsible(this.element, "Label", false);
        this.renderEmpty();
    }

    setOpen(open: boolean): void {
        this.collapsible.setOpen(open);
    }

    onTextChange(handler: AnnotationTextHandler): void {
        this.onText = handler;
    }

    onOffsetChange(handler: AnnotationOffsetHandler): void {
        this.onOffset = handler;
    }

    private renderEmpty(): void {
        this.currentId = null;
        this.collapsible.body.innerHTML = `<p class="annotation-empty">Select a track to label it</p>`;
    }

    hide(): void {
        this.renderEmpty();
    }

    show(trackId: number, annotation: TextAnnotation): void {
        this.currentId = annotation.id;

        this.collapsible.body.innerHTML = `
            <h3 class="annotation-title">TRACK ${String(trackId).padStart(2, "0")}</h3>
            <label class="annotation-field">
                Label
                <input type="text" class="annotation-text-input" placeholder="e.g. car" value="${escapeHtml(annotation.text)}" />
            </label>
            <label class="threshold-slider">
                X Offset
                <input type="range" class="annotation-offset-x" min="${-OFFSET_RANGE}" max="${OFFSET_RANGE}" step="${OFFSET_STEP}"
                    value="${annotation.offsetX}" />
            </label>
            <label class="threshold-slider">
                Y Offset
                <input type="range" class="annotation-offset-y" min="${-OFFSET_RANGE}" max="${OFFSET_RANGE}" step="${OFFSET_STEP}"
                    value="${annotation.offsetY}" />
            </label>
        `;

        const textInput = this.collapsible.body.querySelector(".annotation-text-input") as HTMLInputElement;
        const xSlider = this.collapsible.body.querySelector(".annotation-offset-x") as HTMLInputElement;
        const ySlider = this.collapsible.body.querySelector(".annotation-offset-y") as HTMLInputElement;

        textInput.addEventListener("input", () => {
            if (this.currentId) this.onText?.(this.currentId, textInput.value);
        });

        const emitOffset = () => {
            if (this.currentId) this.onOffset?.(this.currentId, Number(xSlider.value), Number(ySlider.value));
        };
        xSlider.addEventListener("input", emitOffset);
        ySlider.addEventListener("input", emitOffset);
    }
}

function escapeHtml(value: string): string {
    const div = document.createElement("div");
    div.textContent = value;
    return div.innerHTML;
}
