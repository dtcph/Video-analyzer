import { trackingKey } from "../analysis/analysisKeys";
import { countByClass } from "../counting/countDetections";
import { TotalCounter } from "../counting/TotalCounter";
import type { LoadProgress, ModelInfo, StageTimings } from "../inference/InferenceMessages";
import { InferenceClient } from "../inference/InferenceClient";
import type { DetectResult } from "../inference/InferenceClient";
import type { Detection } from "../inference/postprocess";
import { filterDetections } from "../inference/postprocess";
import { ImageSource } from "../input/ImageSource";
import { VideoSource } from "../input/VideoSource";
import type { InputKind, InputSource } from "../input/InputSource";
import { checkMediaFile } from "../input/MediaFiles";
import type { MediaKind } from "../input/MediaFiles";
import type { CapturedFrame } from "../input/MediaTypes";
import { VideoPlayer } from "../input/VideoPlayer";
import { CAMERA_DISCONNECTED_MESSAGE, cameraErrorMessage } from "../input/webcam";
import { WebcamSource } from "../input/WebcamSource";
import { DetectionLayer } from "../rendering/DetectionLayer";
import type { DrawnBox } from "../rendering/DetectionLayer";
import { OverlayRenderer } from "../rendering/OverlayRenderer";
import { ClassSelectionStore } from "../settings/ClassSelectionStore";
import type { Settings } from "../settings/SettingsSchema";
import { MIN_CONFIDENCE } from "../settings/SettingsSchema";
import { SettingsStore } from "../settings/SettingsStore";
import { ClassGroupPanel } from "../ui/ClassGroupPanel";
import { CountsPanel } from "../ui/CountsPanel";
import { DebugReadout } from "../ui/DebugReadout";
import { ModelStatusPanel } from "../ui/ModelStatusPanel";
import { PlaybackControls } from "../ui/PlaybackControls";
import { SettingsPanel } from "../ui/SettingsPanel";
import { UploadPanel } from "../ui/UploadPanel";
import { WebcamPanel } from "../ui/WebcamPanel";
import type { AnalysisMode, AnalysisPanelView } from "../ui/AnalysisPanel";
import { AnalysisPanel } from "../ui/AnalysisPanel";
import { formatClock } from "../utils/format";
import type { CurrentAnalysisSettings } from "./PreAnalysisSession";
import { PreAnalysisSession } from "./PreAnalysisSession";
import { trackIdsFor } from "../tracking/association";
import { DEFAULT_TUNING, Tracker } from "../tracking/Tracker";
import type { Size } from "../utils/geometry";
import { RealtimeVideo } from "./RealtimeVideo";

/** AGPL §13: every user of the site must be offered the source, ideally of the deployed commit (set by vite.config.ts). */
const SOURCE_URL = "https://github.com/dtcph/Video-analyzer";
const SOURCE_COMMIT_URL = __SOURCE_COMMIT__ ? `${SOURCE_URL}/tree/${__SOURCE_COMMIT__}` : SOURCE_URL;

/** The worker returns detections down to the lowest selectable threshold; the user's threshold is applied here. */
const SCORE_FLOOR = MIN_CONFIDENCE;

/** Settings whose change needs a new inference run (the rest are applied to the last result). */
const RERUN_KEYS: readonly (keyof Settings)[] = ["iouThreshold", "inputSize"];
const RELOAD_KEYS: readonly (keyof Settings)[] = ["modelSize", "backend"];

/** Tracks are drawn only while the latest tracker update is at most this far (media seconds) from the displayed frame. */
const MAX_TRACK_DISPLAY_AGE = 0.5;

const CLASS_CHANGE_NOTE = "Class changes apply from now on; earlier counts are not recomputed.";

const EMPTY_MESSAGE = "Load an image or video, or start the camera, to start counting.";
const LOCKED_REASON = "Playback unlocks when the pre-analysis is complete.";

const CAMERA_STOPPED_MESSAGE = "Camera stopped. Start it again to continue counting, or press Reset counts.";

/**
 * Top-level wiring: builds the DOM shell, owns the services and connects
 * UI events to them. The only module that knows about all the pieces.
 *
 * Images: one detection, counts are the total. Videos: realtime detection
 * alongside playback (RealtimeVideo); frames sampled while playing feed the
 * tracker, whose newly confirmed tracks are added to the totals (Phase 4).
 * While playing, boxes are the tracks predicted at the displayed time; while
 * paused, the paused frame's own detections ("Current frame" counts).
 * Webcam (Phase 5): the same realtime pipeline on a live stream; stopping
 * releases the camera and keeps the totals until Reset or a file is loaded.
 * Pre-analysis (Phase 6, video files): PreAnalysisSession decodes and detects
 * every sample first; playback stays locked until it is complete, then boxes,
 * totals and "Current frame" come from the cache.
 */
