import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COCO_CLASSES } from "../../src/inference/cocoClasses";

describe("COCO_CLASSES", () => {
    it("matches the class names embedded in the exported YOLOv8 ONNX metadata", () => {
        // Fixture extracted from yolov8n-640.onnx metadata_props["names"] (Ultralytics 8.4.171).
        const fromModel = JSON.parse(
            readFileSync(new URL("../fixtures/yolov8-coco-names.json", import.meta.url), "utf8")
        );
        expect([...COCO_CLASSES]).toEqual(fromModel);
    });
});
