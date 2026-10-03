import type { CapturedFrame } from "./MediaTypes";

/**
 * The frame a <video> currently shows (file or camera stream), as a WebCodecs
 * VideoFrame, created synchronously: call it inside a requestVideoFrameCallback
 * to get exactly the frame with that media time.
 *
 * Throws ("Invalid source state") while no frame has been presented yet,
 * e.g. right after loading or seeking a paused video; use
 * captureDisplayedVideoFrame for that case.
 */
export function captureVideoFrame(video: HTMLVideoElement, mediaTime: number): Promise<CapturedFrame> {
    try {
        return Promise.resolve(new VideoFrame(video, { timestamp: Math.round(mediaTime * 1_000_000) }));
    } catch (error) {
        return Promise.reject(error);
    }
}

/**
 * The paused frame on screen. Chrome only has a capturable frame once it
 * has been presented (measured: even at readyState 4 right after loading,
 * both VideoFrame and createImageBitmap fail), so on failure this waits
 * for the next presented frame (requestVideoFrameCallback also fires for a
 * paused video after load or seek) and retries.
 */
export async function captureDisplayedVideoFrame(video: HTMLVideoElement, attempts = 3): Promise<CapturedFrame> {
    for (let attempt = 1; ; attempt++) {
        try {
            return await captureVideoFrame(video, video.currentTime);
        } catch (error) {
            if (attempt >= attempts) throw error;
            await nextPresentedFrame(video, 1000);
        }
    }
}

function nextPresentedFrame(video: HTMLVideoElement, timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            video.cancelVideoFrameCallback(handle);
            resolve();
        }, timeoutMs);
        const handle = video.requestVideoFrameCallback(() => {
            clearTimeout(timer);
            resolve();
        });
    });
}
