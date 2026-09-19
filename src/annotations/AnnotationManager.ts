import type { TextAnnotation } from "./AnnotationTypes";

export type AnnotationManagerListener = (annotations: TextAnnotation[]) => void;

export class AnnotationManager {
    private annotations: Map<string, TextAnnotation> = new Map();
    private listeners: Set<AnnotationManagerListener> = new Set();

    onChange(listener: AnnotationManagerListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private emit(): void {
        const snapshot = this.getAll();
        for (const listener of this.listeners) listener(snapshot);
    }

    add(annotation: TextAnnotation): void {
        this.annotations.set(annotation.id, annotation);
        this.emit();
    }

    remove(id: string): void {
        this.annotations.delete(id);
        this.emit();
    }

    setVisible(id: string, visible: boolean): void {
        const annotation = this.annotations.get(id);
        if (!annotation) return;
        annotation.visible = visible;
        this.emit();
    }

    setText(id: string, text: string): void {
        const annotation = this.annotations.get(id);
        if (!annotation) return;
        annotation.text = text;
        this.emit();
    }

    setOffset(id: string, offsetX: number, offsetY: number): void {
        const annotation = this.annotations.get(id);
        if (!annotation) return;
        annotation.offsetX = offsetX;
        annotation.offsetY = offsetY;
        this.emit();
    }

    getForTrack(trackId: number): TextAnnotation[] {
        return this.getAll().filter((annotation) => annotation.trackId === trackId);
    }

    /**
     * Returns the single label attached to a track, creating an empty
     * one at `defaultOffset` on first selection. There is one label
     * per track — the UI only ever exposes one at a time.
     */
    getOrCreateForTrack(trackId: number, defaultOffset: { offsetX: number; offsetY: number }): TextAnnotation {
        const existing = this.getForTrack(trackId)[0];
        if (existing) return existing;

        const annotation: TextAnnotation = {
            id: `annotation-${trackId}`,
            text: "",
            trackId,
            offsetX: defaultOffset.offsetX,
            offsetY: defaultOffset.offsetY,
            visible: true
        };
        this.annotations.set(annotation.id, annotation);
        this.emit();
        return annotation;
    }

    /**
     * Moves any label on `fromTrackId` onto `toTrackId` — called when
     * TrackManager folds one track into another (reidentification
     * landing on top of a track that was never actually lost, or two
     * duplicate active tracks getting unified). If the surviving track
     * already has a label with text, that one wins — it's the more
     * established id — and the merged-away label is dropped; otherwise
     * the merged-away label's text/offset carry over under the
     * surviving id, so a label a user already typed doesn't just vanish
     * because its track id changed underneath it.
     */
    retargetTrack(fromTrackId: number, toTrackId: number): void {
        const from = this.getForTrack(fromTrackId)[0];
        if (!from) return;

        const to = this.getForTrack(toTrackId)[0];
        this.annotations.delete(from.id);

        if (to && to.text) {
            this.emit();
            return;
        }

        if (to) this.annotations.delete(to.id);
        const merged: TextAnnotation = { ...from, id: `annotation-${toTrackId}`, trackId: toTrackId };
        this.annotations.set(merged.id, merged);
        this.emit();
    }

    getAll(): TextAnnotation[] {
        return Array.from(this.annotations.values());
    }

    reset(): void {
        this.annotations.clear();
        this.emit();
    }
}
