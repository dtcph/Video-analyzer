import { AnalysisEngine } from "../analysis/AnalysisEngine";
import { AnalysisWorkerClient } from "../analysis/AnalysisWorkerClient";
import { BlobTracker } from "../analysis/BlobTracker";
import { AnnotationManager } from "../annotations/AnnotationManager";
import { TrackManager } from "../tracking/TrackManager";

/**
 * Holds the non-visual application state and cross-cutting services
 * shared across UI panels and the renderer. Instantiated once by App.
 * analysisEngine here only holds shared settings; the frame-by-frame
 * analysis itself runs inside AnalysisWorkerClient's worker.
 */
export class AppState {
    readonly analysisEngine = new AnalysisEngine();
    readonly analysisWorkerClient = new AnalysisWorkerClient();
    readonly trackManager = new TrackManager();
    readonly annotationManager = new AnnotationManager();
    readonly blobTracker = new BlobTracker(this.trackManager);

    selectedTrackId: number | null = null;

    reset(): void {
        this.trackManager.reset();
        this.annotationManager.reset();
        this.blobTracker.reset();
        this.selectedTrackId = null;
    }
}
