/**
 * Synthetic tracker test scenarios — no browser, no video, no OpenCV.
 * Feeds hand-built per-frame blob detections straight into
 * BlobTracker/TrackManager and asserts on the resulting track data,
 * covering the failure modes described in the tracking README
 * ("Testing" section): constant movement, camera panning, temporary
 * occlusion, leaving the frame, near-duplicate objects, crossing
 * paths, gradual size change, a sudden unrelated blob, and the
 * lost-vs-abandoned distinction.
 *
 * Run with `npm run test:tracker`. Deterministic and dependency-free
 * beyond the app's own source — no test framework, just node:assert
 * and a tiny runner, in keeping with this project not otherwise having
 * one configured (see CLAUDE.md).
 */
import assert from "node:assert/strict";
import { TrackManager } from "../src/tracking/TrackManager.ts";
import { BlobTracker } from "../src/analysis/BlobTracker.ts";
import { solveAssignment } from "../src/tracking/AssignmentSolver.ts";
import { DEFAULT_TRACKING_SETTINGS } from "../src/tracking/TrackTypes.ts";
import type { BlobData } from "../src/tracking/TrackTypes.ts";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
    try {
        fn();
        passed++;
        console.log(`  ok  ${name}`);
    } catch (error) {
        failed++;
        console.log(`FAIL  ${name}`);
        console.log(`      ${error instanceof Error ? error.message : error}`);
    }
}

function blob(id: number, cx: number, cy: number, w: number, h: number): BlobData {
    return { id, x: cx - w / 2, y: cy - h / 2, width: w, height: h, centerX: cx, centerY: cy, area: w * h };
}

function setup() {
    const trackManager = new TrackManager();
    const blobTracker = new BlobTracker(trackManager);
    return { trackManager, blobTracker };
}

// ---------------------------------------------------------------------------
// Test 1 — constant movement: a single steadily-moving blob should stay one track.
// ---------------------------------------------------------------------------
test("constant movement keeps a single track id", () => {
    const { trackManager, blobTracker } = setup();
    for (let frame = 0; frame < 30; frame++) {
        const cx = 0.1 + frame * 0.02;
        blobTracker.update(frame, [blob(0, cx, 0.5, 0.05, 0.05)]);
    }
    assert.equal(trackManager.getAllTracks().length, 1, "expected exactly one track ever created");
    const track = trackManager.getAllTracks()[0];
    assert.notEqual(track.status, "abandoned");
});

// ---------------------------------------------------------------------------
// Test 2 — camera movement: several roughly-stationary objects panning together
// should not fragment into extra tracks.
// ---------------------------------------------------------------------------
test("camera panning keeps each object as one track", () => {
    const { trackManager, blobTracker } = setup();
    const startX = [0.15, 0.45, 0.75];
    for (let frame = 0; frame < 25; frame++) {
        const blobs = startX.map((x0, i) => blob(i, x0 + frame * 0.012, 0.5, 0.05, 0.05));
        blobTracker.update(frame, blobs);
    }
    assert.equal(trackManager.getAllTracks().length, 3, "expected exactly one track per object, no fragmentation");
    for (const track of trackManager.getAllTracks()) {
        assert.notEqual(track.status, "abandoned");
    }
});

// ---------------------------------------------------------------------------
// Test 3 / 9 — temporary disappearance (occlusion): the track should go
// LOST (not be replaced) during the gap, then REIDENTIFIED on reappearance.
// ---------------------------------------------------------------------------
test("occlusion: track goes lost, then reidentifies under the same id", () => {
    const { trackManager, blobTracker } = setup();
    let frame = 0;
    for (; frame < 10; frame++) {
        blobTracker.update(frame, [blob(0, 0.2 + frame * 0.02, 0.5, 0.05, 0.05)]);
    }
    const originalId = trackManager.getAllTracks()[0].id;

    // Gap: no detections for 8 frames — beyond maxFramesLost (5) but well
    // within reidentifyWindowFrames (45), so it should go "lost", not be
    // abandoned or replaced.
    const gapStart = frame;
    for (; frame < gapStart + 8; frame++) {
        blobTracker.update(frame, []);
    }
    const duringGap = trackManager.getTrack(originalId);
    assert.ok(duringGap, "track should still exist during the gap");
    assert.equal(duringGap.status, "lost", `expected "lost" during occlusion, got "${duringGap.status}"`);

    // Reappears near where it was heading, same size.
    const predictedX = 0.2 + frame * 0.02;
    blobTracker.update(frame, [blob(1, predictedX, 0.5, 0.05, 0.05)]);

    assert.equal(trackManager.getAllTracks().length, 1, "expected the reappearance to revive the same track, not create a new one");
    const revived = trackManager.getTrack(originalId);
    assert.ok(revived);
    assert.equal(revived.status, "active", "expected the revived track to be active again");
});

