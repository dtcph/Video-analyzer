/**
 * Offline tracker replay (Phases 4 and 7). Replays the detections recorded by
 * scripts/e2e/clipCounts.ts through the real tracker module, so every setting
 * sees exactly the same detections.
 *
 *   node scripts/e2e/sweepTracker.ts [--label webgpu-30] [--every 1]         # Phase 4 parameter sweep
 *   node scripts/e2e/sweepTracker.ts --label p7-webgpu --switches            # counts + strict ID switches per clip
 *   node scripts/e2e/sweepTracker.ts --label p7-webgpu-s --truth             # vs the user's ground truth, by threshold
 *   node scripts/e2e/sweepTracker.ts --detail clip.mp4 [--confirm 3 --lost 2] # counted tracks and switches of one clip
 *
 * --confidence: the replay's threshold (default 0.35, the app's; the Phase 4 tables used 0.25).
 * --every 2 keeps every 2nd recorded frame (a device reaching half the inference rate).
 * Default classes (People/Animals/Transportation), like the app.
 *
 * "Suspected re-counts" (Phase 4 heuristic, over-reports): counted tracks that start within 3 s and
 * about one box size of where an earlier counted track was last seen. "Strict ID switches" (Phase 7):
 * see strictSwitches().
 */
import { readFileSync, readdirSync } from "node:fs";
import { runnerImport } from "vite";
import type * as TrackerModule from "../../src/tracking/Tracker.ts";
import type * as ClassStoreModule from "../../src/settings/ClassSelectionStore.ts";
import type * as CocoModule from "../../src/inference/cocoClasses.ts";

const argv = process.argv.slice(2);
const option = (name: string, fallback: string) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
const LABEL = option("--label", "webgpu-30");
const EVERY = Number(option("--every", "1"));
const DETAIL = option("--detail", "");
const DIR = `.cache/e2e/clip-counts/${LABEL}`;
const CONFIDENCE = Number(option("--confidence", "0.35"));

const { Tracker, DEFAULT_TUNING } = (await runnerImport<typeof TrackerModule>("./src/tracking/Tracker.ts")).module;
const { ClassSelectionStore } = (await runnerImport<typeof ClassStoreModule>("./src/settings/ClassSelectionStore.ts"))
    .module;
const { COCO_CLASSES } = (await runnerImport<typeof CocoModule>("./src/inference/cocoClasses.ts")).module;
type Tuning = TrackerModule.TrackerTuning;
const mask = new ClassSelectionStore().getMask();

interface Recording {
    clip: string;
    totals: Record<string, number>;
    trace: { t: number; d: number[][] }[];
}

const recordings: Recording[] = readdirSync(DIR)
    .filter((f) => f.endsWith(".mp4.json") || (f.endsWith(".json") && f !== "summary.json"))
    .map((f) => JSON.parse(readFileSync(`${DIR}/${f}`, "utf8")) as Recording);

interface Box {
    x: number;
    y: number;
    width: number;
    height: number;
}

interface CountedTrack {
    id: number;
    classId: number;
    first: number;
    firstBox: Box;
    last: number;
    lastBox: Box;
    hits: number;
}

