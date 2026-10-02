import { COCO_CLASSES, NUM_COCO_CLASSES } from "../inference/cocoClasses";

export type CocoClassName = (typeof COCO_CLASSES)[number];

export interface ClassGroup {
    id: string;
    label: string;
    classes: readonly CocoClassName[];
}

/**
 * The checkable class groups from the product brief. Every COCO class is in
 * exactly one group (checked by tests/settings/classGroups.test.ts).
 */
export const CLASS_GROUPS: readonly ClassGroup[] = [
    { id: "people", label: "People", classes: ["person"] },
    {
        id: "animals",
        label: "Animals",
        classes: ["bird", "cat", "dog", "horse", "sheep", "cow", "elephant", "bear", "zebra", "giraffe"]
    },
    {
        id: "transportation",
        label: "Transportation",
        classes: ["bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck", "boat"]
    },
    {
        id: "street",
        label: "Street & outdoor",
        classes: ["traffic light", "fire hydrant", "stop sign", "parking meter", "bench"]
    },
    { id: "personal", label: "Personal items", classes: ["backpack", "umbrella", "handbag", "tie", "suitcase"] },
    {
        id: "sports",
        label: "Sports",
        classes: [
            "frisbee",
            "skis",
            "snowboard",
            "sports ball",
            "kite",
            "baseball bat",
            "baseball glove",
            "skateboard",
            "surfboard",
            "tennis racket"
        ]
    },
    {
        id: "kitchen",
        label: "Kitchen & food",
        classes: [
            "bottle",
            "wine glass",
            "cup",
            "fork",
            "knife",
            "spoon",
            "bowl",
            "banana",
            "apple",
            "sandwich",
            "orange",
            "broccoli",
            "carrot",
            "hot dog",
            "pizza",
            "donut",
            "cake"
        ]
    },
    {
        id: "furniture",
        label: "Furniture & household",
        classes: [
            "chair",
            "couch",
            "potted plant",
            "bed",
            "dining table",
            "toilet",
            "vase",
            "scissors",
            "teddy bear",
            "hair drier",
            "toothbrush",
            "clock",
            "book"
        ]
    },
    {
        id: "electronics",
        label: "Electronics & appliances",
        classes: [
            "tv",
            "laptop",
            "mouse",
            "remote",
            "keyboard",
            "cell phone",
            "microwave",
            "oven",
            "toaster",
            "sink",
            "refrigerator"
        ]
    }
];

export const DEFAULT_GROUP_IDS: readonly string[] = ["people", "animals", "transportation"];

const CLASS_ID_BY_NAME = new Map<string, number>(COCO_CLASSES.map((name, id) => [name, id]));

export function classIdOf(name: CocoClassName): number {
    const id = CLASS_ID_BY_NAME.get(name);
    if (id === undefined) throw new Error(`unknown COCO class: ${name}`);
    return id;
}

export function groupClassIds(group: ClassGroup): number[] {
    return group.classes.map(classIdOf);
}

export function groupById(id: string): ClassGroup | undefined {
    return CLASS_GROUPS.find((group) => group.id === id);
}

export type GroupState = "all" | "some" | "none";

export function groupState(group: ClassGroup, enabled: ReadonlySet<number>): GroupState {
    const ids = groupClassIds(group);
    const on = ids.filter((id) => enabled.has(id)).length;
    return on === 0 ? "none" : on === ids.length ? "all" : "some";
}

/** 1 = enabled, per class id: the form the detection filter consumes. */
export function enabledMask(enabled: ReadonlySet<number>): Uint8Array {
    const mask = new Uint8Array(NUM_COCO_CLASSES);
    for (const id of enabled) if (id >= 0 && id < NUM_COCO_CLASSES) mask[id] = 1;
    return mask;
}

export function defaultEnabledClasses(): Set<number> {
    const enabled = new Set<number>();
    for (const id of DEFAULT_GROUP_IDS) {
        const group = groupById(id);
        if (group) for (const classId of groupClassIds(group)) enabled.add(classId);
    }
    return enabled;
}
