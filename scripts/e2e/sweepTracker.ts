/**
 * Offline tracker parameter sweep (Phase 4). Replays the detections recorded
 * by scripts/e2e/clipCounts.ts through the real tracker module with other
 * parameters, so every setting sees exactly the same detections.
 *
 *   node scripts/e2e/sweepTracker.ts [--label webgpu-30] [--every 1] [--detail clip.mp4 --confirm 3 --lost 1]
 *
 * --every 2 keeps every 2nd recorded frame (simulates a device reaching half the inference rate).
 * Default classes (People/Animals/Transportation) and confidence 0.25, like the app's defaults.
 *
 * "Suspected re-counts": counted tracks that start within 3 s and about one box size of where an
 * earlier counted track (same class group) was last seen: ID switches or re-entries. A heuristic,
 * to compare settings; the screenshots are the ground truth.
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
const CONFIDENCE = 0.25;

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
function replay(rec: Recording, confirmationFrames: number, lostBufferSeconds: number, tuning: Partial<Tuning> = {}) {
    const tracker = new Tracker(
        { confirmationFrames, lostBufferSeconds, highScore: CONFIDENCE },
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

const fmt = (totals: Map<string, number>) =>
    [...totals]
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${v} ${k}`)
        .join(", ") || "—";
const sum = (totals: Map<string, number>) => [...totals.values()].reduce((a, b) => a + b, 0);

if (DETAIL) {
    const rec = recordings.find((r) => r.clip === DETAIL);
    if (!rec) throw new Error(`no recording for ${DETAIL}`);
    const { totals, counted } = replay(rec, Number(option("--confirm", "3")), Number(option("--lost", "1")));
    console.log(`${DETAIL}: ${fmt(totals)}  (app showed ${JSON.stringify(rec.totals)})`);
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
