# V2 baseline: V1 pipeline on the test clips

Phase 0 reference numbers. Every later phase is compared against this file.

## How these numbers were produced

```bash
npm run eval -- --out docs/v2/results/baseline
```

- **Harness**: `scripts/evaluateClips.ts`, headless under Node 24 on darwin/arm64. ffmpeg decodes each clip at 12 fps, scaled bilinearly to the analysis resolution V1 itself picks (`fitWithinPreservingAspect` within 960x540, so 960x540 for all of these 16:9 clips). The real `AnalysisEngine` (BlobDetector + ExposureAnalyzer) analyzes each frame, then the real `BlobTracker`/`TrackManager` consume the blobs. Frame numbers use the same source-frame numbering as `FrameSampler`.
- **Why headless instead of a debug page**: the analysis layer is DOM-free, and `@techstark/opencv-js` runs unmodified in Node (the scenario scripts already rely on this). A CLI gives repeatable, scriptable numbers with no browser in the loop.
- **Deterministic**: two full runs produced identical per-frame blob counts, boxes and motion coverage. Only timing varies, by roughly ±5% between runs.
- **Stored data**: `docs/v2/results/baseline/runs.json` (committed, 28 KB) holds every run's summary, track counts, keyframe label score and a hash of its per-frame output. `summary.md` in the same folder is the full auto-generated table. Per-frame files (`<clip>__<profile>.json`: every frame's blob boxes, coverage, timings) are gitignored. The harness is deterministic, so they can always be regenerated with `npm run eval`. The V1 numbers come from commit `2b99503` plus the read-only stats hook.
- **Overlays**: `docs/v2/img/labels-<clip>.jpg` shows every labeled keyframe of the moving clips, with V1's blobs in red, mover labels in green, ignore regions in blue and the scored region in white. `docs/v2/img/baseline-steady*.jpg` shows 2x2 sheets of the steady clips. Both are made with `npm run overlay`.

### Differences from the app, by design

- **Every sample is processed.** Realtime mode drops a sample when the worker is busy, so on a slow machine the app sees fewer frames. The harness shows what the pipeline does, not what a particular machine keeps up with.
- **Sampling and scaling differ slightly.** ffmpeg's `fps` filter and bilinear scaling stand in for `requestVideoFrameCallback` and `drawImage`. A sample can land one source frame off, and RGB values can differ by a few codes.
- **ms/frame is `AnalysisEngine.analyzeFrame` only.** That is detection plus exposure, in Node's V8 and WASM. It excludes decode, downscale and postMessage, and the first frame (which includes the OpenCV WASM load). Chrome workers run the same engines, but **in-browser timing was not measured** in Phase 0.

## Clips

Every mode and sub-mode has at least one clip. **The files use `moving_<submode>` (underscore), not the `moving-<submode>` in the brief**; the harness accepts both.

| clip | mode | content (from the contact sheets) |
|---|---|---|
| `steady.mp4` | steady | Low ground-level camera: a person and a dog walking away. A camera reposition near the end. |
| `steady-2.mp4` | steady | Static camera on an overpass above a busy highway, about 20 to 30 moving vehicles. |
| `moving_handheld.mp4` | handheld | Camera walking backwards ahead of a hiker. Fence posts and wind-blown grass (strong parallax). |
| `moving_handheld-2.mp4` | handheld | Slow follow-pan of people walking in a park. Distant cars. |
| `moving_drone.mp4` | drone | Slow orbit over a full car park and a lawn with many people. **The "slow flight" case.** |
| `moving_drone-2.mp4` | drone | Forward flight over a park, then low over houses. Strong parallax in the second half. |
| `moving_car.mp4` | car | Side-facing camera from a car crossing a city intersection. Buildings, other cars, a bus. |

## Results: V1 defaults (`v1-default` = legacy block-matching compensation, as shipped)

