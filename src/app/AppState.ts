import { AnalysisEngine } from "../analysis/AnalysisEngine";
import { AnalysisWorkerClient } from "../analysis/AnalysisWorkerClient";
import { BlobTracker } from "../analysis/BlobTracker";
import { AnnotationManager } from "../annotations/AnnotationManager";
import { TrackManager } from "../tracking/TrackManager";
import { SettingsStore } from "../settings/SettingsStore";

/**
 * Holds the non-visual application state and cross-cutting services
 * shared across UI panels and the renderer. Instantiated once by App.
 * analysisEngine here only holds shared settings; the frame-by-frame
 * analysis itself runs inside AnalysisWorkerClient's worker.
 * settingsStore is the source of the current mode + detection settings;
 * App forwards every change to analysisEngine and the worker.
 */
export class AppState {
    readonly settingsStore = new SettingsStore();
    readonly analysisEngine = new AnalysisEngine();
    readonly analysisWorkerClient = new AnalysisWorkerClient();
    readonly trackManager = new TrackManager();
    readonly annotationManager = new AnnotationManager();
    readonly blobTracker = new BlobTracker(this.trackManager);

    selectedTrackId: number | null = null;

    constructor() {
        this.analysisEngine.updateSettings(this.settingsStore.getSettings());
    }

    reset(): void {
        this.trackManager.reset();
        this.annotationManager.reset();
        this.blobTracker.reset();
        this.selectedTrackId = null;
    }
}