export class App {
    private readonly settings = new SettingsStore();
    private readonly classes = new ClassSelectionStore();
    private readonly uploadPanel = new UploadPanel((file) =>
        checkMediaFile(file, (type) => this.videoEl.canPlayType(type))
    );
    private readonly playbackControls = new PlaybackControls();
    private readonly webcamPanel = new WebcamPanel();
    private readonly analysisPanel = new AnalysisPanel();
    private readonly settingsPanel = new SettingsPanel(this.settings);
    private readonly classPanel = new ClassGroupPanel(this.classes);
    private readonly countsPanel = new CountsPanel();
    private readonly modelStatus = new ModelStatusPanel();
    private readonly debugReadout = new DebugReadout();
    private readonly detectionLayer = new DetectionLayer();
    private readonly tracker = new Tracker({
        confirmationFrames: this.settings.get("confirmationFrames"),
        lostBufferSeconds: this.settings.get("lostBufferSeconds"),
        highScore: this.settings.get("confidenceThreshold")
    });
    private readonly totals = new TotalCounter();
    private lastTrackerMs = 0;

    private stageEl!: HTMLElement;
    private videoEl!: HTMLVideoElement;
    private imageEl!: HTMLImageElement;
    private player!: VideoPlayer;
    private overlay!: OverlayRenderer;

    private client = new InferenceClient();
    private model: Promise<ModelInfo | null> = Promise.resolve(null);
    private modelInfo: ModelInfo | null = null;
    private modelGeneration = 0;

    private mediaKind: InputKind | null = null;
    /** Video files: realtime (default) or pre-analysis. */
    private analysisMode: AnalysisMode = "realtime";
    private videoFile: File | null = null;
    private preAnalysis: PreAnalysisSession | null = null;
    private preAnalysisRenderPending = false;
    /** Invalidates a camera start that finishes after another start, a stop or a file load. */
    private cameraGeneration = 0;
    private source: InputSource | null = null;
    private realtime: RealtimeVideo | null = null;
    private debugTimer: number | null = null;
    private detectionGeneration = 0;
    private rawDetections: Detection[] | null = null;
    private lastTimings: StageTimings | null = null;
    private lastInput: { width: number; height: number } | null = null;

    constructor(private readonly root: HTMLElement) {
        this.buildLayout();
        this.wireMedia();
        this.wireSettings();
        this.wireKeyboard();
        this.loadModel();
    }

    private buildLayout(): void {
        const header = document.createElement("header");
        header.className = "app-header";
        header.innerHTML = `<h1 class="app-title">Object Counter</h1>`;

        this.stageEl = document.createElement("div");
        this.stageEl.className = "media-stage";
        this.stageEl.hidden = true;
        this.stageEl.innerHTML = `
            <video class="media-video" muted></video>
            <img class="media-image" alt="Uploaded image" hidden />
            <canvas class="media-overlay"></canvas>
        `;
        this.videoEl = this.stageEl.querySelector(".media-video") as HTMLVideoElement;
        this.imageEl = this.stageEl.querySelector(".media-image") as HTMLImageElement;

        const main = document.createElement("main");
        main.className = "app-main";
        main.append(
            this.uploadPanel.element,
            this.webcamPanel.element,
            this.analysisPanel.element,
            this.stageEl,
            this.playbackControls.element
        );

        this.settingsPanel.debugBody.appendChild(this.debugReadout.element);

        const sidebar = document.createElement("aside");
        sidebar.className = "app-sidebar";
        sidebar.append(
            this.countsPanel.element,
            this.modelStatus.element,
            this.classPanel.element,
            this.settingsPanel.element
        );

        const layout = document.createElement("div");
        layout.className = "app-layout";
        layout.append(main, sidebar);

        const footer = document.createElement("footer");
        footer.className = "app-footer";
        footer.innerHTML = `
            Runs entirely in your browser. Detection by
            <a href="https://github.com/ultralytics/ultralytics" rel="noopener">Ultralytics YOLOv8</a> (AGPL-3.0).
            Free software under the <a href="https://www.gnu.org/licenses/agpl-3.0.html" rel="noopener">GNU AGPL-3.0</a>:
            <a href="${SOURCE_COMMIT_URL}" rel="noopener">source code</a>${
                __SOURCE_COMMIT__ ? ` (${__SOURCE_COMMIT__.slice(0, 7)})` : ""
            }. <a href="THIRD_PARTY_NOTICES.txt" rel="noopener">Third-party notices</a>.
        `;

        this.root.replaceChildren(header, layout, footer);
    }