// ---------------------------------------------------------------------------
// Test 4 — a track that clearly exits the frame should become ABANDONED,
// not sit around as "lost" waiting to be reidentified.
// ---------------------------------------------------------------------------
test("a track exiting the frame becomes abandoned, not lost", () => {
    const { trackManager, blobTracker } = setup();
    let frame = 0;
    // Walk it out to the right edge.
    for (; frame < 15; frame++) {
        const cx = 0.5 + frame * 0.033; // reaches ~0.995 by frame 14
        blobTracker.update(frame, [blob(0, Math.min(cx, 0.985), 0.5, 0.05, 0.05)]);
    }
    const id = trackManager.getAllTracks()[0].id;

    // It's gone now (genuinely left frame) — feed several empty frames.
    for (let i = 0; i < 3; i++) {
        frame++;
        blobTracker.update(frame, []);
    }

    const track = trackManager.getTrack(id);
    assert.ok(track);
    assert.equal(track.status, "abandoned", `expected "abandoned" for a track last seen at the frame edge, got "${track.status}"`);
});

// ---------------------------------------------------------------------------
// Test 5 — two similar, non-crossing objects should never swap ids.
// ---------------------------------------------------------------------------
test("two similar parallel objects keep distinct, stable ids", () => {
    const { trackManager, blobTracker } = setup();
    for (let frame = 0; frame < 20; frame++) {
        blobTracker.update(frame, [blob(0, 0.2 + frame * 0.015, 0.3, 0.05, 0.05), blob(1, 0.2 + frame * 0.015, 0.7, 0.05, 0.05)]);
    }
    const tracks = trackManager.getAllTracks();
    assert.equal(tracks.length, 2, "expected exactly two tracks, no swapping/duplication");

    const top = tracks.find((t) => t.blobs[0].y < 0.5);
    const bottom = tracks.find((t) => t.blobs[0].y >= 0.5);
    assert.ok(top && bottom);
    // Each track's own history should stay on its own side throughout —
    // an id swap would show up as a track whose y suddenly jumps sides.
    for (const point of top.blobs) assert.ok(point.y < 0.5, "top track drifted to the bottom half — likely an id swap");
    for (const point of bottom.blobs) assert.ok(point.y >= 0.5, "bottom track drifted to the top half — likely an id swap");
});

// ---------------------------------------------------------------------------
// Test 6 — crossing paths: two objects passing through each other's space
// should not spawn extra tracks (a coarse but meaningful swap-avoidance check).
// ---------------------------------------------------------------------------
test("crossing objects do not fragment into extra tracks", () => {
    const { trackManager, blobTracker } = setup();
    for (let frame = 0; frame < 20; frame++) {
        const leftToRight = 0.15 + frame * 0.035;
        const rightToLeft = 0.85 - frame * 0.035;
        blobTracker.update(frame, [blob(0, leftToRight, 0.5, 0.05, 0.05), blob(1, rightToLeft, 0.5, 0.05, 0.05)]);
    }
    assert.equal(trackManager.getAllTracks().length, 2, "crossing should not create more than two tracks total");
});

// ---------------------------------------------------------------------------
// Test 7 — gradual size change: the track adapts its learned expected size.
// ---------------------------------------------------------------------------
test("track learns a gradually changing size", () => {
    const { trackManager, blobTracker } = setup();
    const sizes = [0.03, 0.035, 0.04, 0.045, 0.05, 0.05, 0.05, 0.05];
    for (let frame = 0; frame < sizes.length; frame++) {
        blobTracker.update(frame, [blob(0, 0.5, 0.5, sizes[frame], sizes[frame])]);
    }
    assert.equal(trackManager.getAllTracks().length, 1);
    const track = trackManager.getAllTracks()[0];
    assert.ok(track.expectedSize.width > 0.04, `expected size should have grown toward 0.05, got ${track.expectedSize.width}`);
});

