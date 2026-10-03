import { describe, expect, it } from "vitest";
import { BoxKalmanFilter } from "../../src/tracking/BoxKalmanFilter";

const box = (x: number, y = 0.4, width = 0.1, height = 0.2) => ({ x, y, width, height });

describe("BoxKalmanFilter", () => {
    it("starts at the measured box with zero velocity", () => {
        const kf = new BoxKalmanFilter(box(0.3));
        const b = kf.box();
        expect(b.x).toBeCloseTo(0.3, 9);
        expect(b.y).toBeCloseTo(0.4, 9);
        expect(b.width).toBeCloseTo(0.1, 9);
        expect(b.height).toBeCloseTo(0.2, 9);
        expect(kf.box(1)).toEqual(b);
    });

    it("learns a constant velocity and extrapolates it", () => {
        const kf = new BoxKalmanFilter(box(0.1));
        // 0.3 per second to the right, sampled at 30 fps.
        for (let i = 1; i <= 30; i++) {
            kf.predict(1 / 30);
            kf.update(box(0.1 + 0.01 * i));
        }
        expect(kf.centerVelocity().x).toBeCloseTo(0.3, 2);
        expect(kf.centerVelocity().y).toBeCloseTo(0, 3);
        expect(kf.box(0.1).x).toBeCloseTo(0.4 + 0.03, 2);
    });

    it("handles a variable time step (the same motion sampled irregularly)", () => {
        const kf = new BoxKalmanFilter(box(0.1));
        let t = 0;
        const steps = [1 / 30, 1 / 15, 1 / 30, 0.1, 1 / 24, 1 / 30, 1 / 10, 1 / 30];
        for (let i = 0; i < 40; i++) {
            const dt = steps[i % steps.length];
            t += dt;
            kf.predict(dt);
            kf.update(box(0.1 + 0.3 * t));
        }
        expect(kf.centerVelocity().x).toBeCloseTo(0.3, 2);
        kf.predict(0.2);
        expect(kf.box().x).toBeCloseTo(0.1 + 0.3 * (t + 0.2), 2);
    });

    it("does not move on a zero or negative time step", () => {
        const kf = new BoxKalmanFilter(box(0.1));
        kf.predict(1 / 30);
        kf.update(box(0.12));
        const before = kf.box();
        kf.predict(0);
        kf.predict(-1);
        expect(kf.box()).toEqual(before);
    });

    it("smooths a noisy measurement instead of jumping to it", () => {
        const kf = new BoxKalmanFilter(box(0.5));
        for (let i = 0; i < 20; i++) {
            kf.predict(1 / 30);
            kf.update(box(0.5));
        }
        kf.predict(1 / 30);
        kf.update(box(0.56));
        const x = kf.box().x;
        expect(x).toBeGreaterThan(0.5);
        expect(x).toBeLessThan(0.56);
    });

    it("keeps the height positive when extrapolating a shrinking box", () => {
        const kf = new BoxKalmanFilter(box(0.5, 0.4, 0.1, 0.2));
        for (let i = 1; i <= 10; i++) {
            kf.predict(1 / 30);
            kf.update(box(0.5, 0.4, 0.1, 0.2 - 0.015 * i));
        }
        expect(kf.box(10).height).toBeGreaterThan(0);
        kf.stopHeightVelocity();
        expect(kf.box(10).height).toBeCloseTo(kf.box().height, 9);
    });
});
