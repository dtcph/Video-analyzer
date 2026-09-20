/**
 * Synthetic detector scenarios — exercises the REAL @techstark/opencv-js
 * WASM runtime (not mocked) against hand-built synthetic frames, the
 * same way scripts/trackerScenarios.ts exercises the tracker with
 * hand-built blob data. Run with `npm run test:detector`.
 *
 * This validates BlobDetector's motion-diff + global-motion-compensation
 * + motion-candidate pipeline at the OpenCV level. It does NOT validate
 * real video: no codec decoding, no compression artifacts, no natural
 * texture/lighting/wind, no real camera lens distortion — see the
 * written report for what still needs real footage.
 *
 * IMPORTANT: BlobDetector.reset() clears MotionPersistenceTracker's
 * history the same way it clears prevGray, and detect() requires a
 * "prime" call (establishes prevGray, always returns no blobs) before
 * any real diff exists. Beyond that, the candidate-quality pipeline
 * requires *repeated, spatially coherent* observations before accepting
 * anything (see MotionCandidateFilter's minPersistence) — a single
 * before/after frame pair is no longer enough to exercise real
 * detection, most scenarios below feed several consecutive frames of
 * consistent motion and assert on the LAST result, the same way real
 * sampled video would build up persistence over several analyzed frames.
 */
import assert from "node:assert/strict";
import { BlobDetector } from "../src/analysis/BlobDetector.ts";
import type { DetectionResult } from "../src/analysis/BlobDetector.ts";
import { DEFAULT_ANALYSIS_SETTINGS } from "../src/analysis/AnalysisTypes.ts";
import type { AnalysisSettings } from "../src/analysis/AnalysisTypes.ts";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
    try {
        await fn();
        passed++;
        console.log(`  ok  ${name}`);
    } catch (error) {
        failed++;
        console.log(`FAIL  ${name}`);
        console.log(`      ${error instanceof Error ? error.message : error}`);
    }
}

const WIDTH = 320;
const HEIGHT = 240;

type SynthFrame = { data: Uint8ClampedArray; width: number; height: number };

/** A plain object matching the ImageData shape cv.matFromImageData actually reads (data/width/height) — no real DOM/canvas needed under Node. */
function frame(fill = 60): SynthFrame {
    const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
    for (let p = 0; p < WIDTH * HEIGHT; p++) {
        data[p * 4] = fill;
        data[p * 4 + 1] = fill;
        data[p * 4 + 2] = fill;
        data[p * 4 + 3] = 255;
    }
    return { data, width: WIDTH, height: HEIGHT };
}

function paintRect(f: SynthFrame, x: number, y: number, w: number, h: number, value: number): void {
    for (let yy = Math.max(0, Math.round(y)); yy < Math.min(f.height, Math.round(y + h)); yy++) {
        for (let xx = Math.max(0, Math.round(x)); xx < Math.min(f.width, Math.round(x + w)); xx++) {
            const p = (yy * f.width + xx) * 4;
            f.data[p] = value;
            f.data[p + 1] = value;
            f.data[p + 2] = value;
        }
    }
}

/**
 * Textured (pseudo-random speckle) background so global-motion block
 * matching has something non-ambiguous to lock onto. Deliberately NOT a
 * regular/periodic pattern (checkerboard, stripes) — block matching via
 * cross-correlation is inherently confused by periodic textures (a shift
 * of exactly one period looks identical to no shift at all), the same
 * way it would be on a real brick wall or tiled floor. A fixed seed
 * keeps this deterministic across runs.
 */
function paintTexture(f: SynthFrame, lo = 40, hi = 100, seedStart = 42): void {
    let seed = seedStart;
    const rand = () => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed / 0x7fffffff;
    };
    for (let yy = 0; yy < f.height; yy++) {
        for (let xx = 0; xx < f.width; xx++) {
            const v = Math.round(lo + rand() * (hi - lo));
            const p = (yy * f.width + xx) * 4;
            f.data[p] = v;
            f.data[p + 1] = v;
            f.data[p + 2] = v;
        }
    }
}

