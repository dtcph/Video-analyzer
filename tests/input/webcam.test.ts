import { describe, expect, it } from "vitest";
import { WEBCAM_CONFIG, cameraDevices, cameraErrorMessage, webcamConstraints } from "../../src/input/webcam";

describe("webcamConstraints", () => {
    it("asks for the config as ideal values, video only", () => {
        expect(webcamConstraints()).toEqual({
            audio: false,
            video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 24 } }
        });
        expect(WEBCAM_CONFIG).toEqual({ width: 1920, height: 1080, frameRate: 24 });
    });

    it("pins a picked device exactly and accepts another config", () => {
        const c = webcamConstraints("abc", { width: 1280, height: 720, frameRate: 30 });
        expect(c.video).toEqual({
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30 },
            deviceId: { exact: "abc" }
        });
    });
});

describe("cameraDevices", () => {
    it("keeps video inputs and names unlabeled ones", () => {
        const devices = [
            { kind: "audioinput", deviceId: "a", label: "Mic" },
            { kind: "videoinput", deviceId: "v1", label: "" },
            { kind: "videoinput", deviceId: "v2", label: "FaceTime HD Camera" }
        ] as const;
        expect(cameraDevices(devices)).toEqual([
            { deviceId: "v1", label: "Camera 1" },
            { deviceId: "v2", label: "FaceTime HD Camera" }
        ]);
    });
});

describe("cameraErrorMessage", () => {
    const named = (name: string, message = "x") => new DOMException(message, name);

    it("explains each getUserMedia failure", () => {
        expect(cameraErrorMessage(named("NotAllowedError"))).toMatch(/denied/);
        expect(cameraErrorMessage(named("SecurityError"))).toMatch(/denied/);
        expect(cameraErrorMessage(named("NotFoundError"))).toMatch(/No camera was found/);
        expect(cameraErrorMessage(named("NotReadableError"))).toMatch(/in use by another application/);
        expect(cameraErrorMessage(named("OverconstrainedError"))).toMatch(/not available any more/);
        const insecure = Object.assign(new Error("no mediaDevices"), { name: "NoMediaDevicesError" });
        expect(cameraErrorMessage(insecure)).toMatch(/secure \(HTTPS\)/);
    });

    it("falls back to the error text", () => {
        expect(cameraErrorMessage(new Error("boom"))).toBe("Could not start the camera: boom");
        expect(cameraErrorMessage("odd")).toBe("Could not start the camera: odd");
    });
});
