/**
 * Font Awesome Free (solid) as inline SVG: only the icons listed here end up in the bundle, no web font, no CDN.
 * Markup: <span class="icon" data-icon="image" aria-hidden="true"></span>, next to (never around) the translated text.
 */
import {
  faArrowLeft, faArrowRotateLeft, faBackward, faCamera, faCameraRotate, faForward, faGear, faImage, faPause, faPlay,
  faVideo,
} from "@fortawesome/free-solid-svg-icons";

const ICONS = {
  "arrow-left": faArrowLeft, "arrow-rotate-left": faArrowRotateLeft, backward: faBackward, camera: faCamera,
  "camera-rotate": faCameraRotate, forward: faForward, gear: faGear, image: faImage, pause: faPause, play: faPlay,
  video: faVideo,
};
export type IconName = keyof typeof ICONS;

export function setIcon(e: HTMLElement, name: IconName): void {
  const [width, height, , , path] = ICONS[name].icon;
  e.dataset.icon = name;
  e.innerHTML = `<svg viewBox="0 0 ${width} ${height}" fill="currentColor" focusable="false"><path d="${String(path)}"/></svg>`;
}

/** Fills every element marked with data-icon. */
export const applyIcons = (): void => document.querySelectorAll<HTMLElement>("[data-icon]").forEach((e) => setIcon(e, e.dataset.icon as IconName));