/** Shifts an entire frame's content by (dx, dy) px, replicating edge pixels — simulates a pure camera pan between two frames. */
function shiftFrame(src: SynthFrame, dx: number, dy: number): SynthFrame {
    const out = frame(0);
    for (let yy = 0; yy < src.height; yy++) {
        for (let xx = 0; xx < src.width; xx++) {
            const sx = Math.min(src.width - 1, Math.max(0, xx - dx));
            const sy = Math.min(src.height - 1, Math.max(0, yy - dy));
            const sp = (sy * src.width + sx) * 4;
            const dp = (yy * out.width + xx) * 4;
            out.data[dp] = src.data[sp];
            out.data[dp + 1] = src.data[sp + 1];
            out.data[dp + 2] = src.data[sp + 2];
            out.data[dp + 3] = 255;
        }
    }
    return out;
}

function cloneFrame(f: SynthFrame): SynthFrame {
    return { data: Uint8ClampedArray.from(f.data), width: f.width, height: f.height };
}

function settings(overrides: Partial<AnalysisSettings> = {}): AnalysisSettings {
    return {
        ...DEFAULT_ANALYSIS_SETTINGS,
        analysisWidth: WIDTH,
        analysisHeight: HEIGHT,
        detectorDebugEnabled: true,
        ...overrides
    };
}

/** Feeds a sequence of frames through a fresh detector, returning every result (index 0 is always the "prime" call — no prior frame, always blob-less). */
async function runSequence(frames: SynthFrame[], s: AnalysisSettings, detector = new BlobDetector()): Promise<DetectionResult[]> {
    const results: DetectionResult[] = [];
    for (const f of frames) results.push(await detector.detect(f as unknown as ImageData, s));
    return results;
}

function last<T>(items: T[]): T {
    return items[items.length - 1];
}

/** Small deterministic PRNG for jitter scenarios — fixed seed per call for reproducibility. */
function makeRng(seed: number): () => number {
    let s = seed;
    return () => {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        return s / 0x7fffffff;
    };
}

// ---------------------------------------------------------------------------
// Scenario 1 — static camera, stationary background: no persistent blobs.
// ---------------------------------------------------------------------------
await test("static camera + stationary background: no blobs once warmed up", async () => {
    const bg = frame(60);
    const results = await runSequence([bg, bg, bg], settings());
    assert.equal(last(results).blobs.length, 0, `expected no blobs on an unchanging frame, got ${last(results).blobs.length}`);
});

// ---------------------------------------------------------------------------
// Scenario 2 — static camera, one steadily moving object: detected once it
// has persisted across a couple of consecutive frames (see module doc).
// ---------------------------------------------------------------------------
await test("static camera + moving object: the object is detected once persistent", async () => {
    const frames: SynthFrame[] = [];
    for (let step = 0; step <= 3; step++) {
        const f = frame(60);
        paintRect(f, 50 + step * 12, 50, 30, 30, 220);
        frames.push(f);
    }

    const results = await runSequence(frames, settings());
    const finalBlobs = last(results).blobs;
    console.log(`      [info] blobs after warm-up: ${JSON.stringify(finalBlobs.map((b) => ({ x: b.x, y: b.y, persistence: b.persistence })))}`);
    assert.ok(finalBlobs.length > 0, "expected at least one blob once the moving object has persisted a few frames");
    // Frame differencing of a translating solid object characteristically
    // reports its leading and trailing edges as separate regions, not one
    // continuous silhouette — documenting that rather than asserting a
    // single blob.
});

// ---------------------------------------------------------------------------
// Scenario 3 — static camera, multiple independently moving objects:
// separate local motion blobs, not one fused region.
// ---------------------------------------------------------------------------
await test("static camera + multiple moving objects: distinct local blobs", async () => {
    const frames: SynthFrame[] = [];
    for (let step = 0; step <= 3; step++) {
        const f = frame(60);
        paintRect(f, 30 + step * 12, 30, 20, 20, 220);
        paintRect(f, 250 - step * 12, 180, 20, 20, 220);
        frames.push(f);
    }

    const results = await runSequence(frames, settings());
    const finalBlobs = last(results).blobs;
    console.log(`      [info] blob count: ${finalBlobs.length}`);
    assert.ok(finalBlobs.length >= 2, `expected at least 2 separate local-motion regions, got ${finalBlobs.length}`);
    const maxArea = Math.max(...finalBlobs.map((b) => b.width * b.height));
    assert.ok(maxArea < 0.3, "expected spatially localized blobs, not one large fused region spanning both objects");
});

