/**
 * Decodes a video file into RGBA frames at a fixed sample rate and
 * resolution via the ffmpeg CLI — the headless stand-in for the browser's
 * FrameSampler (requestVideoFrameCallback capture) + AnalysisWorker
 * (OffscreenCanvas drawImage downscale).
 *
 * Known differences from the browser path, deliberately accepted:
 * - Sampling: ffmpeg's `fps` filter picks the source frame nearest each
 *   1/sampleFps tick; FrameSampler takes the first decoded frame at least
 *   1/sampleFps after the previous sample during real-time playback. Same
 *   rate, occasionally a one-source-frame different choice.
 * - Every sample is processed in order. Realtime mode in the app drops a
 *   sample when the worker is still busy, so on a slow machine the app sees
 *   fewer, more widely-spaced frames than this harness does.
 * - Scaling uses bilinear filtering to approximate Chrome's default
 *   (imageSmoothingQuality "low") drawImage downscale; YUV->RGB conversion
 *   may differ by a few code values.
 */
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface VideoInfo {
    width: number;
    height: number;
    /** Source frame rate in frames per second. */
    fps: number;
    durationSeconds: number;
    codec: string;
}

export async function probeVideo(path: string): Promise<VideoInfo> {
    const { stdout } = await execFileAsync("ffprobe", [
        "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=width,height,r_frame_rate,codec_name:format=duration",
        "-of", "json",
        path
    ]);
    const parsed = JSON.parse(stdout) as {
        streams: { width: number; height: number; r_frame_rate: string; codec_name: string }[];
        format: { duration: string };
    };
    const stream = parsed.streams[0];
    if (!stream) throw new Error(`ffprobe: no video stream in ${path}`);
    const [num, den] = stream.r_frame_rate.split("/").map(Number);
    return {
        width: stream.width,
        height: stream.height,
        fps: den ? num / den : num,
        durationSeconds: Number(parsed.format.duration),
        codec: stream.codec_name
    };
}

export interface RgbaFrame {
    index: number;
    data: Uint8ClampedArray;
    width: number;
    height: number;
}

/**
 * Yields every sampled frame in order. Backpressure is natural: the
 * consumer's `await` between iterations pauses reading ffmpeg's stdout.
 */
export async function* decodeFrames(
    path: string,
    width: number,
    height: number,
    sampleFps: number,
    maxFrames = Infinity
): AsyncGenerator<RgbaFrame> {
    const args = [
        "-v", "error",
        "-i", path,
        "-an",
        "-vf", `fps=${sampleFps},scale=${width}:${height}:flags=bilinear`,
        "-f", "rawvideo",
        "-pix_fmt", "rgba",
        "pipe:1"
    ];
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    const exited = new Promise<number | null>((resolve) => proc.on("close", resolve));

    const frameBytes = width * height * 4;
    let pending: Buffer = Buffer.alloc(0);
    let index = 0;

    try {
        for await (const chunk of proc.stdout as AsyncIterable<Buffer>) {
            pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
            while (pending.length >= frameBytes) {
                // Copy out: the analyzer may hold on to nothing, but the
                // underlying Buffer pool is reused by Node between chunks.
                const data = new Uint8ClampedArray(frameBytes);
                data.set(pending.subarray(0, frameBytes));
                pending = pending.subarray(frameBytes);
                yield { index, data, width, height };
                index++;
                if (index >= maxFrames) return;
            }
        }
        const code = await exited;
        if (code !== 0) throw new Error(`ffmpeg exited with ${code}: ${stderr.trim()}`);
    } finally {
        if (proc.exitCode === null) proc.kill("SIGKILL");
    }
}
