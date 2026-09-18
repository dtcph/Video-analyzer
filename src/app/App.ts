import { AppState } from "./AppState";
import { VideoPlayer } from "../video/VideoPlayer";
import { FrameExtractor } from "../video/FrameExtractor";
import { VideoRenderer } from "../rendering/VideoRenderer";
import { UploadPanel } from "../ui/UploadPanel";
import { Timeline } from "../ui/Timeline";
import { AnalysisControls } from "../ui/AnalysisControls";
import { TrackPanel } from "../ui/TrackPanel";
import { Inspector } from "../ui/Inspector";
import { MetadataPanel } from "../ui/MetadataPanel";

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
    private frameExtractor: FrameExtractor | null = null;

    private uploadPanel = new UploadPanel();
    private metadataPanel = new MetadataPanel();
    private timeline = new Timeline();
    private analysisControls = new AnalysisControls();
    private trackPanel = new TrackPanel();
    private inspector = new Inspector();

    private stageEl!: HTMLElement;
    private videoEl!: HTMLVideoElement;

    constructor(private readonly root: HTMLElement) {
        this.buildLayout();
        this.wirePlayer();
        this.wireUi();
        this.wireDataListeners();
    }

    private buildLayout(): void {
        this.root.innerHTML = "";

        const header = document.createElement("header");
        header.className = "app-header";
        header.innerHTML = `<h1 class="app-title">Blob Analyzer</h1>
            <p class="app-subtitle">Video as data: blob detection, tracking, and exposure analysis</p>`;

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
        sidebar.appendChild(this.trackPanel.element);
        sidebar.appendChild(this.inspector.element);

        const main = document.createElement("main");
        main.className = "app-main";
        main.appendChild(this.uploadPanel.element);
        main.appendChild(stage);
        main.appendChild(this.metadataPanel.element);
        main.appendChild(this.analysisControls.element);
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

        const analysisCanvas = this.stageEl.querySelector("#analysis-layer") as HTMLCanvasElement;
        const trackingCanvas = this.stageEl.querySelector("#tracking-layer") as HTMLCanvasElement;
        const annotationCanvas = this.stageEl.querySelector("#annotation-layer") as HTMLCanvasElement;

        this.renderer = new VideoRenderer(
            this.player,
            analysisCanvas,
            trackingCanvas,
            annotationCanvas,
            this.state.trackManager,
            this.state.annotationManager,
            this.frameRate
        );

        this.player.onStateChange((playbackState) => {
            this.analysisControls.setPlaybackEnabled(playbackState !== "empty" && playbackState !== "loading");
            this.analysisControls.setPlaybackLabel(playbackState === "playing" ? "Pause" : "Play");
        });

        this.videoEl.addEventListener("timeupdate", () => {
            this.timeline.setCurrentTime(this.player.getCurrentSeconds());
            this.analyzeCurrentFrame();
        });
    }

    private analyzeCurrentFrame(): void {
        if (!this.frameExtractor) return;

        const frame = Math.round(this.player.getCurrentSeconds() * this.frameRate);
        const { imageData } = this.frameExtractor.extract(this.videoEl, {
            frameIndex: frame,
            timestampSeconds: this.player.getCurrentSeconds()
        });

        const result = this.state.analysisEngine.analyzeFrame(frame, imageData);
        this.state.blobTracker.update(frame, result.blobs);
        this.renderer.setLatestFrameResult(result);
    }

    private wireUi(): void {
        this.uploadPanel.onSelect((file) => void this.loadVideo(file));

        this.analysisControls.onTogglePlayback(() => this.player.togglePlayback());
        this.analysisControls.onToggleLayer((layer, enabled) => {
            this.renderer.setLayerVisibility({ [layer]: enabled });
        });

        this.timeline.onScrub((seconds) => this.player.seekToSeconds(seconds));

        this.trackPanel.onSelectTrack((trackId) => {
            this.state.selectedTrackId = trackId;
            this.inspector.show(this.state.trackManager.getTrack(trackId), this.frameRate);
        });
    }

    private wireDataListeners(): void {
        this.state.trackManager.onChange((tracks) => {
            this.trackPanel.render(tracks);
            this.timeline.renderTracks(tracks, this.frameRate);

            if (this.state.selectedTrackId !== null) {
                this.inspector.show(this.state.trackManager.getTrack(this.state.selectedTrackId), this.frameRate);
            }
        });
    }

    private async loadVideo(file: File): Promise<void> {
        try {
            const metadata = await this.player.load(file);

            this.frameRate = metadata.frameRate;
            this.frameExtractor = new FrameExtractor(metadata.width, metadata.height);

            this.renderer.resizeToVideo(metadata.width, metadata.height);
            this.timeline.setDuration(metadata.durationSeconds);
            this.metadataPanel.show(metadata);

            this.state.reset();
            this.stageEl.classList.remove("is-empty");
            this.uploadPanel.element.classList.add("is-collapsed");
            this.uploadPanel.clearError();

            this.renderer.renderOnce();
        } catch (error) {
            this.frameExtractor = null;
            this.metadataPanel.hide();
            this.stageEl.classList.add("is-empty");
            this.uploadPanel.element.classList.remove("is-collapsed");
            this.uploadPanel.showError(error instanceof Error ? error.message : "Failed to load video.");
        }
    }
}
