import { AppState } from "./AppState";
import { VideoPlayer } from "../video/VideoPlayer";
import { FrameSampler } from "../video/FrameSampler";
import { VideoRenderer } from "../rendering/VideoRenderer";
import { UploadPanel } from "../ui/UploadPanel";
import { Timeline } from "../ui/Timeline";
import { PlaybackControls } from "../ui/PlaybackControls";
import { AnalysisControls } from "../ui/AnalysisControls";
import { TrackingControls } from "../ui/TrackingControls";
import { TrackPanel } from "../ui/TrackPanel";
import { Inspector } from "../ui/Inspector";
import { AnnotationPanel } from "../ui/AnnotationPanel";
import { MetadataPanel } from "../ui/MetadataPanel";
import { ANALYSIS_RESOLUTION_BUDGET } from "../analysis/AnalysisTypes";
import { fitWithinPreservingAspect } from "../utils/geometry";
import { hitTestTracks } from "../rendering/TrackingOverlay";
import { latestPoint } from "../tracking/Track";

const DEFAULT_FRAME_RATE = 30;

/**
 * Top-level wiring: builds the DOM shell, instantiates services from
 * AppState, and connects UI events to playback / rendering. This is
 * the only place that knows about all the pieces at once.
 */
export class App {
  private state = new AppState();
  private frameRate = DEFAULT_FRAME_RATE;

  private player!: VideoPlayer;
  private renderer!: VideoRenderer;
  private frameSampler: FrameSampler | null = null;

  private uploadPanel = new UploadPanel();
  private metadataPanel = new MetadataPanel();
  private timeline = new Timeline();
  private playbackControls = new PlaybackControls();
  private analysisControls = new AnalysisControls();
  private trackingControls = new TrackingControls();
  private trackPanel = new TrackPanel();
  private annotationPanel = new AnnotationPanel();
  private inspector = new Inspector();

  private stageEl!: HTMLElement;
  private videoEl!: HTMLVideoElement;
  private trackingCanvas!: HTMLCanvasElement;
  private resetButton!: HTMLButtonElement;

  constructor(private readonly root: HTMLElement) {
    this.buildLayout();
    this.wirePlayer();
    this.wireUi();
    this.wireDataListeners();
    this.wireKeyboard();
  }

  private buildLayout(): void {
    this.root.innerHTML = "";

    const header = document.createElement("header");
    header.className = "app-header";
    header.innerHTML = `
            <h1 class="app-title">Blob Analyzer</h1>
            <button type="button" class="header-reset-button" disabled>Reset</button>
        `;
    /* header.innerHTML = `<h1 class="app-title">Blob Analyzer</h1>
            <p class="app-subtitle">Video as data: blob detection, tracking, and exposure analysis</p>`; */
    this.resetButton = header.querySelector(".header-reset-button") as HTMLButtonElement;

    const stage = document.createElement("div");
    stage.className = "video-stage";
    stage.innerHTML = `
            <video id="video"></video>
            <canvas id="analysis-layer"></canvas>
            <canvas id="tracking-layer"></canvas>
            <canvas id="annotation-layer"></canvas>
        `;
    this.stageEl = stage;
    this.videoEl = stage.querySelector("#video") as HTMLVideoElement;

    const sidebar = document.createElement("aside");
    sidebar.className = "app-sidebar";
    sidebar.appendChild(this.metadataPanel.element);
    sidebar.appendChild(this.analysisControls.element);
    sidebar.appendChild(this.trackingControls.element);
    sidebar.appendChild(this.trackPanel.element);
    sidebar.appendChild(this.annotationPanel.element);
    sidebar.appendChild(this.inspector.element);

    const main = document.createElement("main");
    main.className = "app-main";
    main.appendChild(this.uploadPanel.element);
    main.appendChild(stage);
    main.appendChild(this.playbackControls.element);
    main.appendChild(this.timeline.element);

    const layout = document.createElement("div");
    layout.className = "app-layout";
    layout.appendChild(main);
    layout.appendChild(sidebar);

    this.root.appendChild(header);
    this.root.appendChild(layout);

    this.stageEl.classList.add("is-empty");
  }