    private wireMedia(): void {
        this.player = new VideoPlayer(this.videoEl);
        this.overlay = new OverlayRenderer(this.stageEl.querySelector(".media-overlay") as HTMLCanvasElement, {
            mediaSize: () => this.mediaSize(),
            timeSeconds: () => (this.isStream() ? this.player.getCurrentSeconds() : 0)
        });
        this.overlay.addLayer(this.detectionLayer);
        // Every draw picks the detections that belong to the media time being drawn.
        this.overlay.onBeforeRender((view) => this.updateLayer(view.timeSeconds));

        this.uploadPanel.onSelect((file, kind) => void this.loadMedia(file, kind));

        this.player.onStateChange((state) => {
            this.playbackControls.setPlaying(state === "playing");
            if (state === "playing") this.overlay.startVideoLoop(this.videoEl);
            else this.overlay.stopLoop();
            if (state === "ready" || state === "paused") this.overlay.renderOnce();
            if (this.mediaKind === "webcam" && this.source && (state === "playing" || state === "paused")) {
                this.webcamPanel.setState(state === "playing" ? "live" : "paused");
            }
            if (this.isStream()) this.renderVideoCounts();
        });
        this.videoEl.addEventListener("timeupdate", () =>
            this.playbackControls.setCurrentTime(this.player.getCurrentSeconds())
        );
        this.videoEl.addEventListener("seeked", () => this.overlay.renderOnce());

        this.playbackControls.onPlayPause(() => {
            if (!this.playbackLocked()) this.player.togglePlayback();
        });
        this.playbackControls.onSeek((seconds) => this.player.seekToSeconds(seconds));
        this.countsPanel.onReset(() => this.resetCounts());

        this.webcamPanel.onStart((deviceId) => void this.startCamera(deviceId));
        this.webcamPanel.onStop(() => this.stopCamera());
        this.webcamPanel.onPauseToggle(() => this.player.togglePlayback());
        this.webcamPanel.onDeviceChange((deviceId) => void this.startCamera(deviceId));
        navigator.mediaDevices?.addEventListener?.("devicechange", () => void this.refreshCameraList());

        this.analysisPanel.onModeChange((mode) => this.setAnalysisMode(mode));
        this.analysisPanel.onStart(() => void this.preAnalysis?.start());
        this.analysisPanel.onStop(() => this.preAnalysis?.stop());
        this.analysisPanel.onReanalyze(() => void this.preAnalysis?.reanalyze());
    }

    private wireSettings(): void {
        this.settings.onChange(({ changed }) => {
            const keys = Object.keys(changed) as (keyof Settings)[];
            if (changed.maxInferenceFps !== undefined) this.realtime?.setMaxFps(changed.maxInferenceFps);
            const { confirmationFrames, lostBufferSeconds } = changed;
            if (confirmationFrames !== undefined) this.tracker.setOptions({ confirmationFrames });
            if (lostBufferSeconds !== undefined) this.tracker.setOptions({ lostBufferSeconds });
            if (keys.some((key) => RELOAD_KEYS.includes(key))) {
                this.loadModel();
                this.rerunDetection();
            } else if (keys.some((key) => RERUN_KEYS.includes(key))) {
                this.rerunDetection();
            } else {
                this.refresh();
            }
            this.preAnalysis?.settingsChanged();
        });
        this.classes.onChange(() => {
            // From now on only: tracks of disabled classes go, totals stay (marked "not counting").
            this.tracker.dropDisabledClasses(this.classes.getMask());
            this.refresh();
            this.preAnalysis?.settingsChanged();
        });
        this.modelStatus.onRetry(() => {
            // A crashed worker cannot recover; start a fresh one.
            this.client.dispose();
            this.client = new InferenceClient();
            this.loadModel();
            this.rerunDetection();
        });
    }

    private wireKeyboard(): void {
        window.addEventListener("keydown", (event) => {
            if (event.code !== "Space" || !this.isStream() || !this.source || this.playbackLocked()) return;
            const target = event.target as HTMLElement | null;
            if (target && target.closest("input, select, textarea, button, [role='button']")) return;
            event.preventDefault();
            this.player.togglePlayback();
        });
    }

    /** Starts (re)loading the model for the current settings; detections wait on `this.model`. */
    private loadModel(): void {
        const generation = ++this.modelGeneration;
        const { modelSize, backend } = this.settings.getSettings();
        this.modelInfo = null;
        this.modelStatus.showProgress(null);
        this.model = this.client
            .load(
                { modelSize, backend, modelBaseUrl: new URL(`${import.meta.env.BASE_URL}models/`, location.href).href },
                (progress: LoadProgress) => {
                    if (generation === this.modelGeneration) this.modelStatus.showProgress(progress);
                }
            )
            .then(
                (info) => {
                    if (generation === this.modelGeneration) {
                        this.modelInfo = info;
                        this.modelStatus.showReady(info);
                        this.renderDebug();
                        // A cache made with this model is no longer stale once it is loaded again.
                        this.preAnalysis?.settingsChanged();
                    }
                    return info;
                },
                (error: unknown) => {
                    if (generation === this.modelGeneration) {
                        this.modelStatus.showError(error instanceof Error ? error.message : String(error));
                    }
                    return null;
                }
            );
    }

