export interface TextAnnotation {
    id: string;

    text: string;

    trackId: number;

    offsetX: number;
    offsetY: number;

    visible: boolean;
}