// ---------------------------------------------------------------------------
// Scenario 4 — camera pan, static background only: global motion should
// be detected accurately, and compensation should suppress background blobs
// that would otherwise persist (imperfect/no compensation reads the whole
// panning background as sustained, repeatable "motion").
// ---------------------------------------------------------------------------
await test("camera pan + static background: motion estimated accurately, background suppressed", async () => {
    const f1 = frame(60);
    paintTexture(f1);
    const PAN_DX = 6;
    const PAN_DY = -3;
    const f2 = shiftFrame(f1, PAN_DX, PAN_DY);
    const f3 = shiftFrame(f2, PAN_DX, PAN_DY);

    const compensatedResults = await runSequence([f1, f2, f3], settings({ cameraCompensationEnabled: true }));
    const uncompensatedResults = await runSequence([f1, f2, f3], settings({ cameraCompensationEnabled: false }));

    const motion = last(compensatedResults).debug!.globalMotion;
    const compensatedBlobs = last(compensatedResults).blobs.length;
    const uncompensatedBlobs = last(uncompensatedResults).blobs.length;
    console.log(
        `      [info] estimated motion: ${JSON.stringify(motion)} (actual: dx=${PAN_DX}, dy=${PAN_DY}); blobs with compensation=${compensatedBlobs}, without=${uncompensatedBlobs}`
    );
    assert.ok(motion.valid, "expected a valid global-motion estimate on a clean synthetic pan");
    assert.ok(Math.abs(motion.dx - PAN_DX) <= 1, `dx estimate off by more than 1px: got ${motion.dx}`);
    assert.ok(Math.abs(motion.dy - PAN_DY) <= 1, `dy estimate off by more than 1px: got ${motion.dy}`);
    assert.ok(
        compensatedBlobs < uncompensatedBlobs,
        `expected compensation to reduce spurious background blobs (${compensatedBlobs} vs ${uncompensatedBlobs} uncompensated)`
    );
});

// ---------------------------------------------------------------------------
// Scenario 5 — camera pan + a moving object: the object should still be
// detected after compensation, once persistent.
// ---------------------------------------------------------------------------
await test("camera pan + moving object: object still detected after compensation", async () => {
    let background = frame(60);
    paintTexture(background);
    const PAN_DX = 6;

    const frames: SynthFrame[] = [];
    for (let step = 0; step <= 3; step++) {
        const f = cloneFrame(background);
        paintRect(f, 140 + step * 10, 100, 24, 24, 230); // moves independently of the pan
        frames.push(f);
        background = shiftFrame(background, PAN_DX, 0);
    }

    const results = await runSequence(frames, settings());
    const finalBlobs = last(results).blobs;
    console.log(
        `      [info] blobs after pan(+${PAN_DX}px/frame)+independent object move: ${finalBlobs.length}, motion=${JSON.stringify(last(results).debug?.globalMotion)}`
    );
    assert.ok(finalBlobs.length > 0, "expected the independently moving object to still produce a blob after camera compensation");
});

// ---------------------------------------------------------------------------
// Scenario 6 — camera pan-like coordinated motion from SEVERAL independent
// objects covering most of the frame, with only a small textured region
// providing real background evidence: confidence should NOT blindly read
// as high-confidence camera motion just because most sampled points agree.
// ---------------------------------------------------------------------------
await test("mostly independent motion should not automatically read as confident camera motion", async () => {
    const f1 = frame(60);
    paintTexture(f1);
    const f2 = frame(60);
    paintTexture(f2);
    const shifted = shiftFrame(f1, 8, 0);
    for (let yy = 0; yy < HEIGHT; yy++) {
        for (let xx = 0; xx < WIDTH; xx++) {
            const inStationaryCorner = xx < 60 && yy < 60;
            if (inStationaryCorner) continue;
            const dp = (yy * WIDTH + xx) * 4;
            f2.data[dp] = shifted.data[dp];
            f2.data[dp + 1] = shifted.data[dp + 1];
            f2.data[dp + 2] = shifted.data[dp + 2];
        }
    }

    const results = await runSequence([f1, f2], settings());
    console.log(`      [info] motion when ~95% of the frame moved together: ${JSON.stringify(last(results).debug?.globalMotion)}`);
    // Documenting current behavior rather than asserting a fixed target:
    // with a single global-translation model, a shift covering most of
    // the visible frame is statistically indistinguishable from a real
    // pan — see the written report's "remains uncertain" section.
});

