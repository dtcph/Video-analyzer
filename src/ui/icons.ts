/** The icon set (line icons on a 24 × 24 grid): every button is an icon, labeled by its aria-label and tooltip. */
const PATHS = {
    close: `<path d="M6 6l12 12M18 6L6 18" />`,
    photo: `<rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="M4 17l5-5 4 4 3-3 4 4" />`,
    camera: `<path d="M4 8h3l2-2.5h6L17 8h3v11H4z" /><circle cx="12" cy="13.5" r="3.5" />`,
    gear: `<circle cx="12" cy="12" r="3" /><circle cx="12" cy="12" r="7" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" />`,
    play: `<path d="M8 5.5v13l10.5-6.5z" />`,
    pause: `<path d="M8.5 5.5v13M15.5 5.5v13" />`,
    stop: `<rect x="6" y="6" width="12" height="12" rx="2" />`,
    reset: `<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1M3.5 4v5h5" />`,
    back: `<path d="M19 12H5M11 6l-6 6 6 6" />`,
    chart: `<rect x="3" y="4" width="18" height="16" rx="2" /><path d="M12 4v16M12 11h9M3 13h9" />`,
    down: `<path d="M6 9l6 6 6-6" />`
} as const;

export type IconName = keyof typeof PATHS;

/** The icon as inline SVG, drawn in the current text color; decorative (the button carries the name). */
export function iconSvg(name: IconName, size = 22): string {
    return `<svg class="icon" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${PATHS[name]}</svg>`;
}
