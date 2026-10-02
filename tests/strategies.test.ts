import { afterEach, describe, expect, it, vi } from "vitest";
import { AnalysisEngine } from "../src/analysis/AnalysisEngine.ts";
import { DEFAULT_ANALYSIS_SETTINGS } from "../src/analysis/AnalysisTypes.ts";
import { BlobDetector } from "../src/analysis/BlobDetector.ts";
import { NO_GLOBAL_MOTION } from "../src/analysis/GlobalMotionEstimator.ts";
import { MovingCameraStrategy, SteadyStrategy, createStrategy } from "../src/analysis/strategies/strategies.ts";
import { ANALYSIS_MODES } from "../src/settings/AnalysisModes.ts";
import { presetFor } from "../src/settings/SettingsSchema.ts";

afterEach(() => vi.restoreAllMocks());

describe("createStrategy", () => {
    it("creates one strategy per mode with a matching id", () => {
        for (const mode of ANALYSIS_MODES) expect(createStrategy(mode).id).toBe(mode);
        expect(createStrategy("steady")).toBeInstanceOf(SteadyStrategy);
        expect(createStrategy("moving-car")).toBeInstanceOf(MovingCameraStrategy);
    });
});

describe("strategy settings", () => {
    it("enforces each mode's fixed settings regardless of incoming values", () => {
        const steady = createStrategy("steady").resolveSettings({ ...DEFAULT_ANALYSIS_SETTINGS, cameraCompensationEnabled: true });
        expect(steady.cameraCompensationEnabled).toBe(false);
        const car = createStrategy("moving-car").resolveSettings({ ...DEFAULT_ANALYSIS_SETTINGS, cameraCompensationEnabled: false });
        expect(car.cameraCompensationEnabled).toBe(true);
        expect(car.mode).toBe("moving-car");
    });

    it("steady assumes a static camera", () => {
        expect(new SteadyStrategy().estimateCameraMotion()).toBe(NO_GLOBAL_MOTION);
    });
});

describe("AnalysisEngine strategy switching", () => {
    it("starts on the steady preset", () => {
        const engine = new AnalysisEngine();
        expect(engine.getStrategyId()).toBe("steady");
        expect(engine.getSettings().cameraCompensationEnabled).toBe(false);
    });

    it("swaps the strategy and resets detector state when the mode changes — and only then", () => {
        const reset = vi.spyOn(BlobDetector.prototype, "reset");
        const engine = new AnalysisEngine();
        engine.updateSettings({ threshold: 0.2 });
        expect(reset).not.toHaveBeenCalled();
        engine.updateSettings({ mode: "moving-drone" });
        expect(engine.getStrategyId()).toBe("moving-drone");
        expect(reset).toHaveBeenCalledTimes(1);
        engine.updateSettings({ mode: "moving-drone", blurRadius: 2 });
        expect(reset).toHaveBeenCalledTimes(1);
    });

    it("resetSettings restores the current mode's preset but keeps the per-video resolution", () => {
        const engine = new AnalysisEngine();
        engine.updateSettings({ mode: "moving-car", analysisWidth: 640, analysisHeight: 360, threshold: 0.4 });
        engine.resetSettings();
        expect(engine.getSettings()).toEqual({ ...DEFAULT_ANALYSIS_SETTINGS, ...presetFor("moving-car"), analysisWidth: 640, analysisHeight: 360 });
    });
});