/** Replays one recording; returns per-class totals and the counted tracks. */
function replay(
    rec: Recording,
    confirmationFrames: number,
    lostBufferSeconds: number,
    tuning: Partial<Tuning> = {},
    confidence = CONFIDENCE
) {
    const tracker = new Tracker(
        { confirmationFrames, lostBufferSeconds, highScore: confidence },
        { ...DEFAULT_TUNING, ...tuning }
    );
    const totals = new Map<string, number>();
    const counted = new Map<number, CountedTrack>();
    let lastT = -1;
    let kept = 0;
    for (const frame of rec.trace) {
        if (frame.t <= lastT) continue; // duplicate entries (same frame recorded twice)
        lastT = frame.t;
        if (kept++ % EVERY !== 0) continue;
        const detections = frame.d
            .filter(([c, s]) => mask[c] === 1 && s >= DEFAULT_TUNING.lowScore)
            .map(([classId, score, x, y, width, height]) => ({ classId, score, box: { x, y, width, height } }));
        const update = tracker.update(frame.t, detections);
        for (const t of update.newlyConfirmed) {
            const label = COCO_CLASSES[t.classId];
            totals.set(label, (totals.get(label) ?? 0) + 1);
        }
        // Counts follow the majority class, like the app's TotalCounter.move.
        for (const { from, to } of update.reclassified) {
            const fromLabel = COCO_CLASSES[from];
            const left = (totals.get(fromLabel) ?? 0) - 1;
            if (left > 0) totals.set(fromLabel, left);
            else totals.delete(fromLabel);
            totals.set(COCO_CLASSES[to], (totals.get(COCO_CLASSES[to]) ?? 0) + 1);
        }
        for (const t of tracker.snapshot()) {
            if (!t.counted) continue;
            const entry = counted.get(t.id);
            if (!entry) {
                // First box: where the object was when its track started (approximately: at confirmation).
                counted.set(t.id, {
                    id: t.id,
                    classId: t.classId,
                    first: t.firstSeen,
                    firstBox: t.box,
                    last: t.lastSeen,
                    lastBox: t.box,
                    hits: t.hits
                });
            } else if (t.state !== "lost") {
                Object.assign(entry, { last: t.lastSeen, lastBox: t.box, hits: t.hits, classId: t.classId });
            }
        }
    }
    return { totals, counted: [...counted.values()] };
}

/**
 * Ground truth (counted by the user at full resolution, 2026-10-06), default classes only.
 * [min, max]: an object entering in the last frames, a cyclist only in the first frame.
 */
const TRUTH: Record<string, Record<string, [number, number]>> = {
    "moving_car.mp4": { car: [33, 34], truck: [10, 10], bus: [3, 3], motorcycle: [3, 3], person: [26, 26] },
    "moving_handheld-2.mp4": {
        car: [10, 10],
        truck: [2, 2],
        motorcycle: [1, 1],
        person: [3, 4],
        bicycle: [0, 1]
    },
    // One person and one dog per shot; the cut at 14.38 s starts new tracks (no tracker links across a cut).
    "steady.mp4": { person: [2, 2], dog: [2, 2] }
};

const VEHICLES = new Set([1, 2, 3, 5, 7]);
const groupOf = (classId: number) => (VEHICLES.has(classId) ? "vehicle" : classId === 0 ? "person" : "animal");

/** Counted tracks that start close (time and place) to where an earlier counted track ended. */
function suspectedRecounts(tracks: CountedTrack[]): { track: CountedTrack; previous: CountedTrack }[] {
    const out: { track: CountedTrack; previous: CountedTrack }[] = [];
    for (const track of tracks) {
        const previous = tracks.find((p) => {
            if (p.id >= track.id || groupOf(p.classId) !== groupOf(track.classId)) return false;
            const gap = track.first - p.last;
            if (gap < 0 || gap > 3) return false;
            const dx = p.lastBox.x + p.lastBox.width / 2 - (track.firstBox.x + track.firstBox.width / 2);
            const dy = p.lastBox.y + p.lastBox.height / 2 - (track.firstBox.y + track.firstBox.height / 2);
            const size = Math.max(p.lastBox.width, p.lastBox.height, track.firstBox.width, track.firstBox.height);
            return Math.hypot(dx, dy) < size;
        });
        if (previous) out.push({ track, previous });
    }
    return out;
}

/**
 * Strict ID switches (Phase 7): a counted track that starts within 1 s after an earlier counted track
 * (same class group) was last seen, at a similar size (within 2×), with overlapping boxes once both are
 * enlarged by 50% per side. Unlike `suspectedRecounts`, a big box nearby does not explain small new ones.
 */
