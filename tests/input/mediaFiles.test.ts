import { describe, expect, it } from "vitest";
import { MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, checkMediaFile } from "../../src/input/MediaFiles";

const playsEverything = () => "maybe";
const playsNothing = () => "";

describe("checkMediaFile", () => {
    it("accepts images and playable videos", () => {
        expect(checkMediaFile({ type: "image/jpeg", size: 1000 }, playsNothing)).toEqual({ ok: true, kind: "image" });
        expect(checkMediaFile({ type: "video/mp4", size: 1000 }, playsEverything)).toEqual({ ok: true, kind: "video" });
    });

    it("rejects unknown, unsupported and unplayable types", () => {
        expect(checkMediaFile({ type: "", size: 1 }, playsEverything).ok).toBe(false);
        expect(checkMediaFile({ type: "application/pdf", size: 1 }, playsEverything).ok).toBe(false);
        expect(checkMediaFile({ type: "video/x-matroska", size: 1 }, playsNothing)).toEqual({
            ok: false,
            error: "This browser cannot play video/x-matroska files. Try an MP4 or WebM file."
        });
    });

    it("rejects oversized files and names the limit", () => {
        const video = checkMediaFile({ type: "video/mp4", size: MAX_VIDEO_BYTES + 1 }, playsEverything);
        expect(video.ok).toBe(false);
        if (!video.ok) expect(video.error).toContain("500.0 MB");

        expect(checkMediaFile({ type: "video/mp4", size: MAX_VIDEO_BYTES }, playsEverything).ok).toBe(true);
        expect(checkMediaFile({ type: "image/png", size: MAX_IMAGE_BYTES + 1 }, playsEverything).ok).toBe(false);
    });
});
