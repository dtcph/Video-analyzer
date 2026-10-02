/**
 * Renders a contact sheet of a clip with one evaluation run's accepted blob
 * boxes (red) drawn on top, plus — where the frame is hand-labeled
 * (scripts/eval/labels/) — movers (green), ignore regions (blue) and the
 * scored region of interest (white). A visual check of what the numbers
 * from scripts/evaluateClips.ts correspond to, and a way to review labels.
 *
 *   npm run overlay -- docs/v2/results/latest/moving_car__v1-default.json 1,5,9,14 out.jpg
 *   npm run overlay -- docs/v2/results/latest/moving_car__v1-default.json labels out.jpg
 *
 * Times are seconds (nearest analyzed sample is used); `labels` renders
 * every labeled keyframe instead. Panels go left-to-right, top-to-bottom,
 * 2 columns for up to 4 panels, 3 otherwise. Needs the clip in test-vid/.
 * Uses ffmpeg's drawbox only (drawtext needs an ffmpeg built with libfreetype).
 */
import { execFile } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import type { Box, FrameRecord, LabelFile, LabelFrame } from "./eval/metrics.ts";

const run = promisify(execFile);

interface RunFile {
    clip: string;
    analysis: { width: number; height: number; sampleFps: number };
    frames: FrameRecord[];
}

async function loadLabels(clip: string): Promise<LabelFile | null> {
    try {
        return JSON.parse(await readFile(join("scripts/eval/labels", clip.replace(/\.[^.]+$/, ".json")), "utf8")) as LabelFile;
    } catch {
        return null;
    }
}

function drawboxes(boxes: readonly Box[], W: number, H: number, color: string, thickness: number): string[] {
    return boxes.map(
        ([x, y, w, h]) =>
            `drawbox=x=${Math.round(x * W)}:y=${Math.round(y * H)}:w=${Math.max(2, Math.round(w * W))}:h=${Math.max(2, Math.round(h * H))}:color=${color}:t=${thickness}`
    );
}

function xstackLayout(count: number, columns: number): string {
    const cells: string[] = [];
    for (let i = 0; i < count; i++) {
        const col = i % columns;
        const row = Math.floor(i / columns);
        const x = col === 0 ? "0" : Array.from({ length: col }, () => "w0").join("+");
        const y = row === 0 ? "0" : Array.from({ length: row }, () => "h0").join("+");
        cells.push(`${x}_${y}`);
    }
    return cells.join("|");
}

async function main(): Promise<void> {
    const [resultPath, timesArg, outPath, clipDir = "test-vid"] = process.argv.slice(2);
    if (!resultPath || !timesArg || !outPath) {
        console.log("usage: npm run overlay -- <result.json> <t1,t2,...|labels> <out.jpg> [clipDir]");
        process.exit(1);
    }
    const result = JSON.parse(await readFile(resultPath, "utf8")) as RunFile;
    const { width: W, height: H } = result.analysis;
    const labels = await loadLabels(result.clip);
    const labelByIndex = new Map<number, LabelFrame>((labels?.frames ?? []).map((f) => [f.index, f]));

    let frames: FrameRecord[];
    if (timesArg === "labels") {
        if (!labels) throw new Error(`no labels for ${result.clip}`);
        frames = result.frames.filter((f) => labelByIndex.has(f.index));
    } else {
        frames = timesArg.split(",").map(Number).map((t) => result.frames.reduce((best, f) => (Math.abs(f.time - t) < Math.abs(best.time - t) ? f : best)));
    }
    if (frames.length === 0) throw new Error("no frames selected");

    const panels: string[] = [];
    for (const [i, frame] of frames.entries()) {
        const label = labelByIndex.get(frame.index);
        const filters = [
            `fps=${result.analysis.sampleFps}`,
            `scale=${W}:${H}:flags=bilinear`,
            `select=eq(n\\,${frame.index})`,
            ...(label?.roi ? drawboxes([label.roi], W, H, "white@0.8", 1) : []),
            ...(label ? drawboxes(label.ignore, W, H, "blue@0.9", 1) : []),
            ...(label ? drawboxes(label.movers, W, H, "lime", 2) : []),
            ...drawboxes(frame.boxes, W, H, "red", 1)
        ];
        const panel = join(tmpdir(), `overlay-${process.pid}-${i}.png`);
        // Decoded through the same fps/scale chain as the harness, so the panel is exactly the analyzed sample.
        await run("ffmpeg", ["-v", "error", "-y", "-i", join(clipDir, result.clip), "-an", "-vf", filters.join(","), "-frames:v", "1", "-vsync", "0", panel]);
        panels.push(panel);
        console.log(`panel ${i + 1}: sample ${frame.index} (t=${frame.time.toFixed(2)}s), ${frame.blobs} blobs${label ? ", labeled" : ""}`);
    }

    const columns = panels.length <= 4 ? 2 : 3;
    const inputs = panels.map((_, i) => `[${i}]`).join("");
    const stack = panels.length === 1 ? `${inputs}copy` : `${inputs}xstack=inputs=${panels.length}:layout=${xstackLayout(panels.length, columns)}:fill=black`;
    await run("ffmpeg", ["-v", "error", "-y", ...panels.flatMap((p) => ["-i", p]), "-filter_complex", `${stack},scale=1440:-2`, outPath]);
    await Promise.all(panels.map((p) => rm(p, { force: true })));
    console.log(`wrote ${outPath}`);
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
});
