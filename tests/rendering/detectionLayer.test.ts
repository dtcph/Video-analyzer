import { describe, expect, it } from "vitest";
import { DetectionLayer } from "../../src/rendering/DetectionLayer";
import { classColor } from "../../src/rendering/classColors";

/** Records the canvas calls the layer makes. */
function recordingContext(width = 1000, height = 600) {
    const calls: { op: string; args: number[]; style?: string; text?: string }[] = [];
    const ctx = {
        canvas: { width, height },
        lineWidth: 1,
        font: "",
        textBaseline: "",
        strokeStyle: "",
        fillStyle: "",
        setLineDash: () => {},
        measureText: (text: string) => ({ width: text.length * 7 }),
        strokeRect(...args: number[]) {
            calls.push({ op: "strokeRect", args, style: this.strokeStyle });
        },
        fillRect(...args: number[]) {
            calls.push({ op: "fillRect", args, style: this.fillStyle });
        },
        fillText(text: string, ...args: number[]) {
            calls.push({ op: "fillText", args, text });
        }
    };
    return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

describe("DetectionLayer", () => {
    it("maps normalized boxes into the letterboxed media rect and labels them", () => {
        const layer = new DetectionLayer();
        layer.set([{ classId: 16, score: 0.874, box: { x: 0.5, y: 0.5, width: 0.25, height: 0.5 } }]);
        const { ctx, calls } = recordingContext();
        layer.render(ctx, { mediaRect: { x: 100, y: 0, width: 800, height: 600 }, timeSeconds: 0, pixelRatio: 1 });

        expect(calls[0]).toEqual({ op: "strokeRect", args: [500, 300, 200, 300], style: classColor(16) });
        expect(calls.find((c) => c.op === "fillText")?.text).toBe("dog 87%");
    });

    it("puts the label inside the box when there is no room above it", () => {
        const layer = new DetectionLayer();
        layer.set([{ classId: 0, score: 0.5, box: { x: 0, y: 0, width: 0.5, height: 0.5 } }]);
        const { ctx, calls } = recordingContext();
        layer.render(ctx, { mediaRect: { x: 0, y: 0, width: 1000, height: 600 }, timeSeconds: 0, pixelRatio: 1 });
        const label = calls.find((c) => c.op === "fillRect");
        expect(label?.args[1]).toBe(0);
        expect(label?.args[0]).toBeGreaterThanOrEqual(0);
    });

    it("draws raw detections only when given", () => {
        const layer = new DetectionLayer();
        const raw = [{ classId: 2, score: 0.1, box: { x: 0, y: 0.5, width: 0.1, height: 0.1 } }];
        layer.set([], raw);
        const { ctx, calls } = recordingContext();
        layer.render(ctx, { mediaRect: { x: 0, y: 0, width: 1000, height: 600 }, timeSeconds: 0, pixelRatio: 2 });
        expect(calls.filter((c) => c.op === "strokeRect")).toHaveLength(1);
        layer.clear();
        const second = recordingContext();
        layer.render(second.ctx, {
            mediaRect: { x: 0, y: 0, width: 1000, height: 600 },
            timeSeconds: 0,
            pixelRatio: 2
        });
        expect(second.calls).toHaveLength(0);
    });

    it("gives every class a stable, distinct color", () => {
        const colors = new Set(Array.from({ length: 80 }, (_, id) => classColor(id)));
        expect(colors.size).toBe(80);
        expect(classColor(5)).toBe(classColor(5));
    });
});
