# V2 handoff: where we stopped

Written at the end of the Phase 1 session (2026-10-02). Read this first, then `docs/v2/BRIEF.md` (the full requirements) and `CLAUDE.md` (architecture, commands, decisions).

## Status

| phase                         | state                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------ |
| 0 baseline + harness          | done, thresholds approved                                                      |
| 1 settings/presets/strategies | **done, awaiting the user's review**. Do not start Phase 2 until they approve. |
| 2 moving-camera quality       | next                                                                           |
| 3-5                           | not started                                                                    |

## Repo state

- Branch `V1` (V2 work is on top of it). **Nothing is committed yet**: Phase 0 and Phase 1 are all uncommitted working-tree changes. Run `git status`.
- Check commands. All pass at the end of Phase 1: `npx tsc --noEmit`, `npm run lint`, `npm test` (45 tests), `npm run build`.
- Test clips are in `test-vid/` (gitignored). They use underscore names: `moving_car`, `moving_drone`, `moving_drone-2`, `moving_handheld`, `moving_handheld-2`, `steady`, `steady-2`.
- ffmpeg is needed for the harness (`/opt/homebrew/bin/ffmpeg`). That build has no `drawtext`.
- Chrome is installed at `/Applications/Google Chrome.app` and can be driven headless over CDP for real-browser checks.

## What exists now

- **Harness:** `npm run eval` (each clip with its mode's strategy), `-- --check` (approved thresholds vs. `docs/v2/results/baseline/runs.json`), `--profiles`, `--clips`, `--set key=value`, `npm run overlay`.
- **Labels:** `scripts/eval/labels/*.json` hold hand-labeled keyframes for the 5 moving clips. Review sheets: `docs/v2/img/labels-*.jpg`. Precision/recall scoring counts fragments on a mover as correct.
- **Thresholds:** `scripts/eval/thresholds.ts`. Approved rules, summarized in CLAUDE.md.
- **Settings:** `src/settings/`. `SettingsSchema.ts` is the single source of truth; `SettingsPanel` is generated from it.
- **Strategies:** `src/analysis/strategies/`. `MovingCameraStrategy.estimateCameraMotion` is where Phase 2 plugs in a new model.
- **Docs:**
  - `docs/v2/baseline.md`: V1 numbers and findings
  - `docs/v2/presets.md`: how presets were chosen, plus Phase 1 results
  - `docs/v2/results/phase1/`: Phase 1 run summaries

## Phase 1 results (what Phase 2 must beat)

Passing: steady and steady-2 (identical to V1 with compensation off, 18-30% faster) and handheld-2. Failing the approved thresholds:

| clip                           | blobs mean | frames >20 blobs | precision | other                          |
| ------------------------------ | ---------- | ---------------- | --------- | ------------------------------ |
| car                            | 39.7       | 87%              | 0.64      | motion p95 10.1% vs. limit 10% |
| drone-2                        | 27.7       | 60%              | 0.07      |                                |
| drone                          | 3.5        | 0%               | 0.25      | mean ms/frame 30% over V1      |
| handheld (stretch, not a gate) | 19.7       | 49%              | 0.17      |                                |

Findings that shape Phase 2:

- Threshold tuning cannot close the drone precision gap without losing recall. A better background model is needed.
- Static structure is the false-positive source (facades, parked cars, grass).
- Blur 2 inflated blob counts on the car clip (cause not investigated).
- Sparse optical flow is ~1.3-2.8x slower than block matching.

## Known follow-ups (not done)

- `README.md` was not updated and may describe the old controls.
- In-browser per-frame timing was never measured systematically; Node harness timing only.
- The Phase 1 real-browser check ran before the final moving presets were set. The code paths are the same.
- Tracker settings (`TrackingControls`) are still hand-built, outside the schema.
- Decisions the user may want to reverse (listed in the Phase 1 report):
  - presets come from a fixed rule over a 24-combination grid;
  - the header Reset keeps the current mode.

## Working agreements (the user's)

- Phase by phase. Stop after each phase, report with the 5-section template (changes, verification incl. unverified items, before/after numbers, doubts/decisions, next step), and wait for approval.
- Update CLAUDE.md at the end of each phase. CLAUDE.md is versioned and should stay concise.
- Multiple blobs per object is intended; they will later be merged into outlines. Don't "fix" fragmentation in the detector.
- Steady behavior must not change except through measured, harness-verified improvements.
- Don't commit unless the user asks. Commits end with `Co-Authored-By:` per the session's attribution rule.

## Paste this to resume

```
Continue the Blob Analyzer V2 work in this repo. Read, in this order: docs/v2/HANDOFF.md, docs/v2/BRIEF.md (the full requirements; it wins over CLAUDE.md on conflicts), then CLAUDE.md.

State: Phases 0 and 1 are finished; Phase 1 is awaiting my review. Everything is uncommitted on branch V1. First run git status and the three checks (npx tsc --noEmit, npm run lint, npm test), and confirm test-vid/ and ffmpeg are available.

Then wait for my review feedback on Phase 1 before doing anything else. If I say "approved", start Phase 2 (moving-camera quality and optimization), working to the brief's Phase 2 section and the thresholds in scripts/eval/thresholds.ts. Stop at the end of the phase and report using the 5-section template.
```