  private wirePlayer(): void {
    this.player = new VideoPlayer(this.videoEl);

    const analysisCanvas = this.stageEl.querySelector(
      "#analysis-layer",
    ) as HTMLCanvasElement;
    this.trackingCanvas = this.stageEl.querySelector(
      "#tracking-layer",
    ) as HTMLCanvasElement;
    const annotationCanvas = this.stageEl.querySelector(
      "#annotation-layer",
    ) as HTMLCanvasElement;

    this.renderer = new VideoRenderer(
      this.player,
      analysisCanvas,
      this.trackingCanvas,
      annotationCanvas,
      this.state.trackManager,
      this.state.annotationManager,
      this.frameRate,
      () => this.state.blobTracker.getLastCameraMotion(),
    );

    this.trackingCanvas.addEventListener("click", (event) =>
      this.handleTrackingCanvasClick(event),
    );

    this.player.onStateChange((playbackState) => {
      const loaded = playbackState !== "empty" && playbackState !== "loading";
      this.playbackControls.setEnabled(loaded);
      this.resetButton.disabled = !loaded;
      this.playbackControls.setPlaybackLabel(
        playbackState === "playing" /* || playbackState === "playing-reverse" */
          ? "Pause"
          : "Play",
      );

      if (playbackState === "playing") {
        this.frameSampler?.start();
      } else {
        this.frameSampler?.stop();

        // The sampler's rVFC loop stops exactly here, but the final
        // "timeupdate" before pause/end almost never lands precisely
        // on the frame the video settles at (timeupdate fires on its
        // own ~4Hz cadence, not in lockstep with playback stopping).
        // Without this, the last frame — most visibly the one at
        // natural playback end — never gets analyzed, so it has no
        // track data and nothing on it is selectable.
        if (loaded) void this.frameSampler?.captureNow();
      }
    });

    this.videoEl.addEventListener("timeupdate", () => {
      this.timeline.setCurrentTime(this.player.getCurrentSeconds());

      // The sampler's own loop covers playback; while paused/scrubbing,
      // capture the scrubbed-to frame directly for immediate feedback.
      if (this.player.getState() !== "playing") {
        void this.frameSampler?.captureNow();
      }
    });

    this.state.analysisWorkerClient.onFrameAnalyzed((result) => {
      this.state.blobTracker.update(result.frame, result.blobs);
      this.renderer.setLatestFrameResult(result);
      this.analysisControls.updateExposureStats(result.exposure);
      this.analysisControls.updateBlobStats(result.blobs);
    });

    this.state.analysisWorkerClient.onStatsUpdate((stats) => {
      this.analysisControls.updateStats(stats);
    });
  }

  private wireUi(): void {
    this.uploadPanel.onSelect((file) => void this.loadVideo(file));

    this.playbackControls.onPlayPause(() => this.player.togglePlayback());
    this.playbackControls.onPlayForward(() => this.player.play());
    // this.playbackControls.onPlayBackward(() => this.player.playBackward());

    this.analysisControls.onToggleLayer((layer, enabled) => {
      this.renderer.setLayerVisibility({ [layer]: enabled });
    });
    this.analysisControls.onToggleExposureMode((mode, enabled) => {
      this.renderer.setExposureVisibility({ [mode]: enabled });
    });
    this.analysisControls.onChangeThreshold((partial) => {
      this.state.analysisEngine.updateSettings(partial);
      this.state.analysisWorkerClient.updateSettings(partial);

      // While paused/scrubbing, nothing resubmits the current frame on
      // its own — the worker only sees new frames from playback or the
      // timeupdate handler. Re-capture the frame under the playhead so
      // a slider drag reflects in the overlays immediately rather than
      // waiting for the next seek or play.
      if (this.player.getState() !== "playing") {
        void this.frameSampler?.captureNow();
      }
    });
    this.analysisControls.onToggleAnalysis(() => this.toggleAnalysis());

    this.trackingControls.onSettingsChange((partial) => {
      this.state.blobTracker.updateSettings(partial);
    });
    this.trackingControls.onDebugViewToggle((enabled) => {
      this.renderer.setDebugMode(enabled);
    });

    this.timeline.onScrub((seconds) => this.player.seekToSeconds(seconds));

    this.trackPanel.onSelectTrack((trackId) => this.selectTrack(trackId));

    this.annotationPanel.onTextChange((id, text) => {
      this.state.annotationManager.setText(id, text);
    });
    this.annotationPanel.onOffsetChange((id, offsetX, offsetY) => {
      this.state.annotationManager.setOffset(id, offsetX, offsetY);
    });

    this.resetButton.addEventListener("click", () => this.resetToStart());
  }

