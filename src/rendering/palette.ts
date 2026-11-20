/**
 * The design's colors. The accent colors are mirrored as CSS tokens in
 * src/styles/tokens.css (a test keeps both in step); the canvas overlay and the
 * treemap read them from here.
 */

/** The accent colors (about 10% of what is on screen). */
export const ACCENTS = {
    yellow: "#EAF205",
    green: "#3BF27A",
    turquoise: "#04D9C4",
    blue: "#2F7BF2",
    violet: "#8344EF",
    pink: "#F050F2",
    red: "#F22F1D",
    orange: "#F29829"
} as const;

export type AccentName = keyof typeof ACCENTS;

/** Around the color wheel: yellow into green, turquoise, blue, violet, pink, then red and orange back to yellow. */
export const ACCENT_CYCLE: readonly AccentName[] = [
    "yellow",
    "green",
    "turquoise",
    "blue",
    "violet",
    "pink",
    "red",
    "orange"
];

/** The off-black ground (about 60%) and the off-white of text (about 30%, with the grays). */
export const INK = "#0B0B0D";
export const PAPER = "#F1EFEA";

function channels(hex: string): [number, number, number] {
    const value = Number.parseInt(hex.slice(1), 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function toHex([r, g, b]: readonly number[]): string {
    return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

/** `a` moved `amount` (0..1) of the way to `b`, in sRGB. */
export function mixHex(a: string, b: string, amount: number): string {
    const [ar, ag, ab] = channels(a);
    const [br, bg, bb] = channels(b);
    return toHex([ar + (br - ar) * amount, ag + (bg - ag) * amount, ab + (bb - ab) * amount]);
}

/** WCAG relative luminance. */
export function luminance(hex: string): number {
    const [r, g, b] = channels(hex).map((c) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
    const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (light + 0.05) / (dark + 0.05);
}

/** Off-black or off-white, whichever reads better on `background`. */
export function readableTextColor(background: string): string {
    return contrastRatio(background, INK) >= contrastRatio(background, PAPER) ? INK : PAPER;
}
