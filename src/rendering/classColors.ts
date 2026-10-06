/**
 * One fixed color per COCO class, so a class looks the same in every frame,
 * panel and session. Hues step by the golden angle, which keeps neighboring
 * class ids far apart on the color wheel; lightness is high enough for black
 * label text.
 */
export function classColor(classId: number): string {
    return `hsl(${Math.round((classId * 137.508) % 360)} 85% 58%)`;
}

export const LABEL_TEXT_COLOR = "#000";
