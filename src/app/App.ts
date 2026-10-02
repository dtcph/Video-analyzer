import { checkMediaFile } from "../input/MediaFiles";
import type { MediaKind } from "../input/MediaFiles";
import { VideoPlayer } from "../input/VideoPlayer";
import { OverlayRenderer } from "../rendering/OverlayRenderer";
import { SettingsStore } from "../settings/SettingsStore";
import { PlaybackControls } from "../ui/PlaybackControls";
import { SettingsPanel } from "../ui/SettingsPanel";
import { UploadPanel } from "../ui/UploadPanel";
import type { Size } from "../utils/geometry";

/**
 * Top-level wiring: builds the DOM shell, owns the services and connects
 * UI events to them. The only module that knows about all the pieces.
 *
 * Phase 0 scope: media upload and display, video playback, the generated
 * settings panel and an empty overlay. Inference, tracking and counting
 * are added from Phase 1 on.
 */
export class App {
    private readonly settings = new SettingsStore();
    private readonly uploadPanel = new UploadPanel((file) =>
        checkMediaFile(file, (type) => this.videoEl.canPlayType(type))
    );
    private readonly playbackControls = new PlaybackControls();
    private readonly settingsPanel = new SettingsPanel(this.settings);

    private stageEl!: HTMLElement;
    private videoEl!: HTMLVideoElement;
    private imageEl!: HTMLImageElement;
    private player!: VideoPlayer;
    private overlay!: OverlayRenderer;

    private mediaKind: MediaKind | null = null;
    private imageUrl: string | null = null;

    constructor(private readonly root: HTMLElement) {
        this.buildLayout();
        this.wireMedia();
        this.wireKeyboard();
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

        const counts = document.createElement("section");
        counts.className = "panel counts-panel";
        counts.innerHTML = `
            <h2 class="panel-title">Total</h2>
            <p class="panel-empty">Load an image or video to start counting.</p>
        `;

        const sidebar = document.createElement("aside");
        sidebar.className = "app-sidebar";
        sidebar.append(counts, this.settingsPanel.element);

        const layout = document.createElement("div");
        layout.className = "app-layout";
        layout.append(main, sidebar);

        const footer = document.createElement("footer");
        footer.className = "app-footer";
        footer.innerHTML = `
            Runs entirely in your browser. Free software under the
            <a href="https://www.gnu.org/licenses/agpl-3.0.html" rel="noopener">GNU AGPL-3.0</a>.
        `;

        this.root.replaceChildren(header, layout, footer);
    }

    private wireMedia(): void {
        this.player = new VideoPlayer(this.videoEl);
        this.overlay = new OverlayRenderer(this.stageEl.querySelector(".media-overlay") as HTMLCanvasElement, {
            mediaSize: () => this.mediaSize(),
            timeSeconds: () => (this.mediaKind === "video" ? this.player.getCurrentSeconds() : 0)
        });

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

    private wireKeyboard(): void {
        window.addEventListener("keydown", (event) => {
            if (event.code !== "Space" || this.mediaKind !== "video") return;
            const target = event.target as HTMLElement | null;
            if (target && target.closest("input, select, textarea, button, [role='button']")) return;
            event.preventDefault();
            this.player.togglePlayback();
        });
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
            } else {
                this.imageUrl = URL.createObjectURL(file);
                this.imageEl.src = this.imageUrl;
                await this.imageEl.decode();
            }
            this.overlay.renderOnce();
        } catch (error) {
            this.unloadMedia();
            this.uploadPanel.showError(
                kind === "image"
                    ? `Could not decode image: ${file.name}.`
                    : error instanceof Error
                      ? error.message
                      : String(error)
            );
        }
    }

    private unloadMedia(): void {
        this.player.unload();
        this.playbackControls.hide();
        if (this.imageUrl) {
            URL.revokeObjectURL(this.imageUrl);
            this.imageUrl = null;
        }
        this.imageEl.removeAttribute("src");
        this.mediaKind = null;
        this.stageEl.hidden = true;
        this.overlay.renderOnce();
    }

    private mediaSize(): Size | null {
        if (this.mediaKind === "video" && this.videoEl.videoWidth > 0) {
            return { width: this.videoEl.videoWidth, height: this.videoEl.videoHeight };
        }
        if (this.mediaKind === "image" && this.imageEl.naturalWidth > 0) {
            return { width: this.imageEl.naturalWidth, height: this.imageEl.naturalHeight };
        }
        return null;
    }
}
