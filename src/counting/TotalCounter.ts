import type { ClassCount } from "./countDetections";
import { toClassCounts } from "./countDetections";

/**
 * Session totals: unique confirmed tracks per class. Each track is added
 * once, when it is confirmed; if its majority class changes later the count
 * moves to the new class (`move`), so the sum never changes. Only Reset clears it.
 */
export class TotalCounter {
    private readonly counts = new Map<number, number>();

    add(classId: number): void {
        this.counts.set(classId, (this.counts.get(classId) ?? 0) + 1);
    }

    /** A counted object turned out to belong to another class: move its count. */
    move(from: number, to: number): void {
        const count = this.counts.get(from) ?? 0;
        if (from === to || count === 0) return;
        if (count === 1) this.counts.delete(from);
        else this.counts.set(from, count - 1);
        this.add(to);
    }

    reset(): void {
        this.counts.clear();
    }

    /** Number of objects counted, all classes. */
    total(): number {
        let sum = 0;
        for (const count of this.counts.values()) sum += count;
        return sum;
    }

    /**
     * Per-class totals. With `enabled` (1 = enabled, per class id), classes
     * that have a total but are now disabled are marked inactive: their
     * count stays visible but no longer increases.
     */
    totals(enabled?: Uint8Array): ClassCount[] {
        const counts = toClassCounts(this.counts);
        if (!enabled) return counts;
        return counts.map((c) => (enabled[c.classId] === 1 ? c : { ...c, inactive: true }));
    }
}