    private async loadMedia(file: File, kind: MediaKind): Promise<void> {
        this.unloadMedia();
        this.mediaKind = kind;
        this.stageEl.hidden = false;
        this.videoEl.hidden = kind !== "video";
        this.imageEl.hidden = kind !== "image";

        try {
            if (kind === "video") {
                const source = await VideoSource.load(file, this.player);
                this.source = source;
                this.videoFile = file;
                this.playbackControls.show(this.player.getDurationSeconds());
                this.analysisPanel.show(true);
                this.startRealtimeVideo(source);
                this.renderAnalysisPanel();
                this.renderVideoCounts();
                this.debugTimer = window.setInterval(() => this.renderDebug(), 500);
            } else {
                this.source = await ImageSource.load(file, this.imageEl);
                void this.detect();
            }
            this.overlay.renderOnce();
        } catch (error) {
            this.unloadMedia();
            this.uploadPanel.showError(error instanceof Error ? error.message : String(error));
        }
    }

    /** Realtime analysis of the loaded video file (the default mode). */
    private startRealtimeVideo(source: VideoSource): void {
        this.realtime = new RealtimeVideo(
            source,
            {
                detect: (frame) => this.detectFrame(frame),
                onSampledResult: (mediaTime, result) => this.track(mediaTime, result),
                onSeek: () => this.tracker.clear(),
                onUpdate: () => this.onVideoResult(),
                onError: (message) => this.uploadPanel.showError(`Detection failed: ${message}`)
            },
            this.settings.get("maxInferenceFps")
        );
        this.realtime.redetect();
        this.classPanel.setNote(CLASS_CHANGE_NOTE);
    }

    /**
     * Switches a loaded video between realtime and pre-analysis. Each mode has
     * its own totals; the pre-analysis cache of this file is kept while the
     * file stays loaded, so switching back to it needs no new analysis.
     */
    private setAnalysisMode(mode: AnalysisMode): void {
        const source = this.source;
        if (!(source instanceof VideoSource) || !this.videoFile || mode === this.analysisMode) return;
        this.analysisMode = mode;
        this.player.pause();
        this.realtime?.dispose();
        this.realtime = null;
        this.tracker.clear(true);
        this.totals.reset();
        if (mode === "pre") {
            this.classPanel.setNote(null);
            this.preAnalysis ??= new PreAnalysisSession(this.videoFile, {
                detect: (frame) => this.detectFrame(frame),
                currentSettings: async () => {
                    const info = await this.model;
                    return info ? this.analysisSettings() : null;
                },
                currentSettingsNow: () => this.analysisSettings(),
                onChange: () => this.onPreAnalysisChange()
            });
            this.preAnalysis.settingsChanged();
        } else {
            this.preAnalysis?.stop();
            this.startRealtimeVideo(source);
        }
        this.updatePlaybackLock();
        this.renderAnalysisPanel();
        this.renderVideoCounts();
        this.overlay.renderOnce();
        this.renderDebug();
    }

    /** The keys a pre-analysis is compared against. While a model loads, its key is a placeholder (= stale). */
    private analysisSettings(): CurrentAnalysisSettings {
        const s = this.settings.getSettings();
        const enabled = this.classes.getMask().slice();
        const info = this.modelInfo;
        return {
            inference: {
                modelFile: info?.file ?? `loading ${s.modelSize}/${s.backend}`,
                backend: info?.backend ?? (s.backend === "wasm" ? "wasm" : "webgpu"),
                inputSize: s.inputSize,
                iouThreshold: s.iouThreshold,
                maxInferenceFps: s.maxInferenceFps
            },
            tracking: trackingKey(s, enabled),
            trackingSettings: {
                confidenceThreshold: s.confidenceThreshold,
                enabled,
                confirmationFrames: s.confirmationFrames,
                lostBufferSeconds: s.lostBufferSeconds
            }
        };
    }

    private inPreAnalysis(): boolean {
        return this.mediaKind === "video" && this.analysisMode === "pre";
    }

    private playbackLocked(): boolean {
        return this.inPreAnalysis() && !this.preAnalysis?.unlocked;
    }

    private updatePlaybackLock(): void {
        const locked = this.playbackLocked();
        this.playbackControls.setLocked(locked, LOCKED_REASON);
        if (locked && !this.videoEl.paused) this.player.pause();
    }

    /** Progress arrives ~100× per second: coalesce panel updates into one per animation frame. */
    private onPreAnalysisChange(): void {
        this.updatePlaybackLock();
        if (this.preAnalysisRenderPending) return;
        this.preAnalysisRenderPending = true;
        requestAnimationFrame(() => {
            this.preAnalysisRenderPending = false;
            this.renderAnalysisPanel();
            if (this.inPreAnalysis()) {
                this.renderVideoCounts();
                this.overlay.renderOnce();
            }
        });
    }

