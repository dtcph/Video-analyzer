import type { CameraDevice } from "../input/webcam";

export type WebcamState = "off" | "starting" | "live" | "paused";

/**
 * Camera controls under the upload area: Start camera, a device picker,
 * Pause / Resume and Stop, a status line and an error line. Reports user
 * actions only; App opens and releases the camera.
 */
export class WebcamPanel {
    readonly element: HTMLElement;
    private readonly startButton: HTMLButtonElement;
    private readonly pauseButton: HTMLButtonElement;
    private readonly stopButton: HTMLButtonElement;
    private readonly deviceSelect: HTMLSelectElement;
    private readonly statusEl: HTMLElement;
    private readonly errorEl: HTMLElement;
    private onStartHandler: ((deviceId: string | null) => void) | null = null;
    private onStopHandler: (() => void) | null = null;
    private onPauseHandler: (() => void) | null = null;
    private onDeviceHandler: ((deviceId: string) => void) | null = null;

    constructor() {
        this.element = document.createElement("div");
        this.element.className = "webcam-panel";
        this.element.innerHTML = `
            <div class="webcam-controls">
                <button type="button" class="webcam-start">Start camera</button>
                <select class="webcam-device" aria-label="Camera" hidden></select>
                <button type="button" class="webcam-pause" hidden title="Pause / Resume (Space)">Pause</button>
                <button type="button" class="webcam-stop" hidden>Stop camera</button>
            </div>
            <p class="webcam-status panel-note" hidden></p>
            <p class="webcam-error upload-error" role="alert" hidden></p>
        `;
        this.startButton = this.element.querySelector(".webcam-start") as HTMLButtonElement;
        this.pauseButton = this.element.querySelector(".webcam-pause") as HTMLButtonElement;
        this.stopButton = this.element.querySelector(".webcam-stop") as HTMLButtonElement;
        this.deviceSelect = this.element.querySelector(".webcam-device") as HTMLSelectElement;
        this.statusEl = this.element.querySelector(".webcam-status") as HTMLElement;
        this.errorEl = this.element.querySelector(".webcam-error") as HTMLElement;

        this.startButton.addEventListener("click", () => {
            this.clearError();
            this.onStartHandler?.(this.deviceSelect.value || null);
        });
        this.stopButton.addEventListener("click", () => this.onStopHandler?.());
        this.pauseButton.addEventListener("click", () => this.onPauseHandler?.());
        this.deviceSelect.addEventListener("change", () => {
            this.clearError();
            this.onDeviceHandler?.(this.deviceSelect.value);
        });
        this.setState("off");
    }

    onStart(handler: (deviceId: string | null) => void): void {
        this.onStartHandler = handler;
    }

    onStop(handler: () => void): void {
        this.onStopHandler = handler;
    }

    onPauseToggle(handler: () => void): void {
        this.onPauseHandler = handler;
    }

    onDeviceChange(handler: (deviceId: string) => void): void {
        this.onDeviceHandler = handler;
    }

    setState(state: WebcamState): void {
        const running = state === "live" || state === "paused";
        this.element.dataset.state = state;
        this.startButton.hidden = running;
        this.startButton.disabled = state === "starting";
        this.startButton.textContent = state === "starting" ? "Starting camera…" : "Start camera";
        this.pauseButton.hidden = !running;
        this.pauseButton.textContent = state === "paused" ? "Resume" : "Pause";
        this.stopButton.hidden = !running;
        this.deviceSelect.hidden = !running || this.deviceSelect.options.length < 2;
    }

    /** Fills the picker; shown only while running and when there is a choice. */
    setDevices(devices: readonly CameraDevice[], selectedId: string | null): void {
        this.deviceSelect.replaceChildren(
            ...devices.map((d) => {
                const option = document.createElement("option");
                option.value = d.deviceId;
                option.textContent = d.label;
                return option;
            })
        );
        if (selectedId && devices.some((d) => d.deviceId === selectedId)) this.deviceSelect.value = selectedId;
        const running = this.element.dataset.state === "live" || this.element.dataset.state === "paused";
        this.deviceSelect.hidden = !running || devices.length < 2;
    }

    setStatus(text: string | null): void {
        this.statusEl.textContent = text ?? "";
        this.statusEl.hidden = !text;
    }

    showError(message: string): void {
        this.errorEl.textContent = message;
        this.errorEl.hidden = false;
    }

    clearError(): void {
        this.errorEl.textContent = "";
        this.errorEl.hidden = true;
    }
}
