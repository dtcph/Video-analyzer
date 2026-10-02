import { formatFileSize } from "../utils/format";

export type MediaKind = "image" | "video";

/** Upload limits from the product brief: 1080p video up to ~500 MB. */
export const MAX_VIDEO_BYTES = 500 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 50 * 1024 * 1024;

export type MediaFileCheck = { ok: true; kind: MediaKind } | { ok: false; error: string };

/**
 * Pre-flight check of an uploaded file. A definite "no" (unknown type,
 * a type the browser reports as unplayable, or a file over the size
 * limit) is rejected before any loading; anything else is left to the
 * actual <video>/<img> element, which is the real source of truth.
 *
 * `canPlayVideoType` is HTMLMediaElement.canPlayType, injected so this
 * stays testable without a DOM.
 */
export function checkMediaFile(
    file: Pick<File, "type" | "size">,
    canPlayVideoType: (mimeType: string) => string
): MediaFileCheck {
    if (!file.type) return { ok: false, error: "Could not determine the file type. Use an image, MP4 or WebM file." };

    if (file.type.startsWith("image/")) {
        if (file.size > MAX_IMAGE_BYTES) return { ok: false, error: tooLarge("Image", file.size, MAX_IMAGE_BYTES) };
        return { ok: true, kind: "image" };
    }

    if (file.type.startsWith("video/")) {
        if (canPlayVideoType(file.type) === "") {
            return { ok: false, error: `This browser cannot play ${file.type} files. Try an MP4 or WebM file.` };
        }
        if (file.size > MAX_VIDEO_BYTES) return { ok: false, error: tooLarge("Video", file.size, MAX_VIDEO_BYTES) };
        return { ok: true, kind: "video" };
    }

    return { ok: false, error: `Unsupported file type: ${file.type}. Use an image, MP4 or WebM file.` };
}

function tooLarge(what: string, size: number, limit: number): string {
    return `${what} is ${formatFileSize(size)}; the limit is ${formatFileSize(limit)}.`;
}