    private renderAnalysisPanel(): void {
        const session = this.preAnalysis;
        const state = session?.state ?? { status: "idle" as const };
        const progress = session?.progress ?? null;
        const info = session?.info ?? null;
        let message: string | null;
        switch (state.status) {
            case "idle":
                message =
                    "Analyzes every frame (up to the max inference rate) before playback, faster than realtime. Playback unlocks when it is complete.";
                break;
            case "running":
                message = LOCKED_REASON;
                break;
            case "stopped":
                message = `Stopped at ${formatClock(progress?.mediaTime ?? 0)} of ${formatClock(info?.duration ?? 0)}. Resume continues from there; playback stays locked until the analysis is complete.`;
                break;
            case "complete": {
                const ms = session?.completedInMs ?? progress?.elapsedMs ?? 0;
                const speed = info && ms > 0 ? ` (${(info.duration / (ms / 1000)).toFixed(1)}× realtime)` : "";
                message = `Complete: ${progress?.framesDone ?? 0} frames in ${formatClock(ms / 1000)}${speed}.`;
                break;
            }
            case "stale":
                message =
                    state.from === "complete"
                        ? "The boxes and totals shown are from the analysis before the settings change."
                        : "The partial result shown is from before the settings change.";
                break;
        }
        const view: AnalysisPanelView = {
            mode: this.analysisMode,
            status: state.status,
            staleKind: state.kind,
            canStart: session?.canStart ?? true,
            resume: state.status === "stopped",
            progress,
            message,
            error: session?.error ?? null
        };
        this.analysisPanel.render(view);
    }

    private unloadMedia(): void {
        this.detectionGeneration++;
        this.preAnalysis?.dispose();
        this.preAnalysis = null;
        this.videoFile = null;
        this.analysisMode = "realtime";
        this.analysisPanel.show(false);
        this.renderAnalysisPanel();
        this.playbackControls.setLocked(false);
        this.cameraGeneration++;
        this.webcamPanel.setState("off");
        this.webcamPanel.setStatus(null);
        this.realtime?.dispose();
        this.realtime = null;
        this.tracker.clear(true);
        this.totals.reset();
        this.classPanel.setNote(null);
        if (this.debugTimer !== null) window.clearInterval(this.debugTimer);
        this.debugTimer = null;
        this.player.unload();
        this.playbackControls.hide();
        this.source?.dispose();
        this.source = null;
        this.rawDetections = null;
        this.lastTimings = null;
        this.lastInput = null;
        this.detectionLayer.clear();
        this.mediaKind = null;
        this.stageEl.hidden = true;
        this.overlay.renderOnce();
        this.countsPanel.render({
            totalTitle: "Total",
            total: null,
            message: EMPTY_MESSAGE
        });
        this.renderDebug();
    }

    /**
     * Starts the camera (or switches to another one). A first start replaces any
     * loaded file; a restart after Stop, or a camera switch, keeps the totals
     * and only drops the tracks (the scene changes).
     */
    private async startCamera(deviceId: string | null): Promise<void> {
        const continuing = this.mediaKind === "webcam";
        if (continuing) this.releaseCamera();
        else this.unloadMedia();
        // After the cleanup above (unloadMedia also bumps the generation).
        const generation = ++this.cameraGeneration;
        this.uploadPanel.clearError();
        this.webcamPanel.clearError();
        this.webcamPanel.setState("starting");

        let source: WebcamSource | null = null;
        try {
            source = await WebcamSource.open(this.player, deviceId);
            if (generation !== this.cameraGeneration) {
                source.dispose();
                return;
            }
            await source.show();
        } catch (error) {
            if (generation !== this.cameraGeneration) return;
            source?.dispose();
            this.webcamPanel.setState("off");
            this.webcamPanel.showError(cameraErrorMessage(error));
            this.renderVideoCounts();
            return;
        }
        if (generation !== this.cameraGeneration) {
            source.dispose();
            return;
        }

        this.mediaKind = "webcam";
        this.source = source;
        this.stageEl.hidden = false;
        this.videoEl.hidden = false;
        this.imageEl.hidden = true;
        source.onEnded(() => this.stopCamera(CAMERA_DISCONNECTED_MESSAGE));
        this.realtime = new RealtimeVideo(
            source,
            {
                detect: (frame) => this.detectFrame(frame),
                onSampledResult: (mediaTime, result) => this.track(mediaTime, result),
                onSeek: () => this.tracker.clear(),
                // The stream clock ran on while paused: skip that time so tracks continue as if there was no pause.
                onLiveResume: (pausedAt, resumedAt) =>
                    this.tracker.skip(resumedAt - pausedAt - 1 / this.settings.get("maxInferenceFps")),
                onUpdate: () => this.onVideoResult(),
                onError: (message) => this.webcamPanel.showError(`Detection failed: ${message}`)
            },
            this.settings.get("maxInferenceFps")
        );
        this.classPanel.setNote(CLASS_CHANGE_NOTE);
        this.debugTimer = window.setInterval(() => this.renderDebug(), 500);
        this.webcamPanel.setState("live");
        this.player.play();
        this.renderVideoCounts();
        this.overlay.renderOnce();
        await this.refreshCameraList();
    }