| clip | source | frames | blobs mean / p95 / max | frames >20 blobs | first >20 | motion mean / p95 | comp applied | ms/frame mean / p95 | tracks started / confirmed |
|---|---|---|---|---|---|---|---|---|---|
| moving_car.mp4 | 1920x1080 @ 29.97 fps, 19.7s | 235 | 36.4 / 63.3 / 71 | 77.0% | 0.17s | 19.9% / 29.7% | 63.0% | 49.7 / 70.2 | 1497 / 416 |
| moving_drone-2.mp4 | 3840x2160 @ 29.97 fps, 38.3s | 458 | 27.5 / 63.0 / 76 | 56.1% | 3.00s | 5.4% / 12.9% | 46.9% | 22.3 / 36.6 | 1560 / 523 |
| moving_drone.mp4 | 3840x2160 @ 24.00 fps, 20.8s | 249 | 5.5 / 14.0 / 21 | 0.8% | 18.25s | 2.9% / 5.0% | 99.6% | 15.4 / 21.6 | 409 / 87 |
| moving_handheld-2.mp4 | 3840x2160 @ 29.97 fps, 9.0s | 107 | 3.6 / 7.0 / 13 | 0.0% | never | 1.4% / 3.2% | 100.0% | 12.4 / 18.0 | 82 / 21 |
| moving_handheld.mp4 | 2560x1440 @ 30.00 fps, 14.3s | 170 | 30.8 / 52.5 / 61 | 74.1% | 0.17s | 14.4% / 19.6% | 62.9% | 37.8 / 48.9 | 555 / 189 |
| steady-2.mp4 | 1280x720 @ 29.97 fps, 15.7s | 188 | 14.2 / 21.7 / 26 | 8.5% | 0.17s | 5.2% / 8.7% | 100.0% | 16.1 / 21.2 | 293 / 126 |
| steady.mp4 | 2560x1440 @ 29.97 fps, 18.3s | 218 | 2.5 / 9.0 / 12 | 0.0% | never | 1.3% / 3.6% | 99.5% | 9.9 / 17.3 | 172 / 40 |

Column notes:
- **motion**: fraction of the frame set in the normal-path motion mask, after threshold and morphology and before candidate filtering.
- **comp applied**: fraction of frames where camera compensation was confident enough to be applied.
- **tracks confirmed**: tracks that reached `confirmationFrames` consecutive matches.

## Results: all three V1 configurations

| clip | profile | blobs mean | frames >20 | motion mean | ms/frame mean |
|---|---|---|---|---|---|
| moving_car.mp4 | v1-default | 36.4 | 77.0% | 19.9% | 49.7 |
| moving_car.mp4 | v1-motion-field | 37.3 | 83.8% | 20.2% | 60.8 |
| moving_car.mp4 | v1-comp-off | 40.5 | 81.3% | 22.7% | 56.0 |
| moving_drone-2.mp4 | v1-default | 27.5 | 56.1% | 5.4% | 22.3 |
| moving_drone-2.mp4 | v1-motion-field | 29.2 | 63.3% | 4.7% | 28.1 |
| moving_drone-2.mp4 | v1-comp-off | 35.1 | 78.6% | 5.3% | 20.2 |
| moving_drone.mp4 | v1-default | 5.5 | 0.8% | 2.9% | 15.4 |
| moving_drone.mp4 | v1-motion-field | 4.7 | 0.4% | 1.7% | 22.7 |
| moving_drone.mp4 | v1-comp-off | 14.3 | 18.9% | 5.2% | 19.3 |
| moving_handheld-2.mp4 | v1-default | 3.6 | 0.0% | 1.4% | 12.4 |
| moving_handheld-2.mp4 | v1-motion-field | 3.5 | 0.0% | 0.7% | 22.0 |
| moving_handheld-2.mp4 | v1-comp-off | 39.4 | 91.6% | 13.9% | 37.1 |
| moving_handheld.mp4 | v1-default | 30.8 | 74.1% | 14.4% | 37.8 |
| moving_handheld.mp4 | v1-motion-field | 32.6 | 74.7% | 14.3% | 50.7 |
| moving_handheld.mp4 | v1-comp-off | 33.4 | 75.3% | 15.1% | 38.3 |
| steady-2.mp4 | v1-default | 14.2 | 8.5% | 5.2% | 16.1 |
| steady-2.mp4 | v1-motion-field | 14.0 | 6.4% | 5.2% | 25.4 |
| steady-2.mp4 | v1-comp-off | 14.2 | 8.5% | 5.2% | 13.2 |
| steady.mp4 | v1-default | 2.5 | 0.0% | 1.3% | 9.9 |
| steady.mp4 | v1-motion-field | 2.4 | 0.0% | 1.3% | 27.8 |
| steady.mp4 | v1-comp-off | 2.5 | 0.0% | 1.3% | 6.9 |