// ---------------------------------------------------------------------------
// Test 8 — an established track should not jump onto a sudden unrelated
// blob of very different size that appears near its predicted position.
// ---------------------------------------------------------------------------
test("an established track ignores a nearby but unrelated large blob", () => {
    const { trackManager, blobTracker } = setup();
    let frame = 0;
    // Build up enough history to be trusted (well past confirmationFrames
    // and the trust-maturity window).
    for (; frame < 15; frame++) {
        blobTracker.update(frame, [blob(0, 0.4 + frame * 0.005, 0.5, 0.04, 0.04)]);
    }
    const id = trackManager.getAllTracks()[0].id;
    const expectedNext = 0.4 + frame * 0.005;

    // This frame: both the real continuation AND a large unrelated blob
    // appear right at the predicted spot.
    blobTracker.update(frame, [blob(1, expectedNext, 0.5, 0.04, 0.04), blob(2, expectedNext, 0.5, 0.4, 0.4)]);

    const track = trackManager.getTrack(id);
    assert.ok(track);
    const latest = track.blobs[track.blobs.length - 1];
    assert.ok(latest.width < 0.1, `track jumped to the large unrelated blob (width ${latest.width})`);
});

// ---------------------------------------------------------------------------
// Test 10 — merge/occlusion: two distinct blobs approach, become
// indistinguishable from one detector output for several frames (as if
// occluding one another), then separate again. This is NOT the same as
// test 3 (a blob vanishing to zero detections) — here the detector keeps
// emitting exactly one blob throughout the "merged" stretch. There is no
// dedicated merge/split algorithm (see README "Limitations") — this
// checks whether plain lost -> reidentify is actually adequate for it.
// ---------------------------------------------------------------------------
test("merge/occlusion: does plain lost->reidentify actually recover both identities?", () => {
    const { trackManager, blobTracker } = setup();
    let frame = 0;

    // Two blobs, established but deliberately NOT fully "matured" (only
    // 5 observations, below TRUST_MATURITY_POINTS=8 in Track.ts) so their
    // search radius isn't tightened all the way down — closer to how a
    // real track looks partway through a clip than an artificially
    // perfectly-converged synthetic one. Kept well outside mergeDistance
    // (0.06) so TrackManager's own duplicate-merge never fires here.
    for (; frame < 5; frame++) {
        blobTracker.update(frame, [blob(0, 0.38, 0.5, 0.05, 0.05), blob(1, 0.62, 0.5, 0.05, 0.05)]);
    }
    const idsBeforeMerge = trackManager.getAllTracks().map((t) => t.id);
    assert.equal(idsBeforeMerge.length, 2, "expected two distinct tracks before the merge");

    // Merged: the detector abruptly reports one wider blob at the
    // midpoint for several frames, standing in for a real contour merge
    // downstream of BlobDetector.
    const mergeStart = frame;
    for (; frame < mergeStart + 6; frame++) {
        blobTracker.update(frame, [blob(2, 0.5, 0.5, 0.14, 0.05)]);
    }
    const duringMerge = trackManager.getAllTracks();
    console.log(
        `      [info] during merge: ${duringMerge.length} track(s), statuses ${JSON.stringify(duringMerge.map((t) => ({ id: t.id, status: t.status })))}`
    );
    // Documenting current behavior rather than asserting a fixed target
    // here — see the README critique this scenario feeds into: whether
    // the merged blob gets claimed by one of the two original tracks, or
    // spawns a third "merged object" track while both originals go lost,
    // materially changes what happens on separation below.

    // Separate again: two blobs re-emerge apart from each other.
    const separateStart = frame;
    for (; frame < separateStart + 8; frame++) {
        const t = frame - separateStart;
        const cxA = 0.5 - t * 0.03;
        const cxB = 0.5 + t * 0.03;
        blobTracker.update(frame, [blob(3, cxA, 0.5, 0.05, 0.05), blob(4, cxB, 0.5, 0.05, 0.05)]);
    }

    const finalTracks = trackManager.getAllTracks();
    console.log(
        `      [info] after separating: ${finalTracks.length} track(s), ids ${JSON.stringify(idsBeforeMerge)} -> ${JSON.stringify(finalTracks.map((t) => t.id))}, statuses ${JSON.stringify(finalTracks.map((t) => t.status))}`
    );
    // Documenting current behavior rather than asserting a fixed target —
    // the property that actually matters for downstream data/viz is
    // exactly two objects' worth of track data existing afterward, not
    // silently one (a lost identity) or three+ (a phantom extra track);
    // see the printed result above/README critique for what actually
    // happens.
});