    /** Stop camera: releases it (all tracks stopped) and keeps the totals visible. */
    private stopCamera(errorMessage?: string): void {
        if (this.mediaKind !== "webcam") return;
        this.cameraGeneration++;
        this.releaseCamera();
        this.webcamPanel.setState("off");
        this.webcamPanel.setStatus(null);
        if (errorMessage) this.webcamPanel.showError(errorMessage);
        this.stageEl.hidden = true;
        this.renderVideoCounts();
        this.renderDebug();
    }

    /** Releases the camera and the realtime pipeline; totals stay, tracks go. */
    private releaseCamera(): void {
        this.realtime?.dispose();
        this.realtime = null;
        this.tracker.clear();
        if (this.debugTimer !== null) window.clearInterval(this.debugTimer);
        this.debugTimer = null;
        this.source?.dispose();
        this.source = null;
        this.detectionLayer.clear();
        this.overlay.stopLoop();
        this.overlay.renderOnce();
    }

    private async refreshCameraList(): Promise<void> {
        const source = this.source;
        if (!(source instanceof WebcamSource)) return;
        const devices = await WebcamSource.listCameras();
        if (source !== this.source) return;
        const mode = source.mode();
        this.webcamPanel.setDevices(devices, mode.deviceId);
        const fps = mode.frameRate ? ` at ${Math.round(mode.frameRate)} fps` : "";
        this.webcamPanel.setStatus(`${mode.label || "Camera"}: ${mode.width}×${mode.height}${fps}`);
    }

    /** Runs the model on the current image; stale results (newer media or settings) are discarded. */
    private async detect(): Promise<void> {
        const source = this.source;
        if (!source || source.kind !== "image") return;
        const generation = ++this.detectionGeneration;
        this.countsPanel.render({ totalTitle: "Total (this image)", total: null, message: "Detecting…", busy: true });

        const info = await this.model;
        if (generation !== this.detectionGeneration) return;
        if (!info) {
            this.countsPanel.render({
                totalTitle: "Total (this image)",
                total: null,
                message: "The model is not loaded."
            });
            return;
        }

        try {
            const frame = await source.captureFrame();
            const { inputSize, iouThreshold } = this.settings.getSettings();
            const result = await this.client.detect(frame, { inputSize, iouThreshold, scoreFloor: SCORE_FLOOR });
            if (generation !== this.detectionGeneration) return;
            this.rawDetections = result.detections;
            this.lastTimings = result.timings;
            this.lastInput = { width: result.inputWidth, height: result.inputHeight };
            this.refresh();
        } catch (error) {
            if (generation !== this.detectionGeneration) return;
            this.countsPanel.render({
                totalTitle: "Total (this image)",
                total: null,
                message: `Detection failed: ${error instanceof Error ? error.message : String(error)}`
            });
        }
    }

    /** Runs inference on one frame with the current settings, once a model is available (else closes the frame). */
    private async detectFrame(frame: CapturedFrame): Promise<DetectResult | null> {
        const info = await this.model;
        if (!info) {
            frame.close();
            return null;
        }
        const { inputSize, iouThreshold } = this.settings.getSettings();
        return this.client.detect(frame, { inputSize, iouThreshold, scoreFloor: SCORE_FLOOR });
    }

    /** After a change that alters inference itself (IoU, input size, model). */
    private rerunDetection(): void {
        if (this.mediaKind === "image") void this.detect();
        else this.realtime?.redetect(); // while playing, the next sampled frames use the new settings anyway
    }

    /** A frame sampled during playback: update tracks, count newly confirmed ones. */
    private track(mediaTime: number, result: DetectResult): void {
        const mask = this.classes.getMask();
        const { lowScore } = DEFAULT_TUNING;
        const detections = result.detections.filter((d) => mask[d.classId] === 1 && d.score >= lowScore);
        this.tracker.setOptions({ highScore: this.settings.get("confidenceThreshold") });
        const start = performance.now();
        const update = this.tracker.update(mediaTime, detections);
        this.lastTrackerMs = performance.now() - start;
        for (const track of update.newlyConfirmed) this.totals.add(track.classId);
        for (const change of update.reclassified) this.totals.move(change.from, change.to);
        if (update.newlyConfirmed.length > 0 || update.reclassified.length > 0) this.renderVideoCounts();
        // Automated clip runs (scripts/e2e/clipCounts.ts) set data-trace="1" to record the tracker's input and state.
        if (this.stageEl.dataset.trace === "1") {
            this.stageEl.dispatchEvent(
                new CustomEvent("trackerupdate", {
                    detail: {
                        mediaTime,
                        detections: result.detections.filter((d) => d.score >= lowScore),
                        tracks: this.tracker.snapshot(),
                        newlyConfirmed: update.newlyConfirmed,
                        trackerMs: this.lastTrackerMs
                    }
                })
            );
        }
    }

