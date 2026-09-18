export interface CollapsiblePanel {
    /** Everything that was already inside `root` when it was made collapsible. */
    readonly body: HTMLElement;
    setOpen(open: boolean): void;
    isOpen(): boolean;
}

/**
 * Turns an existing panel element into an open/closable one: adds a
 * header (title + toggle button, icon on the right) above whatever
 * content the panel already built, and moves that content into a
 * `.panel-body` that the toggle shows/hides. The open/close transition
 * animates smoothly (see the `.panel-collapse` CSS grid-rows trick in
 * controls.css) rather than snapping with display:none.
 *
 * Call this once, as the last step of a panel's constructor — after
 * any internal element references (e.g. a cached list container) have
 * already been queried, since reparenting existing nodes into the body
 * doesn't invalidate references to them or their event listeners.
 */
export function makeCollapsible(root: HTMLElement, title: string, defaultOpen: boolean): CollapsiblePanel {
    const body = document.createElement("div");
    body.className = "panel-body";
    while (root.firstChild) body.appendChild(root.firstChild);

    const collapse = document.createElement("div");
    collapse.className = "panel-collapse";
    collapse.appendChild(body);

    const header = document.createElement("div");
    header.className = "panel-header";
    header.innerHTML = `
        <h3 class="panel-title">${title}</h3>
        <button type="button" class="panel-toggle" aria-label="Toggle ${title} panel"></button>
    `;

    root.classList.add("panel");
    root.append(header, collapse);

    const toggleButton = header.querySelector(".panel-toggle") as HTMLButtonElement;

    const setOpen = (open: boolean): void => {
        root.classList.toggle("is-collapsed", !open);
        toggleButton.setAttribute("aria-expanded", String(open));
        toggleButton.textContent = open ? "▾" : "▸";
    };

    toggleButton.addEventListener("click", () => setOpen(root.classList.contains("is-collapsed")));
    setOpen(defaultOpen);

    return { body, setOpen, isOpen: () => !root.classList.contains("is-collapsed") };
}
