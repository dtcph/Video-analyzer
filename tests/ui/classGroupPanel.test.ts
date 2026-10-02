// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { ClassSelectionStore } from "../../src/settings/ClassSelectionStore";
import { classIdOf } from "../../src/settings/classGroups";
import { ClassGroupPanel } from "../../src/ui/ClassGroupPanel";
import { CountsPanel } from "../../src/ui/CountsPanel";

function setup() {
    const store = new ClassSelectionStore();
    const panel = new ClassGroupPanel(store);
    // A disconnected checkbox fires no "change" on click (HTML spec), so the panel must be in the document.
    document.body.replaceChildren(panel.element);
    const groupBox = (id: string) =>
        panel.element.querySelector(`.class-group[data-group="${id}"] .class-group-header input`) as HTMLInputElement;
    const classBox = (id: number) =>
        panel.element.querySelector(`.class-item[data-class-id="${id}"] input`) as HTMLInputElement;
    return { store, panel, groupBox, classBox };
}

describe("ClassGroupPanel", () => {
    it("shows the default groups checked and the others unchecked", () => {
        const { groupBox } = setup();
        expect(groupBox("people").checked).toBe(true);
        expect(groupBox("animals").checked).toBe(true);
        expect(groupBox("transportation").checked).toBe(true);
        expect(groupBox("sports").checked).toBe(false);
    });

    it("toggles a whole group and reflects partial groups as indeterminate", () => {
        const { store, groupBox, classBox } = setup();
        groupBox("sports").click();
        expect(store.isEnabled(classIdOf("frisbee"))).toBe(true);

        classBox(classIdOf("car")).click();
        expect(store.isEnabled(classIdOf("car"))).toBe(false);
        expect(groupBox("transportation").indeterminate).toBe(true);
        expect(groupBox("transportation").checked).toBe(false);

        groupBox("transportation").click(); // partial → all
        expect(store.isEnabled(classIdOf("car"))).toBe(true);
        expect(groupBox("transportation").indeterminate).toBe(false);
    });

    it("expands a group to its classes", () => {
        const { panel } = setup();
        const group = panel.element.querySelector('.class-group[data-group="animals"]') as HTMLElement;
        const list = group.querySelector(".class-list") as HTMLElement;
        expect(list.hidden).toBe(true);
        (group.querySelector(".class-group-expand") as HTMLButtonElement).click();
        expect(list.hidden).toBe(false);
        expect(list.querySelectorAll(".class-item")).toHaveLength(10);
    });
});

describe("CountsPanel", () => {
    it("renders a summary and one row per class, and hides the current-frame section unless given", () => {
        const panel = new CountsPanel();
        panel.render({
            totalTitle: "Total (this image)",
            total: [
                { classId: 2, label: "car", count: 4 },
                { classId: 0, label: "person", count: 1 }
            ]
        });
        expect(panel.element.querySelector(".counts-summary")?.textContent).toBe("4 cars, 1 person");
        expect(panel.element.querySelectorAll(".counts-total .counts-row")).toHaveLength(2);
        expect((panel.element.querySelector(".counts-current") as HTMLElement).hidden).toBe(true);
        expect((panel.element.querySelector(".counts-reset") as HTMLElement).hidden).toBe(true);
    });

    it("shows messages for empty and pending states", () => {
        const panel = new CountsPanel();
        panel.render({ totalTitle: "Total (this image)", total: [] });
        expect(panel.element.querySelector(".panel-empty")?.textContent).toBe(
            "No objects of the selected classes found."
        );
        panel.render({ totalTitle: "Total (this image)", total: null, message: "Detecting…", busy: true });
        expect(panel.element.classList.contains("is-busy")).toBe(true);
        expect(panel.element.querySelector(".panel-empty")?.textContent).toBe("Detecting…");
    });
});
