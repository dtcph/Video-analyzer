import { CLASS_GROUPS, classIdOf } from "../settings/classGroups";
import { ACCENTS, mixHex, readableTextColor } from "./palette";
import type { AccentName } from "./palette";

/** One accent per class group, so what belongs together looks alike (the last group blends two accents). */
const GROUP_ACCENT: Record<string, string> = {
    people: ACCENTS.yellow,
    animals: ACCENTS.green,
    transportation: ACCENTS.turquoise,
    street: ACCENTS.blue,
    personal: ACCENTS.violet,
    sports: ACCENTS.pink,
    kitchen: ACCENTS.orange,
    furniture: ACCENTS.red,
    electronics: mixHex(ACCENTS.turquoise, ACCENTS.blue, 0.5)
};

/** Within a group the classes differ by how far they are lightened toward white. */
const LIGHTEN_STEPS = [0, 0.22, 0.4];

const FALLBACK: AccentName = "turquoise";

const COLORS = new Map<number, string>();
for (const group of CLASS_GROUPS) {
    const accent = GROUP_ACCENT[group.id] ?? ACCENTS[FALLBACK];
    group.classes.forEach((name, index) => {
        COLORS.set(classIdOf(name), mixHex(accent, "#FFFFFF", LIGHTEN_STEPS[index % LIGHTEN_STEPS.length]));
    });
}

/** One fixed color per COCO class: the same in every frame, panel and session (boxes, treemap, swatches). */
export function classColor(classId: number): string {
    return COLORS.get(classId) ?? ACCENTS[FALLBACK];
}

/** The text color that reads on `classColor(classId)`. */
export function classTextColor(classId: number): string {
    return readableTextColor(classColor(classId));
}