  private wireDataListeners(): void {
    this.state.trackManager.onChange((tracks) => {
      this.trackPanel.render(tracks);
      this.timeline.renderTracks(tracks, this.frameRate);

      if (this.state.selectedTrackId !== null) {
        this.inspector.show(
          this.state.trackManager.getTrack(this.state.selectedTrackId),
          this.frameRate,
        );
      }
    });

    // Edits made from AnnotationPanel don't come through a frame result
    // or the rAF loop while paused, so a text/offset change needs its
    // own render trigger to appear immediately.
    this.state.annotationManager.onChange(() => this.renderer.renderOnce());

    // A track disappearing out from under a live selection (folded into
    // another one by reidentification/duplicate-merging) shouldn't drop
    // the selection — move it, and any label, onto the surviving track.
    this.state.trackManager.onMerge((keptId, droppedId) => {
      this.state.annotationManager.retargetTrack(droppedId, keptId);
      if (this.state.selectedTrackId === droppedId) this.selectTrack(keptId);
    });
  }

  /**
   * Single entry point for track selection, regardless of whether it
   * came from clicking a blob in the video or a row in the track
   * panel — keeps AppState, the track panel's highlight/scroll, the
   * inspector, and the video overlay's dim/highlight all in sync.
   */
  private selectTrack(trackId: number | null): void {
    this.state.selectedTrackId = trackId;
    this.trackPanel.selectTrack(trackId);
    this.renderer.setSelectedTrack(trackId);

    const track = trackId !== null ? this.state.trackManager.getTrack(trackId) : undefined;
    this.inspector.show(track, this.frameRate);

    if (trackId !== null && track) {
      const point = latestPoint(track);
      const defaultOffsetY = point ? -(point.height / 2 + 0.03) : -0.08;
      const annotation = this.state.annotationManager.getOrCreateForTrack(trackId, {
        offsetX: 0,
        offsetY: defaultOffsetY,
      });
      this.annotationPanel.show(trackId, annotation);

      this.analysisControls.setOpen(false);
      this.trackingControls.setOpen(false);
      this.trackPanel.setOpen(true);
      this.annotationPanel.setOpen(true);
      this.inspector.setOpen(true);
    } else {
      this.annotationPanel.hide();
    }
  }

  private handleTrackingCanvasClick(event: MouseEvent): void {
    const rect = this.trackingCanvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const nx = (event.clientX - rect.left) / rect.width;
    const ny = (event.clientY - rect.top) / rect.height;

    const frame = this.renderer.currentFrameIndex();
    const hit = hitTestTracks(
      this.state.trackManager.getAllTracks(),
      frame,
      nx,
      ny,
    );
    this.selectTrack(hit ? hit.id : null);
  }

  private toggleAnalysis(): void {
    if (this.state.analysisWorkerClient.isRunning()) {
      this.state.analysisWorkerClient.stop();
      this.frameSampler?.stop();
      this.analysisControls.setAnalysisLabel("Start Analysis");
    } else {
      this.state.analysisWorkerClient.start(
        this.state.analysisEngine.getSettings(),
      );
      if (this.player.getState() === "playing") this.frameSampler?.start();
      this.analysisControls.setAnalysisLabel("Stop Analysis");
    }
  }

