import { COCO_CLASSES } from "../inference/cocoClasses";
import { classColor } from "../rendering/classColors";
import type { ClassSelectionStore } from "../settings/ClassSelectionStore";
import { CLASS_GROUPS, groupClassIds, groupState } from "../settings/classGroups";

/**
 * Checkable class groups, each expandable to its classes. A group checkbox
 * shows "indeterminate" when only some of its classes are on; clicking it
 * turns a partial group fully on, a full group off. Renders
 * ClassSelectionStore and writes user input back; owns no state.
 */
export class ClassGroupPanel {
    readonly element: HTMLElement;
    private readonly syncers: (() => void)[] = [];
    private readonly note: HTMLElement;

    constructor(private readonly store: ClassSelectionStore) {
        this.element = document.createElement("section");
        this.element.className = "panel class-panel";
        this.element.innerHTML = `<h2 class="panel-title">Classes</h2>`;

        const list = document.createElement("div");
        list.className = "class-groups";
        for (const group of CLASS_GROUPS) list.appendChild(this.buildGroup(group.id));

        this.note = document.createElement("p");
        this.note.className = "panel-note";
        this.note.hidden = true;

        this.element.append(list, this.note);
        this.store.onChange(() => this.sync());
        this.sync();
    }

    /** A short note under the groups, e.g. that counts are not recomputed (video, Phase 3+). */
    setNote(text: string | null): void {
        this.note.textContent = text ?? "";
        this.note.hidden = !text;
    }

    private buildGroup(groupId: string): HTMLElement {
        const group = CLASS_GROUPS.find((g) => g.id === groupId);
        if (!group) throw new Error(groupId);
        const ids = groupClassIds(group);

        const row = document.createElement("div");
        row.className = "class-group";
        row.dataset.group = group.id;

        const header = document.createElement("div");
        header.className = "class-group-header";
        const label = document.createElement("label");
        label.className = "settings-check";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.addEventListener("change", () => this.store.toggleGroup(group));
        const name = document.createElement("span");
        name.textContent = group.label;
        const tally = document.createElement("span");
        tally.className = "class-group-tally";
        label.append(checkbox, name, tally);

        const expand = document.createElement("button");
        expand.type = "button";
        expand.className = "class-group-expand";
        expand.setAttribute("aria-label", `Show ${group.label} classes`);
        expand.setAttribute("aria-expanded", "false");
        expand.textContent = "▸";
        header.append(label, expand);

        const classes = document.createElement("div");
        classes.className = "class-list";
        classes.hidden = true;
        const classInputs = ids.map((id) => {
            const item = document.createElement("label");
            item.className = "settings-check class-item";
            item.dataset.classId = String(id);
            const input = document.createElement("input");
            input.type = "checkbox";
            input.addEventListener("change", () => this.store.setClass(id, input.checked));
            const swatch = document.createElement("span");
            swatch.className = "class-swatch";
            swatch.style.background = classColor(id);
            item.append(input, swatch, document.createTextNode(COCO_CLASSES[id]));
            classes.appendChild(item);
            return { id, input };
        });

        expand.addEventListener("click", () => {
            classes.hidden = !classes.hidden;
            expand.setAttribute("aria-expanded", String(!classes.hidden));
            expand.textContent = classes.hidden ? "▸" : "▾";
        });

        this.syncers.push(() => {
            const enabled = this.store.getEnabled();
            const state = groupState(group, enabled);
            checkbox.checked = state === "all";
            checkbox.indeterminate = state === "some";
            const on = ids.filter((id) => enabled.has(id)).length;
            tally.textContent = ids.length > 1 ? `${on}/${ids.length}` : "";
            for (const { id, input } of classInputs) input.checked = enabled.has(id);
        });

        row.append(header, classes);
        return row;
    }

    private sync(): void {
        for (const sync of this.syncers) sync();
    }
}