    /** Reset counts: clears totals and tracks (track IDs restart at 1). */
    private resetCounts(): void {
        this.tracker.clear(true);
        this.totals.reset();
        this.overlay.renderOnce();
        this.renderVideoCounts();
        this.renderDebug();
    }

    private onVideoResult(): void {
        // While playing, the per-frame video loop draws the new result with the next presented frame.
        if (this.videoEl.paused) {
            this.overlay.renderOnce();
            this.renderVideoCounts();
        }
    }

    /** The unfiltered detections for the frame at `timeSeconds`. */
    private rawAt(timeSeconds: number): Detection[] | null {
        if (this.inPreAnalysis()) {
            const cache = this.preAnalysis?.cache;
            const index = cache ? cache.indexAtOrBefore(timeSeconds) : -1;
            return cache && index >= 0 && timeSeconds - cache.time(index) <= MAX_TRACK_DISPLAY_AGE
                ? cache.at(index).detections
                : null;
        }
        if (this.isStream()) return this.realtime?.resultAt(timeSeconds)?.detections ?? null;
        return this.rawDetections;
    }

    private filtered(raw: readonly Detection[]): Detection[] {
        return filterDetections(raw, this.settings.get("confidenceThreshold"), this.classes.getMask());
    }

    private updateLayer(timeSeconds: number): void {
        const raw = this.rawAt(timeSeconds);
        const showRaw = this.settings.get("showRawDetections");
        const showIds = this.settings.get("showTrackIds");
        let shown: DrawnBox[];
        let resultTime = "";
        if (!this.isStream()) {
            shown = raw ? this.filtered(raw) : [];
        } else if (this.inPreAnalysis()) {
            // From the cache: the analyzed sample shown at this time, with the settings it was tracked with.
            const run = this.preAnalysis?.tracking;
            const frame = run?.tracksAt(timeSeconds, MAX_TRACK_DISPLAY_AGE) ?? null;
            if (!run || !frame) {
                shown = [];
            } else if (this.videoEl.paused && raw && Math.abs(frame.time - timeSeconds) < 0.002) {
                const { confidenceThreshold, enabled } = run.settings;
                const detections = filterDetections(raw, confidenceThreshold, enabled);
                const ids = trackIdsFor(detections, frame.tracks);
                shown = detections.map((d, i) => ({ ...d, trackId: ids[i] }));
            } else {
                shown = frame.tracks.map((t) => ({
                    classId: t.classId,
                    score: t.confidence,
                    box: t.box,
                    trackId: t.id
                }));
            }
            resultTime = frame?.time.toFixed(3) ?? "";
        } else if (this.videoEl.paused && this.realtime?.hasExactResult()) {
            // Paused: the frame's own detections (what "Current frame" counts), labeled with overlapping tracks.
            const exact = this.realtime.resultAt(timeSeconds);
            const detections = exact ? this.filtered(exact.detections) : [];
            const ids = trackIdsFor(detections, this.tracker.visibleAt(timeSeconds, MAX_TRACK_DISPLAY_AGE));
            shown = detections.map((d, i) => ({ ...d, trackId: ids[i] }));
            resultTime = exact?.mediaTime.toFixed(3) ?? "";
        } else {
            // Playing: tracks, predicted to the displayed media time (no lag behind the picture).
            const tracks = this.tracker.visibleAt(timeSeconds, MAX_TRACK_DISPLAY_AGE);
            shown = tracks.map((t) => ({ classId: t.classId, score: t.confidence, box: t.box, trackId: t.id }));
            const updated = this.tracker.getLastTime();
            if (updated !== null && Math.abs(timeSeconds - updated) <= MAX_TRACK_DISPLAY_AGE) {
                resultTime = updated.toFixed(3);
            }
        }
        this.detectionLayer.set(shown, raw && showRaw ? raw : null, showIds);
        // Observable for automated tests (scripts/e2e): which result is on screen for which frame.
        const stage = this.stageEl.dataset;
        stage.drawTime = timeSeconds.toFixed(3);
        stage.resultTime = resultTime;
        stage.boxes = String(shown.length);
    }

    /** Applies threshold and class selection to the current results: boxes, counts and debug, no new inference. */
    private refresh(): void {
        this.overlay.renderOnce();
        if (this.isStream()) {
            this.renderVideoCounts();
        } else if (this.rawDetections) {
            // For a still image the frame's counts are the total.
            this.countsPanel.render({
                totalTitle: "Total (this image)",
                total: countByClass(this.filtered(this.rawDetections))
            });
        }
        this.renderDebug();
    }