function strictSwitches(tracks: CountedTrack[]): { track: CountedTrack; previous: CountedTrack }[] {
    const grow = (b: Box): Box => ({
        x: b.x - b.width / 2,
        y: b.y - b.height / 2,
        width: 2 * b.width,
        height: 2 * b.height
    });
    const overlaps = (a: Box, b: Box) =>
        a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    const out: { track: CountedTrack; previous: CountedTrack }[] = [];
    for (const track of tracks) {
        const previous = tracks.find((p) => {
            if (p.id >= track.id || groupOf(p.classId) !== groupOf(track.classId)) return false;
            const gap = track.first - p.last;
            if (gap < 0 || gap > 1) return false;
            const ratio = (p.lastBox.height + 1e-6) / (track.firstBox.height + 1e-6);
            return ratio <= 2 && ratio >= 0.5 && overlaps(grow(p.lastBox), grow(track.firstBox));
        });
        if (previous) out.push({ track, previous });
    }
    return out;
}

const fmt = (totals: Map<string, number>) =>
    [...totals]
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${v} ${k}`)
        .join(", ") || "—";
const sum = (totals: Map<string, number>) => [...totals.values()].reduce((a, b) => a + b, 0);

if (argv.includes("--truth")) {
    truth();
    process.exit(0);
}

if (argv.includes("--switches")) {
    switches();
    process.exit(0);
}

if (DETAIL) {
    const rec = recordings.find((r) => r.clip === DETAIL);
    if (!rec) throw new Error(`no recording for ${DETAIL}`);
    const { totals, counted } = replay(rec, Number(option("--confirm", "3")), Number(option("--lost", "2")));
    console.log(`${DETAIL}: ${fmt(totals)}  (app showed ${JSON.stringify(rec.totals)})`);
    for (const { track, previous } of strictSwitches(counted)) {
        const a = previous.lastBox;
        const b = track.firstBox;
        console.log(
            `re-count? #${previous.id} ${COCO_CLASSES[previous.classId]} last ${previous.last.toFixed(2)} s at (${a.x.toFixed(2)}, ${a.y.toFixed(2)}) ${a.width.toFixed(3)}×${a.height.toFixed(3)} → #${track.id} ${COCO_CLASSES[track.classId]} first ${track.first.toFixed(2)} s at (${b.x.toFixed(2)}, ${b.y.toFixed(2)}) ${b.width.toFixed(3)}×${b.height.toFixed(3)}, gap ${(track.first - previous.last).toFixed(2)} s`
        );
    }
    for (const t of counted) {
        const b = t.firstBox;
        console.log(
            `#${t.id} ${COCO_CLASSES[t.classId]} ${t.first.toFixed(2)}–${t.last.toFixed(2)} s, hits ${t.hits}, at (${b.x.toFixed(2)}, ${b.y.toFixed(2)}) ${b.width.toFixed(3)}×${b.height.toFixed(3)}`
        );
    }
    process.exit(0);
}

console.log(`recordings: ${DIR}, every ${EVERY} frame(s), confidence ${CONFIDENCE}, default classes\n`);

// 1. Confirmation frames × lost buffer: total objects counted and suspected re-counts per clip.
const CONFIRMS = [1, 2, 3, 4, 5];
const LOSTS = [0.5, 1, 2, 3];
console.log("## Counted objects (suspected re-counts) per clip, by confirmation frames N and lost buffer\n");
for (const rec of recordings) {
    console.log(`### ${rec.clip} (app at N=3, 1 s: ${JSON.stringify(rec.totals)})\n`);
    console.log(`| N \\ lost | ${LOSTS.map((l) => `${l} s`).join(" | ")} |`);
    console.log(`|---|${LOSTS.map(() => "---").join("|")}|`);
    for (const n of CONFIRMS) {
        const cells = LOSTS.map((lost) => {
            const { totals, counted } = replay(rec, n, lost);
            return `${sum(totals)} (${suspectedRecounts(counted).length})`;
        });
        console.log(`| ${n} | ${cells.join(" | ")} |`);
    }
    console.log();
}

