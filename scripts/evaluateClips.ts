/**
 * Clip evaluation harness — runs every clip in test-vid/ through the REAL
 * analysis pipeline (AnalysisEngine -> BlobDetector/ExposureAnalyzer, then
 * BlobTracker/TrackManager), headless under Node, and reports per clip and
 * per settings profile: blobs per frame, fraction of frames with
 * implausibly many blobs, motion-mask coverage, processing time, and —
 * where hand labels exist (scripts/eval/labels/) — keyframe precision and
 * recall.
 *
 *   npm run eval                                       # all clips, each with its mode's strategy
 *   npm run eval -- --profiles v1-default,v1-comp-off  # named profiles instead
 *   npm run eval -- --clips car,drone --profiles v1-default
 *   npm run eval -- --check                            # + approved thresholds vs. the committed baseline
 *
 * Headless (Node + ffmpeg) rather than a debug page because the whole
 * analysis layer is DOM-free by design and @techstark/opencv-js runs
 * unmodified under Node, so a CLI gives repeatable, scriptable numbers
 * with no browser in the loop. See scripts/eval/ffmpegFrames.ts for how
 * decoding differs from the browser's capture path.
 *
 * Output in --out (default docs/v2/results/latest/):
 * - runs.json  — every run's summary, track counts, label score and a hash
 *   of its per-frame output. Small; this is what the committed baseline
 *   (docs/v2/results/baseline/runs.json) consists of.
 * - summary.md — human-readable tables (+ threshold checks with --check).
 * - <clip>__<profile>.json — full per-frame records incl. blob boxes, for
 *   `npm run overlay` and ad-hoc analysis. Gitignored: regenerate on demand.
 */
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { AnalysisEngine } from "../src/analysis/AnalysisEngine.ts";
import { ANALYSIS_RESOLUTION_BUDGET, DEFAULT_ANALYSIS_SETTINGS } from "../src/analysis/AnalysisTypes.ts";
import type { AnalysisSettings } from "../src/analysis/AnalysisTypes.ts";
import { ANALYSIS_MODES } from "../src/settings/AnalysisModes.ts";
import { presetFor } from "../src/settings/SettingsSchema.ts";
import { BlobTracker } from "../src/analysis/BlobTracker.ts";
import { TrackManager } from "../src/tracking/TrackManager.ts";
import { fitWithinPreservingAspect } from "../src/utils/geometry.ts";
import { decodeFrames, probeVideo } from "./eval/ffmpegFrames.ts";
import { BLOB_CUTOFFS, MOTION_CUTOFFS, clipModeFromName, scoreLabels, summarize } from "./eval/metrics.ts";
import type { FrameRecord, LabelFile, LabelScore } from "./eval/metrics.ts";
import { THRESHOLDS, evaluateRun } from "./eval/thresholds.ts";
import type { CheckResult, RunEntry } from "./eval/thresholds.ts";

/**
 * Named, complete settings sets (the per-video analysis resolution is added
 * per clip). Since V2 the engine runs the AnalysisStrategy named by `mode`:
 * the V1 profiles use a moving strategy (= V1's settings-driven
 * compensation, forced on) or the steady one (= compensation off), with
 * V1's own values, so they reproduce the committed V1 baseline exactly.
 */
const PROFILES: Record<string, Omit<AnalysisSettings, "analysisWidth" | "analysisHeight">> = {
    /** Exactly what V1 ships: legacy block-matching compensation. */
    "v1-default": { ...DEFAULT_ANALYSIS_SETTINGS, mode: "moving-handheld" },
    /** V1's opt-in sparse-optical-flow path. */
    "v1-motion-field": { ...DEFAULT_ANALYSIS_SETTINGS, mode: "moving-handheld", cameraMotionMode: "motion-field" },
    /** No camera compensation at all. */
    "v1-comp-off": { ...DEFAULT_ANALYSIS_SETTINGS, mode: "steady", cameraCompensationEnabled: false },
    /** One profile per V2 analysis mode: that mode's preset (SettingsSchema.presetFor). */
    ...Object.fromEntries(ANALYSIS_MODES.map((mode) => [mode, presetFor(mode)]))
};

/** `auto` (the default) runs each clip with the strategy matching its file name — steady*, moving_car*, ... */
const AUTO_PROFILE = "auto";

function profilesForClip(clip: string, requested: readonly string[]): string[] {
    return requested.flatMap((profile) => {
        if (profile !== AUTO_PROFILE) return [profile];
        const mode = clipModeFromName(clip);
        return mode === "unknown" ? [] : [mode];
    });
}

const LABEL_DIR = "scripts/eval/labels";
const DEFAULT_BASELINE = "docs/v2/results/baseline/runs.json";

