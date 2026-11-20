const FOCUSABLE = 'button, [href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])';

/** Only what can really be focused: not hidden, not disabled, not inside a collapsed <details> (its content has no visibility). */
function canFocus(el: HTMLElement): boolean {
    if (el.hidden || (el as HTMLButtonElement).disabled) return false;
    return typeof el.checkVisibility === "function" ? el.checkVisibility() : el.getClientRects().length > 0;
}

export interface DialogHooks {
    onShow?(): void;
    onHide?(): void;
}

/**
 * The shared behavior of the page's modal dialogs. `overlay` is the backdrop
 * that holds the window: it is inert while closed, gets `is-open` and
 * `data-state` while open, and a click on the backdrop itself (outside the
 * window) closes it, like Escape. While open, focus moves into the window,
 * Tab stays inside it, and closing returns the focus to where it came from.
 */
export class DialogController {
    private open = false;
    private opener: HTMLElement | null = null;

    constructor(
        private readonly overlay: HTMLElement,
        private readonly trigger: HTMLElement,
        private readonly initialFocus: HTMLElement,
        private readonly hooks: DialogHooks = {}
    ) {
        overlay.dataset.state = "closed";
        overlay.setAttribute("inert", "");
        trigger.setAttribute("aria-haspopup", "dialog");
        trigger.setAttribute("aria-expanded", "false");
        trigger.addEventListener("click", () => this.show());
        overlay.addEventListener("click", (event) => {
            if (event.target === overlay) this.hide();
        });
    }

    isOpen(): boolean {
        return this.open;
    }

    show(): void {
        if (this.open) return;
        this.open = true;
        this.opener = document.activeElement instanceof HTMLElement ? document.activeElement : this.trigger;
        this.overlay.removeAttribute("inert");
        this.overlay.dataset.state = "open";
        this.overlay.classList.add("is-open");
        this.trigger.setAttribute("aria-expanded", "true");
        this.hooks.onShow?.();
        this.initialFocus.focus();
        document.addEventListener("keydown", this.onKeyDown);
    }

    hide(): void {
        if (!this.open) return;
        this.open = false;
        document.removeEventListener("keydown", this.onKeyDown);
        this.overlay.classList.remove("is-open");
        this.overlay.dataset.state = "closed";
        this.overlay.setAttribute("inert", "");
        this.trigger.setAttribute("aria-expanded", "false");
        this.hooks.onHide?.();
        (this.opener ?? this.trigger).focus();
        this.opener = null;
    }

    private readonly onKeyDown = (event: KeyboardEvent): void => {
        if (event.key === "Escape") {
            event.preventDefault();
            this.hide();
            return;
        }
        if (event.key !== "Tab") return;
        // Focus trap: Tab and Shift+Tab cycle inside the window.
        const focusable = [...this.overlay.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(canFocus);
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const current = document.activeElement;
        if (event.shiftKey && (current === first || !this.overlay.contains(current))) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && (current === last || !this.overlay.contains(current))) {
            event.preventDefault();
            first.focus();
        }
    };
}
