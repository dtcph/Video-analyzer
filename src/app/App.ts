import { countByClass } from "../counting/countDetections";
import type { LoadProgress, ModelInfo, StageTimings } from "../inference/InferenceMessages";
import { InferenceClient } from "../inference/InferenceClient";
import type { Detection } from "../inference/postprocess";
import { filterDetections } from "../inference/postprocess";
import { ImageSource } from "../input/ImageSource";
import type { InputSource } from "../input/InputSource";
import { checkMediaFile } from "../input/MediaFiles";
import type { MediaKind } from "../input/MediaFiles";
import { VideoPlayer } from "../input/VideoPlayer";
import { DetectionLayer } from "../rendering/DetectionLayer";
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
import type { Size } from "../utils/geometry";

/** AGPL §13: every user of the site must be offered the source. */
const SOURCE_URL = "https://github.com/dtcph/Video-analyzer";

/** The worker returns detections down to the lowest selectable threshold; the user's threshold is applied here. */
const SCORE_FLOOR = MIN_CONFIDENCE;

/** Settings whose change needs a new inference run (the rest are applied to the last result). */
const RERUN_KEYS: readonly (keyof Settings)[] = ["iouThreshold", "inputSize"];
const RELOAD_KEYS: readonly (keyof Settings)[] = ["modelSize", "backend"];

/**
 * Top-level wiring: builds the DOM shell, owns the services and connects
 * UI events to them. The only module that knows about all the pieces.
 *
 * Phase 2 scope: image detection end to end. Videos play, but detection on
 * video arrives in Phase 3.
 */
export class App {
    private readonly settings = new SettingsStore();
    private readonly classes = new ClassSelectionStore();
    private readonly uploadPanel = new UploadPanel((file) =>
        checkMediaFile(file, (type) => this.videoEl.canPlayType(type))
    );
    private readonly playbackControls = new PlaybackControls();
    private readonly settingsPanel = new SettingsPanel(this.settings);
    private readonly classPanel = new ClassGroupPanel(this.classes);
    private readonly countsPanel = new CountsPanel();
    private readonly modelStatus = new ModelStatusPanel();
    private readonly debugReadout = new DebugReadout();
    private readonly detectionLayer = new DetectionLayer();

    private stageEl!: HTMLElement;
    private videoEl!: HTMLVideoElement;
    private imageEl!: HTMLImageElement;
    private player!: VideoPlayer;
    private overlay!: OverlayRenderer;

    private client = new InferenceClient();
    private model: Promise<ModelInfo | null> = Promise.resolve(null);
    private modelInfo: ModelInfo | null = null;
    private modelGeneration = 0;

    private mediaKind: MediaKind | null = null;
    private source: InputSource | null = null;
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
        main.append(this.uploadPanel.element, this.stageEl, this.playbackControls.element);

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
            <a href="${SOURCE_URL}" rel="noopener">source code</a>.
        `;

        this.root.replaceChildren(header, layout, footer);
    }

    private wireMedia(): void {
        this.player = new VideoPlayer(this.videoEl);
        this.overlay = new OverlayRenderer(this.stageEl.querySelector(".media-overlay") as HTMLCanvasElement, {
            mediaSize: () => this.mediaSize(),
            timeSeconds: () => (this.mediaKind === "video" ? this.player.getCurrentSeconds() : 0)
        });
        this.overlay.addLayer(this.detectionLayer);

        this.uploadPanel.onSelect((file, kind) => void this.loadMedia(file, kind));

        this.player.onStateChange((state) => {
            this.playbackControls.setPlaying(state === "playing");
            if (state === "playing") this.overlay.startLoop();
            else this.overlay.stopLoop();
            if (state === "ready" || state === "paused") this.overlay.renderOnce();
        });
        this.videoEl.addEventListener("timeupdate", () =>
            this.playbackControls.setCurrentTime(this.player.getCurrentSeconds())
        );
        this.videoEl.addEventListener("seeked", () => this.overlay.renderOnce());

        this.playbackControls.onPlayPause(() => this.player.togglePlayback());
        this.playbackControls.onSeek((seconds) => this.player.seekToSeconds(seconds));
    }

    private wireSettings(): void {
        this.settings.onChange(({ changed }) => {
            const keys = Object.keys(changed) as (keyof Settings)[];
            if (keys.some((key) => RELOAD_KEYS.includes(key))) {
                this.loadModel();
                void this.detect();
            } else if (keys.some((key) => RERUN_KEYS.includes(key))) {
                void this.detect();
            } else {
                this.refresh();
            }
        });
        this.classes.onChange(() => this.refresh());
        this.modelStatus.onRetry(() => {
            // A crashed worker cannot recover; start a fresh one.
            this.client.dispose();
            this.client = new InferenceClient();
            this.loadModel();
            void this.detect();
        });
    }

    private wireKeyboard(): void {
        window.addEventListener("keydown", (event) => {
            if (event.code !== "Space" || this.mediaKind !== "video") return;
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
                const metadata = await this.player.load(file);
                this.playbackControls.show(metadata.durationSeconds);
                this.countsPanel.render({
                    totalTitle: "Total",
                    total: null,
                    message: "Detection on video is not available yet; images are supported."
                });
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

    private unloadMedia(): void {
        this.detectionGeneration++;
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
            message: "Load an image or video to start counting."
        });
        this.renderDebug();
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

    /** Applies threshold and class selection to the last result: boxes, counts and debug, no new inference. */
    private refresh(): void {
        if (!this.rawDetections) return;
        const { confidenceThreshold, showRawDetections } = this.settings.getSettings();
        const shown = filterDetections(this.rawDetections, confidenceThreshold, this.classes.getMask());
        this.detectionLayer.set(shown, showRawDetections ? this.rawDetections : null);
        this.overlay.renderOnce();
        // For a still image the frame's counts are the total.
        this.countsPanel.render({ totalTitle: "Total (this image)", total: countByClass(shown) });
        this.renderDebug(shown.length);
    }

    private renderDebug(shownCount: number | null = null): void {
        this.debugReadout.render({
            model: this.modelInfo,
            timings: this.lastTimings,
            input: this.lastInput,
            rawCount: this.rawDetections?.length ?? null,
            shownCount
        });
    }

    private mediaSize(): Size | null {
        if (this.mediaKind === "video" && this.videoEl.videoWidth > 0) {
            return { width: this.videoEl.videoWidth, height: this.videoEl.videoHeight };
        }
        return this.source?.frameSize() ?? null;
    }
}