interface Options {
    clipDir: string;
    clips: string[];
    profiles: string[];
    out: string;
    maxFrames: number;
    sampleFps: number;
    check: boolean;
    baseline: string;
    /** Extra settings applied on top of every profile (`--set threshold=0.2,morphologyStrength=1`) — for sweeps. The run's profile name gets a `+k=v` suffix. */
    overrides: Partial<AnalysisSettings>;
}

function parseOverrides(spec: string): Partial<AnalysisSettings> {
    const out: Record<string, number | boolean | string> = {};
    for (const pair of spec.split(",").filter(Boolean)) {
        const [key, raw] = pair.split("=");
        if (!key || raw === undefined) throw new Error(`--set expects key=value, got "${pair}"`);
        if (!(key in DEFAULT_ANALYSIS_SETTINGS)) throw new Error(`--set: unknown setting "${key}"`);
        out[key] = raw === "true" ? true : raw === "false" ? false : Number.isFinite(Number(raw)) ? Number(raw) : raw;
    }
    return out as Partial<AnalysisSettings>;
}

function parseArgs(argv: string[]): Options {
    const options: Options = {
        clipDir: "test-vid",
        clips: [],
        profiles: [AUTO_PROFILE],
        out: "docs/v2/results/latest",
        maxFrames: Infinity,
        sampleFps: DEFAULT_ANALYSIS_SETTINGS.sampleFps,
        check: false,
        baseline: DEFAULT_BASELINE,
        overrides: {}
    };
    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i];
        const value = argv[i + 1];
        const take = (): string => {
            if (value === undefined) throw new Error(`${flag} needs a value`);
            i++;
            return value;
        };
        switch (flag) {
            case "--dir": options.clipDir = take(); break;
            case "--clips": options.clips = take().split(",").filter(Boolean); break;
            case "--profiles": options.profiles = take().split(",").filter(Boolean); break;
            case "--out": options.out = take(); break;
            case "--max-frames": options.maxFrames = Number(take()); break;
            case "--sample-fps": options.sampleFps = Number(take()); break;
            case "--check": options.check = true; break;
            case "--baseline": options.baseline = take(); break;
            case "--set": options.overrides = { ...options.overrides, ...parseOverrides(take()) }; break;
            case "--help":
                console.log("usage: npm run eval -- [--dir test-vid] [--clips a,b] [--profiles p,q] [--out dir] [--max-frames N] [--sample-fps N] [--check] [--baseline runs.json] [--set key=value,...]");
                console.log(`profiles: ${AUTO_PROFILE} (default: the strategy matching each clip's name), ${Object.keys(PROFILES).join(", ")}`);
                process.exit(0);
                break;
            default:
                throw new Error(`unknown flag ${flag}`);
        }
    }
    for (const profile of options.profiles) {
        if (profile !== AUTO_PROFILE && !(profile in PROFILES)) throw new Error(`unknown profile "${profile}" — known: ${AUTO_PROFILE}, ${Object.keys(PROFILES).join(", ")}`);
    }
    return options;
}

interface RunResult extends RunEntry {
    mode: string;
    source: { width: number; height: number; fps: number; durationSeconds: number };
    analysis: { width: number; height: number; sampleFps: number };
    rejectionReasons: Record<string, number>;
    wallSeconds: number;
    frames: FrameRecord[];
}

async function loadLabels(clip: string, sampleFps: number): Promise<LabelFile | null> {
    try {
        const file = JSON.parse(await readFile(join(LABEL_DIR, clip.replace(/\.[^.]+$/, ".json")), "utf8")) as LabelFile;
        if (file.sampleFps !== sampleFps) {
            console.warn(`  labels for ${clip} are at ${file.sampleFps} fps, run is at ${sampleFps} fps — not scored`);
            return null;
        }
        return file;
    } catch {
        return null;
    }
}

function profileLabel(profile: string, options: Options): string {
    const entries = Object.entries(options.overrides);
    return entries.length === 0 ? profile : `${profile}+${entries.map(([k, v]) => `${k}=${v}`).join(",")}`;
}

const round4 = (v: number): number => Math.round(v * 10000) / 10000;