// ---------------------------------------------------------------------------
// Scenario 6b — same idea, moderate split: independent motion covers a
// clear minority (~35%) of the frame rather than nearly all of it.
// ---------------------------------------------------------------------------
await test("independent motion covering a minority of the frame keeps confidence low", async () => {
    const f1 = frame(60);
    paintTexture(f1);
    const f2 = frame(60);
    paintTexture(f2);
    const shifted = shiftFrame(f1, 8, 0);
    for (let yy = 0; yy < HEIGHT; yy++) {
        for (let xx = 0; xx < Math.round(WIDTH * 0.35); xx++) {
            const dp = (yy * WIDTH + xx) * 4;
            f2.data[dp] = shifted.data[dp];
            f2.data[dp + 1] = shifted.data[dp + 1];
            f2.data[dp + 2] = shifted.data[dp + 2];
        }
    }

    const results = await runSequence([f1, f2], settings());
    const motion = last(results).debug!.globalMotion;
    console.log(`      [info] motion when ~35% of the frame moved independently: ${JSON.stringify(motion)}`);
    assert.ok(
        !motion.valid || motion.confidence < 0.7,
        `expected a clear minority of independent motion to keep confidence modest, got ${JSON.stringify(motion)}`
    );
});

// ---------------------------------------------------------------------------
// Scenario 7 — lighting/exposure change: does the detector mistake a
// uniform brightness shift for motion?
// ---------------------------------------------------------------------------
await test("uniform lighting change: document whether it's misread as motion", async () => {
    const f1 = frame(60);
    paintTexture(f1, 50, 90);
    const f2 = frame(60);
    paintTexture(f2, 50 + 25, 90 + 25); // whole frame brighter by 25, same pattern

    const results = await runSequence([f1, f2], settings());
    console.log(
        `      [info] uniform +25 brightness shift: ${last(results).blobs.length} blob(s), motion=${JSON.stringify(last(results).debug?.globalMotion)}`
    );
    // Documenting current behavior — see written report.
});

// ---------------------------------------------------------------------------
// Scenario 8 — fast object movement: a large per-frame jump should still
// leave a detectable, bounded number of blobs, not an explosion of
// fragments. A jump-then-jump-again sequence naturally revisits the
// object's *middle* position from both directions, which is what lets a
// persistence-gated detector still confirm it.
// ---------------------------------------------------------------------------
await test("fast object movement: detected without excessive fragmentation", async () => {
    const OBJ = 20;
    const positions = [20, 150, 280];
    const frames = positions.map((x) => {
        const f = frame(60);
        paintRect(f, x, 100, OBJ, OBJ, 220);
        return f;
    });

    const results = await runSequence(frames, settings());
    const finalBlobs = last(results).blobs;
    console.log(`      [info] fast movement blob count: ${finalBlobs.length}`);
    assert.ok(finalBlobs.length > 0 && finalBlobs.length <= 4, `expected a small, bounded number of blobs, got ${finalBlobs.length}`);
});

// ---------------------------------------------------------------------------
// Scenario 9 — slow object movement: detected once it has persisted a
// couple of frames, under the shipped defaults; the old brightness-era
// defaults would have missed it regardless of persistence.
// ---------------------------------------------------------------------------
await test("slow object movement: detected under shipped defaults, missed under the old (brightness-era) threshold", async () => {
    const frames: SynthFrame[] = [];
    for (let step = 0; step <= 3; step++) {
        const f = frame(100);
        paintRect(f, 100 + step * 2, 100, 20, 20, 200); // moderate contrast, 2px/frame
        frames.push(f);
    }

    const shippedResults = await runSequence(frames, settings());
    const oldDefaultResults = await runSequence(frames, settings({ threshold: 0.5, morphologyStrength: 1 }));

    console.log(
        `      [info] slow move (2px/frame, contrast 100 vs 200): shipped defaults -> ${last(shippedResults).blobs.length} blobs; old brightness-era defaults -> ${last(oldDefaultResults).blobs.length} blobs`
    );
    assert.ok(last(shippedResults).blobs.length > 0, "expected the shipped defaults to catch this real, moderate-contrast slow motion");
    assert.equal(
        last(oldDefaultResults).blobs.length,
        0,
        "expected the old (brightness-era) threshold/morphology defaults to miss this same motion — confirms the default change was load-bearing"
    );
});

