import type { ClassGroup } from "./classGroups";
import { defaultEnabledClasses, enabledMask, groupClassIds, groupState } from "./classGroups";

export type ClassSelectionListener = (enabled: ReadonlySet<number>) => void;

/**
 * Which COCO classes are detected, drawn and counted. Main-thread state, no
 * DOM; nothing persisted. Default: the People, Animals and Transportation groups.
 */
export class ClassSelectionStore {
    private enabled: Set<number> = defaultEnabledClasses();
    private mask: Uint8Array = enabledMask(this.enabled);
    private readonly listeners = new Set<ClassSelectionListener>();

    getEnabled(): ReadonlySet<number> {
        return this.enabled;
    }

    getMask(): Uint8Array {
        return this.mask;
    }

    isEnabled(classId: number): boolean {
        return this.enabled.has(classId);
    }

    setClass(classId: number, on: boolean): void {
        if (this.enabled.has(classId) === on) return;
        const next = new Set(this.enabled);
        if (on) next.add(classId);
        else next.delete(classId);
        this.replace(next);
    }

    /** A partially enabled group becomes fully enabled; a fully enabled one is cleared. */
    toggleGroup(group: ClassGroup): void {
        this.setGroup(group, groupState(group, this.enabled) !== "all");
    }

    setGroup(group: ClassGroup, on: boolean): void {
        const next = new Set(this.enabled);
        for (const id of groupClassIds(group)) {
            if (on) next.add(id);
            else next.delete(id);
        }
        this.replace(next);
    }

    resetToDefaults(): void {
        this.replace(defaultEnabledClasses());
    }

    isAtDefaults(): boolean {
        const defaults = defaultEnabledClasses();
        return defaults.size === this.enabled.size && [...defaults].every((id) => this.enabled.has(id));
    }

    onChange(listener: ClassSelectionListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private replace(next: Set<number>): void {
        if (next.size === this.enabled.size && [...next].every((id) => this.enabled.has(id))) return;
        this.enabled = next;
        this.mask = enabledMask(next);
        for (const listener of this.listeners) listener(this.enabled);
    }
}
