/**
 * The approved V2 pass thresholds (docs/v2/baseline.md, approved
 * 2026-10-02) as pure checks against a run summary and the V1 baseline.
 * Used by `npm run eval -- --check`; unit-tested in tests/evalThresholds.test.ts.
 */
import type { ClipSummary, LabelScore } from "./metrics.ts";
import { clipModeFromName } from "./metrics.ts";

/** What scripts/evaluateClips.ts records per clip x profile in runs.json — everything except per-frame data. */
export interface RunEntry {
    clip: string;
    profile: string;
    summary: ClipSummary;
    tracks: { started: number; confirmed: number };
    /** sha1 over every frame's accepted boxes — equal hashes mean frame-for-frame identical detection output. */
    framesHash: string;
    labels: LabelScore | null;
}

/**
 * - gate: must pass (car, both drone clips — the two known problems).
 * - stretch: reported, never fails the run (walk-backward handheld).
 * - handheld-no-regression: handheld-2 already works in V1; it must stay that way.
 * - steady: must equal the baseline comp-off run frame for frame, or stay within tolerance of V1.
 */
export type ClipRule = "gate" | "stretch" | "handheld-no-regression" | "steady";

const CLIP_RULES: Record<string, ClipRule> = {
    "moving_car.mp4": "gate",
    "moving_drone.mp4": "gate",
    "moving_drone-2.mp4": "gate",
    "moving_handheld.mp4": "stretch",
    "moving_handheld-2.mp4": "handheld-no-regression",
    "steady.mp4": "steady",
    "steady-2.mp4": "steady"
};

export function ruleForClip(clip: string): ClipRule {
    if (clip in CLIP_RULES) return CLIP_RULES[clip];
    return clipModeFromName(clip) === "steady" ? "steady" : "gate";
}

export const THRESHOLDS = {
    implausibleBlobs: 20,
    moving: { implausibleFraction: 0.05, motionMean: 0.05, motionP95: 0.1, blobsMean: 10, precision: 0.6 },
    handheldNoRegression: { implausibleFraction: 0, blobsMean: 4.0 },
    steady: { blobsMeanRel: 0.1, implausibleAbs: 0.02, motionMeanAbs: 0.005, confirmedTracksRel: 0.15 },
    /** One sample interval at 12 fps. */
    p95MsPerFrame: 1000 / 12,
    /**
     * Approved rule: "mean ms/frame no slower than the V1 baseline". Allowed
     * +10% because repeated identical runs vary by about ±5% — a strict
     * comparison would fail on noise alone.
     */
    meanMsTolerance: 0.1
} as const;

/** The V1 reference run for a clip — `v1-default` is what V1 ships, `v1-comp-off` is what the steady strategy is specified as. */
export const BASELINE_PROFILE = "v1-default";
export const STEADY_REFERENCE_PROFILE = "v1-comp-off";

export interface Check {
    name: string;
    value: number | string | null;
    target: string;
    pass: boolean;
}

export interface CheckResult {
    clip: string;
    profile: string;
    rule: ClipRule;
    checks: Check[];
    /** All checks passed. For a stretch clip this is reported but doesn't count toward `gatePass`. */
    pass: boolean;
    /** Whether this result fails the overall run (false for stretch clips regardless of `pass`). */
    gatePass: boolean;
    note?: string;
}

const atMost = (name: string, value: number, max: number, fmt = pctFmt): Check => ({ name, value: fmt(value), target: `≤ ${fmt(max)}`, pass: value <= max + 1e-9 });
const atLeast = (name: string, value: number | null, min: number, fmt = numFmt): Check => ({
    name,
    value: value === null ? null : fmt(value),
    target: `≥ ${fmt(min)}`,
    pass: value !== null && value >= min - 1e-9
});
const within = (name: string, value: number, center: number, tolerance: number, fmt = numFmt): Check => ({
    name,
    value: fmt(value),
    target: `${fmt(center - tolerance)}..${fmt(center + tolerance)}`,
    pass: Math.abs(value - center) <= tolerance + 1e-9
});
function pctFmt(v: number): string {
    return `${(v * 100).toFixed(1)}%`;
}
function numFmt(v: number): string {
    return v.toFixed(2);
}
const msFmt = (v: number): string => `${v.toFixed(1)}ms`;

function implausible(s: ClipSummary): number {
    return s.blobsAbove[THRESHOLDS.implausibleBlobs] ?? 0;
}

export function evaluateRun(run: RunEntry, baseline: readonly RunEntry[]): CheckResult {
    const rule = ruleForClip(run.clip);
    const base = baseline.find((b) => b.clip === run.clip && b.profile === BASELINE_PROFILE);
    const s = run.summary;
    const checks: Check[] = [];
    let note: string | undefined;

    if (rule === "gate" || rule === "stretch") {
        const t = THRESHOLDS.moving;
        checks.push(atMost(`frames >${THRESHOLDS.implausibleBlobs} blobs`, implausible(s), t.implausibleFraction));
        checks.push(atMost("motion mean", s.motionFraction.mean, t.motionMean));
        checks.push(atMost("motion p95", s.motionFraction.p95, t.motionP95));
        checks.push(atMost("blobs mean", s.blobs.mean, t.blobsMean, numFmt));
        if (run.labels) {
            checks.push(atLeast("keyframe precision", run.labels.precision, t.precision));
            const baseRecall = base?.labels?.recall ?? null;
            if (baseRecall !== null) checks.push(atLeast("keyframe recall (≥ V1)", run.labels.recall, baseRecall));
        }
    } else if (rule === "handheld-no-regression") {
        const t = THRESHOLDS.handheldNoRegression;
        checks.push(atMost(`frames >${THRESHOLDS.implausibleBlobs} blobs`, implausible(s), t.implausibleFraction));
        checks.push(atMost("blobs mean", s.blobs.mean, t.blobsMean, numFmt));
    } else {
        const reference = baseline.find((b) => b.clip === run.clip && b.profile === STEADY_REFERENCE_PROFILE);
        const identical = reference !== undefined && reference.framesHash === run.framesHash;
        checks.push({ name: `identical to ${STEADY_REFERENCE_PROFILE}`, value: identical ? "yes" : "no", target: "yes, or within tolerance", pass: true });
        if (!identical) {
            note = "detection output differs from the V1 steady reference — must be a deliberate, explained change";
            if (base) {
                const t = THRESHOLDS.steady;
                const bs = base.summary;
                checks.push(within("blobs mean", s.blobs.mean, bs.blobs.mean, bs.blobs.mean * t.blobsMeanRel));
                checks.push(atMost(`frames >${THRESHOLDS.implausibleBlobs} blobs`, implausible(s), implausible(bs) + t.implausibleAbs));
                checks.push(within("motion mean", s.motionFraction.mean, bs.motionFraction.mean, t.motionMeanAbs, pctFmt));
                checks.push(within("confirmed tracks", run.tracks.confirmed, base.tracks.confirmed, base.tracks.confirmed * t.confirmedTracksRel));
            }
        }
    }

    checks.push(atMost("ms/frame p95", s.analyzeMs.p95, THRESHOLDS.p95MsPerFrame, msFmt));
    if (base) checks.push(atMost("ms/frame mean (≤ V1 +10%)", s.analyzeMs.mean, base.summary.analyzeMs.mean * (1 + THRESHOLDS.meanMsTolerance), msFmt));

    const pass = checks.every((c) => c.pass);
    return { clip: run.clip, profile: run.profile, rule, checks, pass, gatePass: rule === "stretch" ? true : pass, note };
}
