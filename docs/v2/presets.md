# V2 analysis-mode presets

The source of truth is the per-mode `defaults` in `src/settings/SettingsSchema.ts`. This file records how each value was chosen.

**The moving-camera presets are provisional** until Phase 2 restructures the moving strategies.

## Current presets (Phase 1)

| setting | steady | handheld | drone | car |
|---|---|---|---|---|
| camera compensation (fixed by mode) | off | on | on | on |
| camera-motion estimator | – | block matching | sparse optical flow | sparse optical flow |
| motion threshold | 0.12 | 0.18 | 0.12 | 0.25 |
| min blob area | 0.0002 | 0.0002 | 0.0002 | 0.0002 |
| blur (px) | 0 | 2 | 0 | 2 |
| small-object detection | on | on | on | on |
| morphology | 0 | 1 | 1 | 1 |
| max blob area | 0.5 | 0.5 | 0.5 | 0.5 |
| sample rate (fps) | 12 | 12 | 12 | 12 |
| highlight / shadow / clip | 0.85 / 0.02 / 0.98 | same | same | same |

## How the values were chosen

### Steady
These are V1's values with camera compensation off, as the brief specifies. The harness confirms this is a no-regression change:
- On `steady.mp4` and `steady-2.mp4`, the output is identical frame for frame to the V1 compensation-off run (same hash of every blob box).
- Compared with V1's default (compensation on), `steady.mp4` is identical and `steady-2.mp4` differs in 4 of 188 frames, where V1 compensated a small shift. All aggregates are equal.
- Analysis is 18–30% faster because no camera-motion estimate runs: 9.9 → 7.0 ms and 16.2 → 13.3 ms per frame.

### Moving sub-modes: measured grid

Each sub-mode was swept over a grid of 2 × 3 × 2 × 2 = 24 settings combinations on its own clips; all other settings stayed at V1 values:

| setting | values tried |
|---|---|
| estimator | block matching, sparse optical flow |
| threshold | 0.12, 0.18, 0.25 |
| morphology | 0, 1 |
| blur | 0, 2 px |

The clips per sub-mode were car = `moving_car`, drone = `moving_drone` + `moving_drone-2`, handheld = `moving_handheld` + `moving_handheld-2`.

**Selection rule**, applied mechanically:
1. **Eligible:**
   - keyframe recall at least V1's on every labeled clip of the sub-mode (no recall regression);
   - `handheld-2` keeps its no-regression rule: 0% of frames over 20 blobs, and a blob mean of at most 4.
2. **Most approved checks passed** across the sub-mode's clips. The checks are the approved thresholds:
   - for the gated clips: frames over 20 blobs, motion mean and p95, blobs mean, precision, and p95 ms/frame;
   - for `handheld-2`: its no-regression checks.
3. **Tie-breakers:** higher mean keyframe precision, then lower ms/frame.

| sub-mode | eligible configs | winner | checks (winner vs. V1) | precision (V1 → winner) | runner-up |
|---|---|---|---|---|---|
| car | 25 | flow, t 0.25, morph 1, blur 2 | 3 vs. 1 of 6 | 0.32 → 0.64 | block matching, t 0.25, morph 1, blur 0: 2 checks, 0.64, 25% faster |
| drone | 4 | flow, t 0.12, morph 1, blur 0 | 8 vs. 6 of 12 | 0.07 → 0.16 | flow, t 0.12, morph 0, blur 0: 7 checks, 0.15 |
| handheld | 7 | block matching, t 0.18, morph 1, blur 2 | 6 vs. 5 of 9 | 0.45 → 0.54 | flow, t 0.12, morph 1, blur 0: 6 checks, 0.53, 2.3× slower |

For drone, only 4 of 25 configs (the 24 plus V1) kept recall at V1's level. Higher thresholds raise drone precision considerably, to as much as 0.43 on `moving_drone`, but they lose the small, slow walkers. Most of the drone gap therefore has to be closed by Phase 2 (a better background model), not by tuning thresholds.

### Sensitivity: which setting fills the freed "main" slot

