import { describe, expect, it } from "vitest";
import { DetectionHold } from "../../src/inference/DetectionHold";

const result = (mediaTime: number) => ({ mediaTime, detections: [] });

describe("DetectionHold", () => {
    it("holds the latest result for up to maxHoldSeconds of media time", () => {
        const hold = new DetectionHold(0.5);
        hold.set(result(2));
        expect(hold.at(2)).not.toBeNull();
        expect(hold.at(2.4)).not.toBeNull();
        expect(hold.at(2.6)).toBeNull();
    });

    it("never shows a result from the future (display behind the result after seeking back)", () => {
        const hold = new DetectionHold();
        hold.set(result(5));
        expect(hold.at(1)).toBeNull();
    });

    it("replaces with the latest arriving result even if its media time is slightly earlier (pause), and clears", () => {
        const hold = new DetectionHold();
        hold.set(result(3.04));
        hold.set(result(3.02));
        expect(hold.isExact(3.02)).toBe(true);
        expect(hold.at(3.02)?.mediaTime).toBe(3.02);
        hold.clear();
        expect(hold.at(3.02)).toBeNull();
        expect(hold.isExact(3.02)).toBe(false);
    });
});