// 2. Per-class totals at candidate defaults.
console.log("## Per-class totals at candidate defaults\n");
const CANDIDATES: [number, number][] = [
    [1, 1],
    [3, 1],
    [3, 2],
    [5, 2]
];
console.log(`| clip | ${CANDIDATES.map(([n, l]) => `N=${n}, ${l} s`).join(" | ")} |`);
console.log(`|---|${CANDIDATES.map(() => "---").join("|")}|`);
for (const rec of recordings) {
    console.log(`| ${rec.clip} | ${CANDIDATES.map(([n, l]) => fmt(replay(rec, n, l).totals)).join(" | ")} |`);
}

// 3. Internal constants: class penalty and duplicate suppression (at N=3, 2 s).
console.log("\n## Class handling (N=3, lost 2 s)\n");
const VARIANTS: [string, Partial<Tuning>][] = [
    ["default (penalty 0.2, duplicates suppressed)", {}],
    ["penalty 0 (class ignored)", { classPenalty: 0 }],
    ["penalty 0.5", { classPenalty: 0.5 }],
    ["strict per class", { classPenalty: 2 }],
    ["no duplicate suppression", { duplicateIou: 2 }],
    ["no low-score stage", { lowScore: CONFIDENCE }],
    ["buffer lost 0.5", { lostBuffer: 0.5 }],
    ["buffer tracked 0.3, lost 0.5", { trackedBuffer: 0.3, lostBuffer: 0.5 }],
    ["buffer lost 1", { lostBuffer: 1 }],
    ["buffer tracked 0.5, lost 1", { trackedBuffer: 0.5, lostBuffer: 1 }]
];
console.log(`| clip | ${VARIANTS.map(([name]) => name).join(" | ")} |`);
console.log(`|---|${VARIANTS.map(() => "---").join("|")}|`);
for (const rec of recordings) {
    console.log(`| ${rec.clip} | ${VARIANTS.map(([, tuning]) => fmt(replay(rec, 3, 2, tuning).totals)).join(" | ")} |`);
}

/** Phase 7: per clip, objects counted at the defaults and the strict ID switches among them. */
function switches(): void {
    console.log(`recordings: ${DIR}, every ${EVERY} frame(s), N = 3, lost 2 s\n`);
    console.log("| clip | counted | strict ID switches | totals |");
    console.log("|---|---|---|---|");
    for (const rec of recordings) {
        const { totals, counted } = replay(rec, 3, 2);
        console.log(`| ${rec.clip} | ${sum(totals)} | ${strictSwitches(counted).length} | ${fmt(totals)} |`);
    }
}

/**
 * Totals vs the ground truth by confidence threshold (5% steps, like the slider): per clip the total
 * counted and the sum of per-class absolute errors, and the error summed over the clips.
 */
function truth(): void {
    const off = (n: number, [lo, hi]: [number, number]) => (n < lo ? n - lo : n > hi ? n - hi : 0);
    const clips = recordings.filter((rec) => TRUTH[rec.clip]);
    console.log(`recordings: ${DIR}, N = 3, lost 2 s. Cells: counted, Σ |class error|\n`);
    console.log(`| threshold | ${clips.map((r) => r.clip.replace(".mp4", "")).join(" | ")} | Σ error |`);
    console.log(`|---|${clips.map(() => "---").join("|")}|---|`);
    for (let step = 5; step <= 13; step++) {
        const confidence = step / 20;
        let total = 0;
        const cells = clips.map((rec) => {
            const expected = TRUTH[rec.clip];
            const { totals } = replay(rec, 3, 2, {}, confidence);
            let absError = 0;
            for (const label of new Set([...Object.keys(expected), ...totals.keys()])) {
                absError += Math.abs(off(totals.get(label) ?? 0, expected[label] ?? [0, 0]));
            }
            total += absError;
            return `${sum(totals)}, ${absError}`;
        });
        console.log(`| ${Math.round(confidence * 100)}% | ${cells.join(" | ")} | ${total} |`);
    }
    console.log();
    for (const rec of clips) console.log(`${rec.clip} at ${CONFIDENCE}: ${fmt(replay(rec, 3, 2).totals)}`);
}