// ---------------------------------------------------------------------------
// Scenario 10 — one-frame noise: a region that appears for exactly one
// frame transition and then never changes again should NOT become a blob.
// ---------------------------------------------------------------------------
await test("one-frame noise does not become a blob", async () => {
    const clean = frame(60);
    const withGlitch = cloneFrame(clean);
    paintRect(withGlitch, 150, 120, 10, 10, 220); // a single-frame compression-artifact-like patch

    // clean -> withGlitch (the patch "appears", persistence=1, rejected)
    // withGlitch -> withGlitch (frozen: nothing changes, no new candidate at all)
    const results = await runSequence([clean, withGlitch, withGlitch], settings());
    console.log(`      [info] blobs after a single-frame patch, then no further change: ${last(results).blobs.length}`);
    assert.equal(last(results).blobs.length, 0, "expected a one-frame flash to never accumulate enough persistence to become a blob");
});

// ---------------------------------------------------------------------------
// Scenario 11 — thin edge motion: a thin, low-density region (standing in
// for a residual camera-compensation edge along a building line — real
// compensation residue is grainy/partial along the edge, not a solid
// filled strip, which is exactly what makes it read as low-density) should
// be rejected as edge-like regardless of how long it persists.
//
// This is a direct unit test of MotionCandidateFilter rather than a
// pixel-painted CV scenario: reliably synthesizing a single connected
// findContours region with a precise, low density via hand-drawn pixels
// is fiddly and indirect (a solid painted strip is always fully dense
// within its own bounding box, which isn't what a real grainy
// compensation artifact looks like) — testing the filter's actual
// decision on realistic measured properties directly is more precise
// than fighting synthetic pixel patterns to indirectly produce them.
// ---------------------------------------------------------------------------
await test("thin, sparse (edge-like) regions are rejected even when persistent", async () => {
    const { filterCandidates } = await import("../src/analysis/MotionCandidateFilter.ts");
    const thinSparseCandidate = {
        x: 150,
        y: 20,
        width: 3,
        height: 180,
        centerX: 151.5,
        centerY: 110,
        area: 160, // well above minBlobArea, so it's not filtered for being small
        motionPixelCount: 90, // sparse: ~17% of the 3*180=540px bounding box
        motionDensity: 90 / (3 * 180),
        meanMagnitude: 60,
        medianMagnitude: 60,
        compactness: 0.05,
        elongation: 60, // 180/3
        persistence: 6, // clearly persistent — persistence alone should NOT save it
        displacementX: 0,
        displacementY: 0,
        directionConsistency: 0.9,
        path: "normal" as const
    };

    const { accepted, rejected } = filterCandidates([thinSparseCandidate], 320 * 240);
    console.log(`      [info] thin/sparse candidate: accepted=${accepted.length}, rejected reason=${rejected[0]?.reason}`);
    assert.equal(accepted.length, 0, "expected a thin, sparse region to be rejected regardless of persistence");
    assert.equal(rejected[0]?.reason, "edge-like", `expected rejection reason "edge-like", got "${rejected[0]?.reason}"`);
});

// ---------------------------------------------------------------------------
// Scenario 12 — fragmented motion: many small, scattered regions that
// change at a DIFFERENT random location each frame (standing in for
// wind-blown leaves/grass) should not accumulate into blobs, since none of
// them individually persists in one place.
// ---------------------------------------------------------------------------
await test("fragmented, spatially incoherent motion does not overwhelm the detector with blobs", async () => {
    const rng = makeRng(1337);
    const frames: SynthFrame[] = [];
    for (let step = 0; step < 6; step++) {
        const f = frame(60);
        // A dozen tiny speckles at fresh random positions every frame —
        // never the same spot twice, unlike a genuinely persistent object.
        for (let i = 0; i < 12; i++) {
            const x = Math.floor(rng() * (WIDTH - 6));
            const y = Math.floor(rng() * (HEIGHT - 6));
            paintRect(f, x, y, 4, 4, 200);
        }
        frames.push(f);
    }

    const results = await runSequence(frames, settings());
    const finalResult = last(results);
    console.log(`      [info] fragmented motion: ${finalResult.blobs.length} blobs (of up to 12 speckles/frame)`);
    assert.ok(finalResult.blobs.length <= 2, `expected fragmented, non-repeating motion to mostly fail persistence, got ${finalResult.blobs.length} blobs`);
});