## Findings

1. **Car: both reported problems reproduce.** Car footage passes 20 blobs at 0.17 s, the second analyzed frame, and stays there for 77% of the clip. 20% of each frame is "motion" on average. In the overlay, almost every box sits on building façades, windows and road markings. Compensation is applied in only 63% of frames, and when it is, a single translation cannot model the parallax of a side-facing camera on a moving car. The motion-field path is no better (83.8% of frames over 20 blobs) and is 22% slower.
2. **Slow drone flight: problem 2 reproduces, but blob counts hide it.** `moving_drone` looks healthy by count (5.5 blobs mean, 0.8% of frames over 20), yet the overlay shows boxes on **parked cars**. At the same time, most of the people actually walking on the lawn get no box. Blob counts can't see this; keyframe precision (0.13) and recall (0.19) do.
3. **Drone forward flight (`moving_drone-2`) degrades as parallax grows.** It averages 4 to 20 blobs per second early and 40 to 65 near the end, when the drone is low over houses. Compensation is applied in under 20% of frames there. Roofs, house fronts and paths are boxed; the basketball players mostly aren't.
4. **Handheld is split.** The slow pan (`handheld-2`) works with V1 compensation (3.6 blobs mean). Without compensation it explodes to 39.4, so compensation matters there. The walk-backward clip (`handheld`) fails like the car clip: grass and fence posts are boxed everywhere.
5. **Steady: compensation off gives the same results, faster.**
   - On `steady`, per-frame output with compensation off is identical to V1 defaults (every box in every frame), and analysis takes 30% less time (6.9 vs 9.9 ms).
   - On `steady-2`, compensation off differs in 4 of 188 frames (t = 7.0–7.25 s, where V1 compensated a small shift). Aggregate metrics and confirmed tracks are equal (126); tracks started are 295 vs 293.
   - So the V2 `steady` strategy as specified (compensation off) is effectively a no-regression change and a speed-up.
6. **The motion-field path never pays for itself.** It is 1.3 to 2.8 times slower than legacy on every clip. It is marginally better on `moving_drone` and `handheld-2` and worse on car and drone-2.
7. **One object often produces several blobs, even on steady clips.** The overlays show a person or dog in `steady` split into 3 to 6 blobs, and a truck in `steady-2` into 2 or 3. This is intended: blobs will later be combined into outlines of the moving objects. Blob count is therefore an upper bound on object count, and the label scoring counts fragments on a mover as correct.
8. **Timing headroom.** At 12 fps the per-sample budget is 83 ms. The worst case is the car clip (49.7 ms mean, 70.2 ms p95), and that excludes in-browser decode and downscale.

## Keyframe labels: precision and recall (V1)

Hand labels live in `scripts/eval/labels/<clip>.json`, and their format is described in each file:

| clip | labeled frames |
|---|---|
| car | 6 |
| drone | 4 |
| drone-2 | 4 |
| handheld | 6 |
| handheld-2 | 6 |

Each label is one of three kinds:
- **movers**: things genuinely moving in the world, judged from frame pairs 0.5 s apart against the background.
- **ignore**: ambiguous cases, such as stopped vehicles, standing or sitting people, or objects too small to judge.
- **roi** (optional): the region that gets scored.

Scoring:
- A blob whose center is on a mover (with a small tolerance: 0.01 plus 15% of the box size) is a true positive. Several fragments on one object each count, because blobs will be merged into outlines later.
- A blob in an ignore region is skipped.
- Any other blob in the roi is a false positive.
- Recall is the fraction of movers hit by at least one blob.

Labels were drafted by Claude and verified on the overlay sheets.