  /**
   * Drops the current video and all derived state (tracks, labels,
   * selection) and returns to the upload screen, so a new file can
   * replace it. Nothing here persists across a page refresh either —
   * this just makes that same "start over" possible without one.
   */
  private resetToStart(): void {
    this.player.pause();
    this.player.unload();
    this.frameSampler?.stop();
    this.frameSampler = null;
    this.state.analysisWorkerClient.stop();
    this.state.reset();
    this.selectTrack(null);

    this.stageEl.classList.add("is-empty");
    this.stageEl.style.aspectRatio = "";
    this.uploadPanel.element.classList.remove("is-collapsed");
    this.uploadPanel.clearError();
    this.metadataPanel.hide();
    this.timeline.hide();
    this.analysisControls.setAnalysisEnabled(false);
    this.analysisControls.setAnalysisLabel("Start Analysis");
  }

  private async loadVideo(file: File): Promise<void> {
    try {
      const metadata = await this.player.load(file);

      this.frameRate = metadata.frameRate;

      const { width: analysisWidth, height: analysisHeight } =
        fitWithinPreservingAspect(
          metadata.width,
          metadata.height,
          ANALYSIS_RESOLUTION_BUDGET.width,
          ANALYSIS_RESOLUTION_BUDGET.height,
        );
      this.state.analysisEngine.updateSettings({
        analysisWidth,
        analysisHeight,
      });
      const settings = this.state.analysisEngine.getSettings();
      this.frameSampler?.stop();
      this.frameSampler = new FrameSampler(this.videoEl);
      this.frameSampler.configure(settings.sampleFps, this.frameRate);
      this.frameSampler.onFrame((frame, frameNumber, timestamp) => {
        this.state.analysisWorkerClient.submitFrame(
          frame,
          frameNumber,
          timestamp,
        );
      });

      // Canvases fill the stage at 100%/100%, so the stage box must match
      // the video's own aspect ratio or their pixel-accurate buffers (set
      // below) get stretched to whatever shape a fixed-aspect box imposes.
      this.stageEl.style.aspectRatio = `${metadata.width} / ${metadata.height}`;
      this.renderer.resizeToVideo(metadata.width, metadata.height);
      this.timeline.setDuration(metadata.durationSeconds);
      this.metadataPanel.show(metadata);

      this.state.reset();
      this.selectTrack(null);
      this.stageEl.classList.remove("is-empty");
      this.uploadPanel.element.classList.add("is-collapsed");
      this.uploadPanel.clearError();

      this.analysisControls.setAnalysisEnabled(true);
      this.state.analysisWorkerClient.start(settings);
      this.analysisControls.setAnalysisLabel("Stop Analysis");

      this.renderer.renderOnce();
    } catch (error) {
      this.frameSampler?.stop();
      this.frameSampler = null;
      this.state.analysisWorkerClient.stop();
      this.analysisControls.setAnalysisEnabled(false);
      this.metadataPanel.hide();
      this.timeline.hide();
      this.stageEl.classList.add("is-empty");
      this.uploadPanel.element.classList.remove("is-collapsed");
      this.uploadPanel.showError(
        error instanceof Error ? error.message : "Failed to load video.",
      );
    }
  }

  /**
   * JKL-style transport shortcuts: space/K toggles play-pause, L
   * plays forward. Ignored while a video isn't loaded yet, or while
   * the user is typing into a form control (so spacebar still works
   * normally inside sliders/inputs). (J/backward is disabled — not
   * needed currently.)
   */
  private wireKeyboard(): void {
    window.addEventListener("keydown", (event) => {
      const state = this.player.getState();
      if (state === "empty" || state === "loading") return;
      if (this.isTypingTarget(event.target)) return;

      switch (event.key.toLowerCase()) {
        case " ":
        case "k":
          event.preventDefault();
          this.player.togglePlayback();
          break;
        case "l":
          event.preventDefault();
          this.player.play();
          break;
        // case "j":
        //     event.preventDefault();
        //     this.player.playBackward();
        //     break;
      }
    });
  }

  private isTypingTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    return (
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable
    );
  }
}