async function runClip(path: string, profileName: string, options: Options): Promise<RunResult> {
    const info = await probeVideo(path);
    const { width, height } = fitWithinPreservingAspect(
        info.width,
        info.height,
        ANALYSIS_RESOLUTION_BUDGET.width,
        ANALYSIS_RESOLUTION_BUDGET.height
    );

    const engine = new AnalysisEngine();
    engine.updateSettings({
        ...PROFILES[profileName],
        ...options.overrides,
        analysisWidth: width,
        analysisHeight: height,
        sampleFps: options.sampleFps
    });
    engine.reset();
    const trackManager = new TrackManager();
    const tracker = new BlobTracker(trackManager);

    const frames: FrameRecord[] = [];
    const rejectionReasons: Record<string, number> = {};
    const wallStart = performance.now();

    for await (const frame of decodeFrames(path, width, height, options.sampleFps, options.maxFrames)) {
        const time = frame.index / options.sampleFps;
        // Same numbering FrameSampler uses: source-frame index, not sample index.
        const frameNumber = Math.round(time * info.fps);
        const imageData = { data: frame.data, width, height, colorSpace: "srgb" } as ImageData;

        const analyzeStart = performance.now();
        const result = await engine.analyzeFrame(frameNumber, time, imageData);
        const analyzeMs = performance.now() - analyzeStart;

        const trackStart = performance.now();
        tracker.update(frameNumber, result.blobs);
        const trackMs = performance.now() - trackStart;

        const stats = engine.getLastDetectorStats();
        if (stats) {
            for (const [reason, count] of Object.entries(stats.rejectionReasons)) {
                rejectionReasons[reason] = (rejectionReasons[reason] ?? 0) + count;
            }
        }

        frames.push({
            index: frame.index,
            time,
            blobs: result.blobs.length,
            motionFraction: stats ? stats.motionFraction : null,
            compensationApplied: stats?.compensationApplied ?? false,
            cameraConfidence: stats?.cameraConfidence ?? 0,
            analyzeMs,
            trackMs,
            activeTracks: trackManager.getActiveTracks().length,
            boxes: result.blobs.map((b) => [round4(b.x), round4(b.y), round4(b.width), round4(b.height)])
        });
    }

    const clip = basename(path);
    const labels = await loadLabels(clip, options.sampleFps);
    const allTracks = trackManager.getAllTracks();
    return {
        clip,
        mode: clipModeFromName(path),
        profile: profileLabel(profileName, options),
        source: { width: info.width, height: info.height, fps: info.fps, durationSeconds: info.durationSeconds },
        analysis: { width, height, sampleFps: options.sampleFps },
        rejectionReasons,
        tracks: {
            started: allTracks.length,
            // consecutiveMatches stops incrementing but is never reset once a track is confirmed (see TrackTypes.Track).
            confirmed: allTracks.filter((t) => t.consecutiveMatches >= tracker.getSettings().confirmationFrames).length
        },
        framesHash: createHash("sha1").update(JSON.stringify(frames.map((f) => f.boxes))).digest("hex"),
        labels: labels ? scoreLabels(labels.frames, frames) : null,
        wallSeconds: (performance.now() - wallStart) / 1000,
        summary: summarize(frames, THRESHOLDS.implausibleBlobs),
        frames
    };
}

const pct = (v: number): string => `${(v * 100).toFixed(1)}%`;
const num = (v: number, digits = 1): string => v.toFixed(digits);
const ratio = (v: number | null): string => (v === null ? "–" : v.toFixed(2));

function table(header: string[], rows: string[][]): string {
    return [header, header.map(() => "---"), ...rows].map((cells) => `| ${cells.join(" | ")} |`).join("\n");
}

function resultsTable(results: RunResult[]): string {
    const implausible = THRESHOLDS.implausibleBlobs;
    return table(
        [
            "clip", "mode", "profile", "frames",
            "blobs mean", "blobs p95", "blobs max",
            ...BLOB_CUTOFFS.map((c) => `>${c} blobs`),
            `first >${implausible}`,
            "motion mean", "motion p95",
            ...MOTION_CUTOFFS.map((c) => `motion >${c * 100}%`),
            "comp applied", "ms/frame mean", "ms/frame p95", "track ms mean", "tracks started", "tracks confirmed",
            "precision", "recall", "TP / FP", "movers hit"
        ],
        results.map((r) => {
            const s = r.summary;
            const l: LabelScore | null = r.labels;
            return [
                r.clip, r.mode, r.profile, String(s.frames),
                num(s.blobs.mean), num(s.blobs.p95), String(s.blobs.max),
                ...BLOB_CUTOFFS.map((c) => pct(s.blobsAbove[c] ?? 0)),
                s.firstImplausibleTime === null ? "never" : `${s.firstImplausibleTime.toFixed(2)}s`,
                pct(s.motionFraction.mean), pct(s.motionFraction.p95),
                ...MOTION_CUTOFFS.map((c) => pct(s.motionAbove[c] ?? 0)),
                pct(s.compensationAppliedFraction),
                num(s.analyzeMs.mean), num(s.analyzeMs.p95), num(s.trackMs.mean, 2),
                String(r.tracks.started), String(r.tracks.confirmed),
                l ? ratio(l.precision) : "–", l ? ratio(l.recall) : "–",
                l ? `${l.truePositives} / ${l.falsePositives}` : "–", l ? `${l.moversHit}/${l.movers}` : "–"
            ];
        })
    );
}