| clip | profile | labeled frames | precision | recall | TP / FP blobs | movers hit |
|---|---|---|---|---|---|---|
| moving_car.mp4 | v1-default | 6 | 0.32 | 0.72 | 69 / 145 | 13/18 |
| moving_car.mp4 | v1-motion-field | 6 | 0.34 | 0.89 | 66 / 127 | 16/18 |
| moving_car.mp4 | v1-comp-off | 6 | 0.31 | 0.78 | 62 / 141 | 14/18 |
| moving_drone-2.mp4 | v1-default | 4 | 0.02 | 0.43 | 3 / 130 | 3/7 |
| moving_drone-2.mp4 | v1-motion-field | 4 | 0.05 | 0.57 | 6 / 125 | 4/7 |
| moving_drone-2.mp4 | v1-comp-off | 4 | 0.03 | 0.71 | 6 / 179 | 5/7 |
| moving_drone.mp4 | v1-default | 4 | 0.12 | 0.19 | 3 / 21 | 3/16 |
| moving_drone.mp4 | v1-motion-field | 4 | 0.25 | 0.25 | 4 / 12 | 4/16 |
| moving_drone.mp4 | v1-comp-off | 4 | 0.08 | 0.19 | 3 / 34 | 3/16 |
| moving_handheld-2.mp4 | v1-default | 6 | 0.79 | 1.00 | 11 / 3 | 6/6 |
| moving_handheld-2.mp4 | v1-motion-field | 6 | 0.83 | 0.83 | 10 / 2 | 5/6 |
| moving_handheld-2.mp4 | v1-comp-off | 6 | 0.06 | 1.00 | 16 / 234 | 6/6 |
| moving_handheld.mp4 | v1-default | 6 | 0.11 | 1.00 | 23 / 186 | 6/6 |
| moving_handheld.mp4 | v1-motion-field | 6 | 0.10 | 1.00 | 24 / 216 | 6/6 |
| moving_handheld.mp4 | v1-comp-off | 6 | 0.10 | 1.00 | 24 / 217 | 6/6 |

The labels make the "static objects" failure measurable. `moving_drone` looks fine by blob count but has a precision of 0.13, because most of its blobs sit on parked cars, grass and trees. `handheld-2`, which works in V1, scores 0.79.

## Approved pass thresholds (approved 2026-10-02)

Implemented in `scripts/eval/thresholds.ts`; `npm run eval -- --check` evaluates every run against them and against `docs/v2/results/baseline/runs.json`. One interpretation was added during implementation: the "mean ms/frame no slower than V1" rule allows +10%, because identical repeated runs vary by about ±5%.

**"Implausibly many blobs" = more than 20 blobs in one frame.** Over 20 is roughly steady-2's p95 (21.7), and steady-2 is a dense highway with about 25 real vehicles plus fragmentation. No moving clip has that many real movers in view at once.

### Moving camera: car, drone, drone-2 (primary success criteria)

| metric | target | V1 baseline (car / drone / drone-2) |
|---|---|---|
| frames with >20 blobs | ≤ 5% | 77.0% / 0.8% / 56.1% |
| motion coverage mean | ≤ 5% | 19.9% / 2.9% / 5.4% |
| motion coverage p95 | ≤ 10% | 29.7% / 5.0% / 12.9% |
| blobs mean | ≤ 10 | 36.4 / 5.5 / 27.5 |
| keyframe precision | ≥ 0.6 | 0.32 / 0.13 / 0.02 |
| keyframe recall | ≥ V1 baseline recall | 0.72 / 0.19 / 0.43 |

### Steady: steady, steady-2 (no regression)

- The steady strategy as specified (compensation off) is checked per frame against the `v1-comp-off` run. Any difference has to be a deliberate, explained change.
- A deliberate steady change passes only if all of these hold:
  - blobs mean within ±10% of baseline
  - frames >20 at most baseline + 2 percentage points
  - motion mean within ±0.5 percentage points
  - confirmed tracks within ±15%
  - overlay review shows no new boxes on static content
- ms/frame mean at most `v1-default` + 10%.

### Handheld

- `handheld-2`: same no-regression rule as steady (stays at 0% of frames over 20, blobs mean ≤ 4.0).
- `handheld`: same targets as the moving clips, but as a stretch goal, not a gate. It is not one of the two named problems.

### Performance, all clips

- p95 ms/frame ≤ 83 ms (one sample interval at 12 fps).
- Mean ms/frame no slower than the `v1-default` baseline for that clip.
