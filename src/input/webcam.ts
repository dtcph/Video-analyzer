/**
 * Webcam configuration and the pure helpers around getUserMedia. The DOM
 * side (stream, <video>) lives in WebcamSource.
 */

/** What the app asks the camera for: the one place to change it. Cameras that cannot deliver it give their closest mode. */
export const WEBCAM_CONFIG = {
    width: 1920,
    height: 1080,
    frameRate: 24
} as const;

export type WebcamConfig = { readonly width: number; readonly height: number; readonly frameRate: number };

/** getUserMedia constraints: the config as `ideal` values (never fail on them), plus an exact device when one was picked. */
export function webcamConstraints(deviceId: string | null = null, config: WebcamConfig = WEBCAM_CONFIG) {
    return {
        audio: false,
        video: {
            width: { ideal: config.width },
            height: { ideal: config.height },
            frameRate: { ideal: config.frameRate },
            ...(deviceId ? { deviceId: { exact: deviceId } } : {})
        }
    } satisfies MediaStreamConstraints;
}

export interface CameraDevice {
    deviceId: string;
    label: string;
}

/** Video inputs from enumerateDevices. Labels are empty until camera permission is granted, so fall back to "Camera N". */
export function cameraDevices(
    devices: readonly Pick<MediaDeviceInfo, "kind" | "deviceId" | "label">[]
): CameraDevice[] {
    return devices
        .filter((d) => d.kind === "videoinput")
        .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` }));
}

export const CAMERA_DISCONNECTED_MESSAGE =
    "The camera was disconnected or stopped by the system. Reconnect it and press Start camera.";

/** A user-facing message for a getUserMedia failure (DOMException names per the Media Capture spec). */
export function cameraErrorMessage(error: unknown): string {
    const name = error instanceof Error || error instanceof DOMException ? error.name : "";
    switch (name) {
        case "NotAllowedError":
        case "SecurityError":
            return "Camera access was denied. Allow the camera for this site (camera icon in Chrome's address bar), then press Start camera again.";
        case "NotFoundError":
            return "No camera was found. Connect a camera and press Start camera again.";
        case "NotReadableError":
        case "AbortError":
            return "The camera could not be started. It may be in use by another application; close it and try again.";
        case "OverconstrainedError":
            return "The selected camera is not available any more. Pick another camera.";
        case "NoMediaDevicesError":
            return "This page cannot use cameras: camera access needs a secure (HTTPS) page in Chrome.";
        default: {
            const message = error instanceof Error ? error.message : String(error);
            return `Could not start the camera: ${message}`;
        }
    }
}