function checksMarkdown(checks: CheckResult[]): string {
    const lines = [`## Threshold checks`, ``, `Rules and thresholds: scripts/eval/thresholds.ts (approved 2026-10-02, see docs/v2/baseline.md).`, ``];
    for (const c of checks) {
        const verdict = c.pass ? "PASS" : c.rule === "stretch" ? "below stretch target (not gating)" : "FAIL";
        lines.push(`### ${c.clip} [${c.profile}] — ${c.rule}: ${verdict}`);
        if (c.note) lines.push(``, `> ${c.note}`);
        lines.push(``, table(["check", "value", "target", ""], c.checks.map((k) => [k.name, String(k.value ?? "–"), k.target, k.pass ? "ok" : "✗"])), ``);
    }
    return lines.join("\n");
}

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    const clipDir = resolve(options.clipDir);
    const clips = (await readdir(clipDir))
        .filter((f) => /\.(mp4|mov|webm|mkv|m4v)$/i.test(f))
        .filter((f) => options.clips.length === 0 || options.clips.some((needle) => f.includes(needle)))
        .sort();
    if (clips.length === 0) throw new Error(`no clips matched in ${clipDir}`);

    await mkdir(options.out, { recursive: true });
    const results: RunResult[] = [];

    for (const clip of clips) {
        for (const profile of profilesForClip(clip, options.profiles)) {
            process.stdout.write(`${clip} [${profile}] ... `);
            const result = await runClip(join(clipDir, clip), profile, options);
            results.push(result);
            const s = result.summary;
            const l = result.labels;
            console.log(
                `${s.frames} frames, blobs mean ${num(s.blobs.mean)} max ${s.blobs.max}, ` +
                    `>${THRESHOLDS.implausibleBlobs}: ${pct(s.blobsAbove[THRESHOLDS.implausibleBlobs] ?? 0)}, ` +
                    `motion mean ${pct(s.motionFraction.mean)}, ${num(s.analyzeMs.mean)} ms/frame` +
                    (l ? `, precision ${ratio(l.precision)} recall ${ratio(l.recall)}` : "") +
                    `, ${num(result.wallSeconds)}s wall`
            );
            await writeFile(join(options.out, `${clip.replace(/\.[^.]+$/, "")}__${result.profile.replace(/[^\w.+=-]/g, "_")}.json`), JSON.stringify(result));
        }
    }

    const entries: RunEntry[] = results.map(({ clip, profile, summary, tracks, framesHash, labels }) => ({ clip, profile, summary, tracks, framesHash, labels }));
    await writeFile(join(options.out, "runs.json"), JSON.stringify(entries, null, 1) + "\n");

    let checks: CheckResult[] = [];
    if (options.check) {
        const baseline = JSON.parse(await readFile(options.baseline, "utf8")) as RunEntry[];
        checks = entries.map((entry) => evaluateRun(entry, baseline));
    }

    const md = [
        `# Clip evaluation`,
        ``,
        `Generated ${new Date().toISOString()} by \`npm run eval -- ${process.argv.slice(2).join(" ")}\`.`,
        `Node ${process.version}, ${process.platform}/${process.arch}. Sample rate ${options.sampleFps} fps; analysis resolution fit within ${ANALYSIS_RESOLUTION_BUDGET.width}x${ANALYSIS_RESOLUTION_BUDGET.height}.`,
        `"Implausible": >${THRESHOLDS.implausibleBlobs} blobs. Motion = normal-path motion-mask coverage of the frame. ms/frame = AnalysisEngine.analyzeFrame (detection + exposure), excluding decode/downscale. Precision/recall: hand-labeled keyframes in ${LABEL_DIR}/.`,
        ``,
        resultsTable(results),
        ``,
        ...(options.check ? [checksMarkdown(checks), ``] : []),
        `## Rejection reasons (total candidates rejected over the clip)`,
        ``,
        ...results.map((r) => `- ${r.clip} [${r.profile}]: ${Object.entries(r.rejectionReasons).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}`),
        ``
    ].join("\n");
    await writeFile(join(options.out, "summary.md"), md);

    if (options.check) {
        console.log("\nthreshold checks:");
        for (const c of checks) {
            const failed = c.checks.filter((k) => !k.pass).map((k) => `${k.name} ${k.value} (${k.target})`);
            const verdict = c.pass ? "PASS" : c.rule === "stretch" ? "stretch miss" : "FAIL";
            console.log(`  ${verdict.padEnd(12)} ${c.clip} [${c.profile}] ${c.rule}${failed.length ? ` — ${failed.join("; ")}` : ""}`);
        }
    }
    console.log(`\nwrote ${join(options.out, "summary.md")}`);
    if (options.check && checks.some((c) => !c.gatePass)) process.exitCode = 1;
}

main().catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exit(1);
});
