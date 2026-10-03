import { countByClass } from "../counting/countDetections";
import { TotalCounter } from "../counting/TotalCounter";
import type { LoadProgress, ModelInfo, StageTimings } from "../inference/InferenceMessages";
import { InferenceClient } from "../inference/InferenceClient";
import type { DetectResult } from "../inference/InferenceClient";
import type { Detection } from "../inference/postprocess";
import { filterDetections } from "../inference/postprocess";
import { ImageSource } from "../input/ImageSource";
import { VideoSource } from "../input/VideoSource";
import type { InputSource } from "../input/InputSource";
import { checkMediaFile } from "../input/MediaFiles";
import type { MediaKind } from "../input/MediaFiles";
import type { CapturedFrame } from "../input/MediaTypes";
import { VideoPlayer } from "../input/VideoPlayer";
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
import { trackIdsFor } from "../tracking/association";
import { DEFAULT_TUNING, Tracker } from "../tracking/Tracker";
import type { Size } from "../utils/geometry";
import { RealtimeVideo } from "./RealtimeVideo";

/** AGPL §13: every user of the site must be offered the source. */
const SOURCE_URL = "https://github.com/dtcph/Video-analyzer";

/** The worker returns detections down to the lowest selectable threshold; the user's threshold is applied here. */
const SCORE_FLOOR = MIN_CONFIDENCE;

/** Settings whose change needs a new inference run (the rest are applied to the last result). */
const RERUN_KEYS: readonly (keyof Settings)[] = ["iouThreshold", "inputSize"];
const RELOAD_KEYS: readonly (keyof Settings)[] = ["modelSize", "backend"];

/** Tracks are drawn only while the latest tracker update is at most this far (media seconds) from the displayed frame. */
const MAX_TRACK_DISPLAY_AGE = 0.5;

const CLASS_CHANGE_NOTE = "Class changes apply from now on; earlier counts are not recomputed.";

/**
 * Top-level wiring: builds the DOM shell, owns the services and connects
 * UI events to them. The only module that knows about all the pieces.
 *
 * Images: one detection, counts are the total. Videos: realtime detection
 * alongside playback (RealtimeVideo); frames sampled while playing feed the
 * tracker, whose newly confirmed tracks are added to the totals (Phase 4).
 * While playing, boxes are the tracks predicted at the displayed time; while
 * paused, the paused frame's own detections ("Current frame" counts).
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

    private mediaKind: MediaKind | null = null;
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
        // Every draw picks the detections that belong to the media time being drawn.
        this.overlay.onBeforeRender((view) => this.updateLayer(view.timeSeconds));

        this.uploadPanel.onSelect((file, kind) => void this.loadMedia(file, kind));

        this.player.onStateChange((state) => {
            this.playbackControls.setPlaying(state === "playing");
            if (state === "playing") this.overlay.startVideoLoop(this.videoEl);
            else this.overlay.stopLoop();
            if (state === "ready" || state === "paused") this.overlay.renderOnce();
            if (this.mediaKind === "video") this.renderVideoCounts();
        });
        this.videoEl.addEventListener("timeupdate", () =>
            this.playbackControls.setCurrentTime(this.player.getCurrentSeconds())
        );
        this.videoEl.addEventListener("seeked", () => this.overlay.renderOnce());

        this.playbackControls.onPlayPause(() => this.player.togglePlayback());
        this.playbackControls.onSeek((seconds) => this.player.seekToSeconds(seconds));
        this.countsPanel.onReset(() => this.resetCounts());
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
        });
        this.classes.onChange(() => {
            // From now on only: tracks of disabled classes go, totals stay (marked "not counting").
            this.tracker.dropDisabledClasses(this.classes.getMask());
            this.refresh();
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
                const source = await VideoSource.load(file, this.player);
                this.source = source;
                this.playbackControls.show(this.player.getDurationSeconds());
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

    private unloadMedia(): void {
        this.detectionGeneration++;
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
        if (this.mediaKind === "video") return this.realtime?.resultAt(timeSeconds)?.detections ?? null;
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
        if (this.mediaKind !== "video") {
            shown = raw ? this.filtered(raw) : [];
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
        if (this.mediaKind === "video") {
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

    /** Video: totals (unique confirmed tracks) always; the current-frame section only while paused. */
    private renderVideoCounts(): void {
        const realtime = this.realtime;
        if (!realtime) return;
        const total = this.totals.totals(this.classes.getMask());
        const totalView = {
            totalTitle: "Total",
            total,
            message: total.length === 0 ? "No objects counted yet. Play the video to count." : undefined,
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

    private renderDebug(): void {
        const realtime = this.realtime;
        const stats = realtime?.stats() ?? null;
        const result = stats?.lastResult ?? null;
        const raw = this.rawAt(this.mediaKind === "video" ? this.player.getCurrentSeconds() : 0);
        const quality = this.mediaKind === "video" ? this.videoEl.getVideoPlaybackQuality() : null;
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
            tracker: this.mediaKind === "video" ? { ...this.tracker.stats(), updateMs: this.lastTrackerMs } : null
        });
    }

    private mediaSize(): Size | null {
        if (this.mediaKind === "video" && this.videoEl.videoWidth > 0) {
            return { width: this.videoEl.videoWidth, height: this.videoEl.videoHeight };
        }
        return this.source?.frameSize() ?? null;
    }
}
