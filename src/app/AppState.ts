import { AnalysisEngine } from "../analysis/AnalysisEngine";
import { BlobTracker } from "../analysis/BlobTracker";
import { AnnotationManager } from "../annotations/AnnotationManager";
import { TrackManager } from "../tracking/TrackManager";

/**
 * Holds the non-visual application state and cross-cutting services
 * shared across UI panels and the renderer. Instantiated once by App.
 */
export class AppState {
    readonly analysisEngine = new AnalysisEngine();
    readonly trackManager = new TrackManager();
    readonly annotationManager = new AnnotationManager();
    readonly blobTracker = new BlobTracker(this.trackManager);

    selectedTrackId: number | null = null;

    reset(): void {
        this.trackManager.reset();
        this.selectedTrackId = null;
    }
}