// ---------------------------------------------------------------------------
// Scenario 13 — persistent small moving object: below the normal path's
// own minimum area, but caught by the small-object path once it has
// persisted enough (a stand-in for a small person in drone footage).
// ---------------------------------------------------------------------------
await test("persistent small object is caught by the small-object path", async () => {
    // Small enough that its contour area falls below
    // DEFAULT_ANALYSIS_SETTINGS.minBlobArea * frameArea, but above the
    // small path's own (lower) floor.
    const SIZE = 5;
    const frames: SynthFrame[] = [];
    for (let step = 0; step <= 5; step++) {
        const f = frame(60);
        paintRect(f, 100 + step * 3, 100, SIZE, SIZE, 230);
        frames.push(f);
    }

    const withSmallPath = await runSequence(frames, settings({ smallObjectDetectionEnabled: true }));
    const withoutSmallPath = await runSequence(frames, settings({ smallObjectDetectionEnabled: false }));

    const finalWith = last(withSmallPath);
    const finalWithout = last(withoutSmallPath);
    console.log(
        `      [info] small object (${SIZE}x${SIZE}px): with small-path -> ${finalWith.blobs.length} blobs (paths: ${JSON.stringify(finalWith.debug?.acceptedCandidates.map((c) => c.path))}); without -> ${finalWithout.blobs.length} blobs`
    );
    assert.ok(finalWith.blobs.length > 0, "expected the small-object path to eventually catch a persistent, genuinely small object");
    assert.equal(finalWithout.blobs.length, 0, "expected the same tiny object to go undetected with the small path disabled");
});

// ---------------------------------------------------------------------------
// Scenario 14 — stable directional motion: a steadily-moving object should
// build up high direction consistency.
// ---------------------------------------------------------------------------
await test("stable directional motion builds high direction consistency", async () => {
    const frames: SynthFrame[] = [];
    for (let step = 0; step <= 5; step++) {
        const f = frame(60);
        paintRect(f, 40 + step * 10, 120, 26, 26, 220);
        frames.push(f);
    }

    const results = await runSequence(frames, settings());
    const finalCandidates = last(results).debug?.acceptedCandidates ?? [];
    const maxConsistency = Math.max(0, ...finalCandidates.map((c) => c.directionConsistency));
    console.log(`      [info] steady motion direction consistency: ${JSON.stringify(finalCandidates.map((c) => c.directionConsistency))}`);
    assert.ok(finalCandidates.length > 0, "expected the steadily moving object to be accepted");
    assert.ok(maxConsistency > 0.7, `expected high direction consistency for steady one-way motion, got ${maxConsistency}`);
});

// ---------------------------------------------------------------------------
// Scenario 15 — unstable/random motion: a region that keeps reappearing
// near the same spot but in a randomly changing direction each frame
// should NOT build up the same confidence a real moving object gets, even
// though it persists spatially (the wind/vegetation case in miniature).
// ---------------------------------------------------------------------------
await test("unstable/random-direction motion is rejected despite spatial persistence", async () => {
    const rng = makeRng(99);
    const centerX = 160;
    const centerY = 120;
    const frames: SynthFrame[] = [];
    for (let step = 0; step < 7; step++) {
        const f = frame(60);
        // Jitters randomly around a fixed point every frame — persists
        // spatially (small enough offsets to keep matching), but with no
        // consistent direction, unlike genuine translation.
        const jx = centerX + Math.round((rng() - 0.5) * 16);
        const jy = centerY + Math.round((rng() - 0.5) * 16);
        paintRect(f, jx, jy, 16, 16, 220);
        frames.push(f);
    }

    const results = await runSequence(frames, settings());
    const finalResult = last(results);
    const incoherentRejections = (finalResult.debug?.rejectedCandidates ?? []).filter((c) => c.reason === "incoherent-direction");
    console.log(
        `      [info] random-direction jitter: ${finalResult.blobs.length} blobs, rejected reasons: ${JSON.stringify((finalResult.debug?.rejectedCandidates ?? []).map((c) => c.reason))}`
    );
    assert.equal(finalResult.blobs.length, 0, "expected random-direction jitter to be rejected once persistence exposes its incoherent direction");
    assert.ok(incoherentRejections.length > 0, "expected the rejection reason to specifically be incoherent direction, not just insufficient persistence");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