// ---------------------------------------------------------------------------
// Test 11a — gradual convergence (as opposed to an abrupt detector merge,
// tested above): two genuinely distinct objects slowly approaching each
// other. Documents whether TrackManager.mergeDuplicateActiveTracks (meant
// for detection noise splitting ONE blob into two duplicate tracks) also
// fires here, permanently collapsing two still-separate real objects into
// one track before they've actually occluded each other in the detector.
// ---------------------------------------------------------------------------
test("gradual convergence: does mergeDuplicateActiveTracks fire on two still-distinct approaching objects?", () => {
    const { trackManager, blobTracker } = setup();
    let frame = 0;
    for (; frame < 12; frame++) {
        const cxA = 0.3 + frame * 0.02;
        const cxB = 0.7 - frame * 0.02;
        blobTracker.update(frame, [blob(0, cxA, 0.5, 0.05, 0.05), blob(1, cxB, 0.5, 0.05, 0.05)]);
    }
    const tracks = trackManager.getAllTracks();
    console.log(
        `      [info] gradual convergence result: ${tracks.length} track(s) after approaching to within ${(Math.abs((0.3 + 11 * 0.02) - (0.7 - 11 * 0.02)) * 100).toFixed(1)}% of frame width — mergeDistance is ${DEFAULT_TRACKING_SETTINGS.mergeDistance * 100}%`
    );
    // Documenting current behavior rather than asserting a fixed target —
    // see the README critique this scenario feeds into. A collapse to 1
    // track here (still two visually separate bounding boxes, never
    // reported as a single detector blob) is the finding being surfaced.
});

// ---------------------------------------------------------------------------
// Test 11 — camera-motion robustness: when a MAJORITY of visible blobs are
// independently moving the same way (not the camera), does the estimator
// still report high confidence, i.e. mistake coordinated object motion for
// camera motion? The estimator only requires cameraMotionMinTracks (2)
// tracks and a low spread among ALL matchable tracks — it does not check
// what fraction of tracks agree with the majority, so a small minority of
// stationary/independently-moving tracks can be outvoted.
// ---------------------------------------------------------------------------
test("camera-motion confidence when most tracks move independently together (adversarial case)", () => {
    const { blobTracker } = setup();
    // 4 blobs moving right in lockstep (independent objects, e.g. a
    // flock/crowd/school-of-fish scenario — NOT camera motion) + 1 truly
    // stationary blob, which should be the tie-breaker telling the
    // estimator "this isn't actually the camera".
    let frame = 0;
    for (; frame < 20; frame++) {
        const moving = [0, 1, 2, 3].map((i) => blob(i, 0.1 + i * 0.15 + frame * 0.02, 0.2 + i * 0.15, 0.04, 0.04));
        const stationary = blob(4, 0.5, 0.95, 0.04, 0.04);
        blobTracker.update(frame, [...moving, stationary]);
    }
    const camera = blobTracker.getLastCameraMotion();
    console.log(`      [info] adversarial camera-motion estimate: ${JSON.stringify(camera)}`);
    assert.ok(camera, "expected a camera-motion estimate once enough tracks exist");
    // This assertion documents current behavior rather than a fixed
    // target — see the README critique this scenario feeds into.
});

// ---------------------------------------------------------------------------
// AssignmentSolver sanity check — independent of the tracker.
// ---------------------------------------------------------------------------
test("Hungarian assignment finds the minimum-cost pairing", () => {
    const cost = [
        [4, 1, 3],
        [2, 0, 5],
        [3, 2, 2]
    ];
    const assignment = solveAssignment(cost);
    const total = assignment.reduce((sum, col, row) => sum + (col === -1 ? 0 : cost[row][col]), 0);
    // Known optimum for this matrix is 1 (row0->col1) + 2 (row1->col0) + 2 (row2->col2) = 5
    assert.equal(total, 5, `expected minimum total cost 5, got ${total}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
