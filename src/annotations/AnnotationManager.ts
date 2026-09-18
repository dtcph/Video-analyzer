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

    getForTrack(trackId: number): TextAnnotation[] {
        return this.getAll().filter((annotation) => annotation.trackId === trackId);
    }

    getAll(): TextAnnotation[] {
        return Array.from(this.annotations.values());
    }
}