    /** Video and webcam: totals (unique confirmed tracks) always; the current-frame section only while paused. */
    private renderVideoCounts(): void {
        if (this.inPreAnalysis()) {
            this.renderPreAnalysisCounts();
            return;
        }
        const realtime = this.realtime;
        const total = this.totals.totals(this.classes.getMask());
        if (!realtime) {
            // Camera stopped (or failed to start again): the session's totals stay until Reset.
            if (this.mediaKind === "webcam") {
                this.countsPanel.render({
                    totalTitle: "Total",
                    total,
                    message: CAMERA_STOPPED_MESSAGE,
                    canReset: true
                });
            }
            return;
        }
        const totalView = {
            totalTitle: "Total",
            total,
            message:
                total.length > 0
                    ? undefined
                    : this.mediaKind === "webcam"
                      ? "No objects counted yet."
                      : "No objects counted yet. Play the video to count.",
            canReset: true
        };
        if (!this.videoEl.paused) {
            this.countsPanel.render(totalView);
            return;
        }
        const exact = realtime.hasExactResult() ? realtime.resultAt(this.player.getCurrentSeconds()) : null;
        this.countsPanel.render({
            ...totalView,
            current: exact ? countByClass(this.filtered(exact.detections)) : null,
            currentMessage: exact ? undefined : "Detecting…"
        });
    }

    /** Pre-analysis: totals for the whole video once complete, labeled incomplete before; no Reset (the cache defines them). */
    private renderPreAnalysisCounts(): void {
        const session = this.preAnalysis;
        const run = session?.tracking;
        const cache = session?.cache;
        if (!session || !run || !cache || session.state.status === "idle") {
            this.countsPanel.render({
                totalTitle: "Total",
                total: null,
                message: "Start the pre-analysis to count. The totals for the whole video are shown before playback."
            });
            return;
        }
        const complete = session.unlocked;
        const progress = session.progress;
        const view = {
            totalTitle: complete ? "Total (whole video)" : "Total (incomplete)",
            total: run.totals(),
            message: complete
                ? session.state.status === "stale"
                    ? "From the analysis before the settings change."
                    : undefined
                : `Analyzed ${formatClock(progress?.mediaTime ?? 0)} of ${formatClock(session.info?.duration ?? 0)}.`,
            busy: session.state.status === "running"
        };
        if (!complete || !this.videoEl.paused) {
            this.countsPanel.render(view);
            return;
        }
        // Paused: the analyzed sample for the displayed frame (a 60 fps video sampled at 30 shows the one before).
        const time = this.player.getCurrentSeconds();
        const index = cache.indexAtOrBefore(time);
        const sample = index >= 0 && time - cache.time(index) <= MAX_TRACK_DISPLAY_AGE ? cache.at(index) : null;
        const { confidenceThreshold, enabled } = run.settings;
        this.countsPanel.render({
            ...view,
            current: sample ? countByClass(filterDetections(sample.detections, confidenceThreshold, enabled)) : [],
            currentMessage: sample ? undefined : "No analyzed frame here."
        });
    }

    private renderDebug(): void {
        const realtime = this.realtime;
        const stats = realtime?.stats() ?? null;
        const result = stats?.lastResult ?? null;
        const raw = this.rawAt(this.isStream() ? this.player.getCurrentSeconds() : 0);
        const quality = this.isStream() && this.source ? this.videoEl.getVideoPlaybackQuality() : null;
        this.debugReadout.render({
            model: this.modelInfo,
            timings: result?.timings ?? this.lastTimings,
            input: result ? { width: result.inputWidth, height: result.inputHeight } : this.lastInput,
            rawCount: raw?.length ?? null,
            shownCount: raw ? this.filtered(raw).length : null,
            video:
                stats && quality
                    ? {
                          effectiveFps: stats.effectiveFps,
                          maxFps: this.settings.get("maxInferenceFps"),
                          offered: stats.offered,
                          dropped: stats.dropped,
                          latencyMs: stats.lastLatencyMs,
                          playbackDropped: quality.droppedVideoFrames,
                          playbackTotal: quality.totalVideoFrames
                      }
                    : null,
            tracker:
                this.isStream() && !this.inPreAnalysis()
                    ? { ...this.tracker.stats(), updateMs: this.lastTrackerMs }
                    : null,
            analysis:
                this.inPreAnalysis() && this.preAnalysis?.cache
                    ? {
                          samples: this.preAnalysis.cache.length,
                          cacheBytes: this.preAnalysis.cache.byteSize(),
                          samplesPerSecond:
                              this.preAnalysis.progress && this.preAnalysis.progress.elapsedMs > 0
                                  ? this.preAnalysis.progress.framesDone / (this.preAnalysis.progress.elapsedMs / 1000)
                                  : null
                      }
                    : null,
            camera: this.source instanceof WebcamSource ? this.source.mode() : null
        });
    }

    /** Video file or live camera: the realtime pipeline with tracking and totals. */
    private isStream(): boolean {
        return this.mediaKind === "video" || this.mediaKind === "webcam";
    }

    private mediaSize(): Size | null {
        if (this.isStream() && this.videoEl.videoWidth > 0) {
            return { width: this.videoEl.videoWidth, height: this.videoEl.videoHeight };
        }
        return this.source?.frameSize() ?? null;
    }
}