The mode selector replaces V1's camera-motion-mode control. To choose the setting that takes its place in the always-visible group, each remaining non-debug setting was changed one at a time from V1, on every clip:
- steady clips ran with compensation off;
- moving clips ran with V1's default.

| change from V1 | mean \|Δ blobs/frame\| per clip | mean \|Δ precision\| |
|---|---|---|
| morphology 0 → 1 | 4.84 | 0.081 |
| morphology 0 → 2 | 4.35 | 0.082 |
| max blob area 0.5 → 0.15 | 0.11 | 0.003 |
| max blob area 0.5 → 0.05 | 0.30 | 0.002 |
| *(for scale, main settings)* threshold 0.12 → 0.18 | 3.76 | 0.120 |
| min blob area 0.0002 → 0.0006 | 9.91 | 0.115 |
| blur 0 → 2 | 10.20 | 0.045 |
| small-object detection off | 7.12 | 0.035 |

**Morphology** is by far the most influential remaining setting; it is comparable to the main settings. Max blob area barely changes anything on these clips. So morphology moved into the main group. The camera-motion estimator choice stays in Advanced, and only for the moving modes. The sample rate wasn't swept, because the keyframe labels are tied to 12 fps sampling.

## Phase 1 results: each clip with its mode's preset

The command was `npm run eval -- --check --out docs/v2/results/phase1`. V1 is `v1-default`.

| clip | strategy | blobs mean (V1 → P1) | frames >20 | motion mean | precision | recall | ms/frame mean |
|---|---|---|---|---|---|---|---|
| moving_car.mp4 | moving-car | 36.4 → 39.7 | 77.0% → 87.2% | 19.9% → 4.8% | 0.32 → 0.64 | 0.72 → 0.94 | 49.6 → 26.6 |
| moving_drone-2.mp4 | moving-drone | 27.5 → 27.7 | 56.1% → 59.8% | 5.4% → 2.4% | 0.02 → 0.07 | 0.43 → 0.71 | 22.3 → 24.3 |
| moving_drone.mp4 | moving-drone | 5.5 → 3.5 | 0.8% → 0.0% | 2.9% → 0.5% | 0.12 → 0.25 | 0.19 → 0.25 | 15.6 → 22.2 |
| moving_handheld-2.mp4 | moving-handheld | 3.6 → 2.8 | 0.0% → 0.0% | 1.4% → 0.2% | 0.79 → 0.92 | 1.00 → 1.00 | 12.5 → 9.8 |
| moving_handheld.mp4 | moving-handheld | 30.8 → 19.7 | 74.1% → 48.8% | 14.4% → 2.0% | 0.11 → 0.17 | 1.00 → 1.00 | 38.7 → 15.8 |
| steady-2.mp4 | steady | 14.2 → 14.2 | 8.5% → 8.5% | 5.2% → 5.2% | – | – | 16.2 → 13.3 |
| steady.mp4 | steady | 2.5 → 2.5 | 0.0% → 0.0% | 1.3% → 1.3% | – | – | 9.9 → 7.0 |

Threshold checks:
- **Pass:** `steady`, `steady-2` (both identical to V1 compensation-off) and `handheld-2`.
- **Car fails:**
  - blob counts: 87% of frames over 20 blobs, blobs mean 39.7;
  - motion p95: 10.1% against a limit of 10%.
  - It now passes precision (0.64), recall and motion mean.
- **Drone fails:**
  - `moving_drone-2`: blob counts and precision (0.07);
  - `moving_drone`: precision (0.25), and its mean ms/frame is 30% over V1, because the sparse-optical-flow estimator is slower than block matching.
- **Handheld (walk-backward) misses its stretch target.**

The car blob count got slightly worse even though precision doubled. Blur 2 is the likely cause: it added 26 blobs per frame on the car clip in the sensitivity sweep (the mechanism wasn't investigated). Fragments on a mover are acceptable by design (they will be merged into outlines later), but they still count against the approved blob-count threshold. Phase 2 needs to reduce false blobs on structure much further rather than tune these settings.
