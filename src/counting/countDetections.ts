import { COCO_CLASSES } from "../inference/cocoClasses";

export interface ClassCount {
    classId: number;
    label: string;
    count: number;
}

/** Per-class counts of the given detections, most frequent first, then alphabetical. */
export function countByClass(detections: readonly { classId: number }[]): ClassCount[] {
    const counts = new Map<number, number>();
    for (const d of detections) counts.set(d.classId, (counts.get(d.classId) ?? 0) + 1);
    return [...counts]
        .map(([classId, count]) => ({ classId, label: COCO_CLASSES[classId] ?? `class ${classId}`, count }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** "3 people, 2 dogs, 1 car": English plural for the summary line. */
export function pluralLabel(label: string, count: number): string {
    if (count === 1) return label;
    const irregular: Record<string, string> = {
        person: "people",
        sheep: "sheep",
        skis: "skis",
        "hair drier": "hair driers",
        knife: "knives",
        mouse: "mice",
        bus: "buses",
        "wine glass": "wine glasses",
        bench: "benches",
        "sports ball": "sports balls",
        "hot dog": "hot dogs",
        sandwich: "sandwiches",
        couch: "couches",
        toothbrush: "toothbrushes",
        "cell phone": "cell phones",
        "tennis racket": "tennis rackets",
        "teddy bear": "teddy bears"
    };
    if (irregular[label]) return irregular[label];
    if (/(s|sh|ch|x|z)$/.test(label)) return `${label}es`;
    return `${label}s`;
}

export function summarize(counts: readonly ClassCount[]): string {
    return counts.map((c) => `${c.count} ${pluralLabel(c.label, c.count)}`).join(", ");
}
