import { describe, expect, it } from "vitest";
import { SampleRateLimiter } from "../../src/input/FrameSampler";

/** Media times of n frames at `fps`. */
const frames = (fps: number, n: number) => Array.from({ length: n }, (_, i) => i / fps);

describe("SampleRateLimiter", () => {
    it("samples every frame when the cap is at the video rate (29.97 fps video, 30 fps cap)", () => {
        const limiter = new SampleRateLimiter(30);
        expect(frames(30000 / 1001, 30).filter((t) => limiter.shouldSample(t))).toHaveLength(30);
    });

    it("halves 30 fps video at a 15 fps cap and thins 24 fps video to ~10 fps at a 10 fps cap", () => {
        const fifteen = new SampleRateLimiter(15);
        expect(frames(30, 60).filter((t) => fifteen.shouldSample(t))).toHaveLength(30);
        const ten = new SampleRateLimiter(10);
        const sampled = frames(24, 48).filter((t) => ten.shouldSample(t));
        expect(sampled.length).toBeGreaterThanOrEqual(16);
        expect(sampled.length).toBeLessThanOrEqual(20);
    });

    it("restarts after a backward jump instead of stalling", () => {
        const limiter = new SampleRateLimiter(5);
        expect(limiter.shouldSample(10)).toBe(true);
        expect(limiter.shouldSample(1)).toBe(true);
        expect(limiter.shouldSample(1.1)).toBe(false);
        expect(limiter.shouldSample(1.2)).toBe(true);
    });
});
