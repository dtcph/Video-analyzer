import { describe, expect, it } from "vitest";
import { RateMeter } from "../../src/utils/RateMeter";

describe("RateMeter", () => {
    it("reports events per second over the window", () => {
        let now = 0;
        const meter = new RateMeter(2000, () => now);
        expect(meter.rate()).toBe(0);
        for (let i = 0; i < 21; i++) {
            meter.record();
            now += 50;
        }
        expect(meter.rate()).toBeCloseTo(20);
    });

    it("forgets events outside the window", () => {
        let now = 0;
        const meter = new RateMeter(1000, () => now);
        meter.record();
        now = 100;
        meter.record();
        now = 5000;
        expect(meter.rate()).toBe(0);
    });
});
