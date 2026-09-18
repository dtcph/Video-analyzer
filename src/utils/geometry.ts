export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export function rectArea(rect: Rect): number {
    return rect.width * rect.height;
}

export function rectCenter(rect: Rect): { x: number; y: number } {
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

export function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
}
