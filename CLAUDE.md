# CLAUDE.md

Guidance for Claude Code (claude.ai/code) in this repository. Keep it short and current: update it at the end of every V2 phase. Detailed reasoning belongs in module docs and `docs/v2/`.

## Commands

```bash
npm run dev           # Vite dev server
npm run build         # tsc, then vite build to dist/
npx tsc --noEmit      # type-check src/, scripts/, tests/
npm run lint          # ESLint (eslint.config.js, typescript-eslint recommended)
npm run test          # Vitest (tests/**/*.test.ts), also runs scripts/detectorScenarios.ts + trackerScenarios.ts
npm run eval          # clip harness over test-vid/ (needs ffmpeg/ffprobe), each clip with its mode's strategy
npm run eval -- --check                     # ...plus the approved pass thresholds vs. the committed baseline
npm run eval -- --profiles v1-default --clips car --set threshold=0.2   # named profiles, clip filter, overrides
npm run overlay -- <run.json> <t1,t2,..|labels> <out.jpg>               # blob boxes (+ labels) on frames
```

**Rule: `npx tsc --noEmit`, `npm run lint` and `npm run test` must all pass after every change set.**

Tooling: Vitest is pinned to v3 because v4+ needs Vite ≥ 6. DOM tests use `// @vitest-environment happy-dom`. `@types/node` makes Node globals type-check everywhere; ESLint's per-folder `globals` is what keeps Node APIs out of `src/`.

## Product

Blob Analyzer turns a video into an interactive visualization of motion-detection and tracking data. It is a data-analysis instrument, **not a video editor**. Pipeline: frames → motion-based blob detection → tracking → overlays on the unmodified video.

Everything runs client-side in Chrome/Chromium. There is no backend, persistence, auth or export. Target: 1080p/30 fps, uploads up to ~500 MB. Planned V2 additions, by phase:

| phase | addition | status |
|---|---|---|
| 1 | analysis modes | done |
| 2 | moving-camera quality | |
| 3 | realtime vs. pre-analysis | |
| 4 | webcam input | |
| 5 | classification groundwork | |

The V2 brief and per-phase reports drive this work. Do not start a later phase before the current one is approved.

Stack: TypeScript, Vite, vanilla DOM/CSS, Canvas 2D, OpenCV.js (`@techstark/opencv-js`), WebCodecs, Web Workers.
- New libraries are allowed when they measurably replace inefficient code; give one sentence of justification.
- Ask the user before adding any UI framework.

## Architecture

Core rule: **CV/tracking code never touches the DOM; rendering never touches CV code.** Data flows one way.

```
settings/   Plain data, no CV and no DOM:
            - AnalysisModes: steady | moving-handheld | moving-drone | moving-car
            - SettingsSchema: THE single source of truth for user settings: label, range, group
              main/advanced/debug, applicable modes, per-mode defaults, FIXED_SETTINGS per mode,
              presetFor(mode), DEBUG_VIEWS
            - SettingsStore: main-thread state; setMode applies the preset, resetToDefaults
              restores it
analysis/   AnalysisEngine (runs in the worker) holds the active AnalysisStrategy
            (strategies/: SteadyStrategy, MovingCameraStrategy), chosen by AnalysisSettings.mode.
            A mode change swaps the strategy and resets the detector.
            - BlobDetector: OpenCV pipeline. The strategy supplies the camera-motion estimate via
              detect(..., estimateCameraMotion). Without one, V1 behavior: settings.cameraMotionMode
              picks the estimator.
            - ExposureAnalyzer
            - BlobTracker: main thread, associates blobs into tracks
workers/    AnalysisWorker: downscales transferred VideoFrame/ImageBitmap via OffscreenCanvas, runs
            AnalysisEngine. Messages are in WorkerMessages.ts. AnalysisWorkerClient keeps at most one
            frame in flight and drops samples while busy (realtime by design).
video/      VideoPlayer + FrameSampler (requestVideoFrameCallback-driven capture at sampleFps; frame
            number = round(t * source fps))
tracking/   Track model + TrackManager store
annotations/ text labels bound to a trackId
rendering/  one Canvas2D renderer per layer: AnalysisOverlay, TrackingOverlay, AnnotationRenderer,
            coordinated by VideoRenderer
ui/         plain DOM panels:
            - SettingsPanel: generated from SettingsSchema
            - AnalysisControls: start/stop, layers, readouts
            - TrackingControls, TrackPanel, Inspector, ...
app/        App.ts is the only module that knows everything. It forwards SettingsStore changes to
            the engine and worker. AppState holds the shared services.
```

All spatial values (`BlobData`, `TrackPoint`) are normalized 0..1 of the frame. A blob is a detected region, not an object. **One object often yields several blobs; this is intended**, because blobs will later be merged into object outlines. Don't "fix" fragmentation in the detector.

### Settings UI

The panel is generated from `SETTINGS_SCHEMA`, which is typed as a complete mapping over `SchemaKey`. A new `AnalysisSettings` field without a schema entry is therefore a compile error.

- **Mode selector:** Steady / Moving, and Moving reveals Handheld / Drone / Car. It replaces the V1 "camera motion mode" control. Compensation on/off is fixed per mode (`FIXED_SETTINGS`). The estimator choice (`cameraMotionMode`) is an Advanced setting shown only for moving modes.
- **Main (always visible):** threshold, min blob area, blur, small-object detection, morphology. Morphology took the freed slot because a sensitivity sweep measured it as the most influential remaining setting; see `docs/v2/presets.md`.
- **Advanced:** a `<details>` that is closed on every load and never persisted.
- **Debug:** a separate `<details>` holding the detector-debug compute toggle, the render-only debug views and the camera-motion readout.
- **Reset to defaults:** restores the current mode's preset.
- `TrackingControls` (tracker settings) is still a separate, hand-built panel and not part of the schema.

### Detector (V1 pipeline, unchanged by Phase 1)

grayscale → blur → [camera-motion estimate → translation compensation, only if confident] → absdiff with previous frame → threshold → morphology → contours → `MotionCandidate`s → `MotionPersistenceTracker` (persistence, direction consistency) → `MotionCandidateFilter` → `BlobData`.

Key decisions, each documented in its module:
- **Compensation is translation-only, even though richer models are fit.** Affine and homography fits are diagnostics only, because an unconstrained 6-DOF fit on sparse correspondences absorbed real independent motion (`GlobalMotionEstimator`).
- **Two estimators exist:**
  - legacy block matching with a 2x2 residual grid (`GlobalMotionEstimator`);
  - sparse LK optical flow with a 4x3 grid (`SparseMotionEstimator` + `SceneMotionEstimator`).
  - They share their fitting code in `MotionModelFit`.
  - **This OpenCV.js build does not export `goodFeaturesToTrack` at runtime**, although the `.d.ts` declares it. FAST plus greedy spreading is used instead. Always verify an OpenCV API at runtime before relying on it.
- **Two detection passes:**
  - normal;
  - small-object: lower threshold, no morphology, stricter persistence rules.
- **Parallax:** a candidate whose displacement matches its grid cell's residual is rejected as `parallax-background`.
- `MotionCandidateFilter` gate constants are internal, not UI settings.

## Evaluation (`scripts/evaluateClips.ts`, results in `docs/v2/`)

Headless: ffmpeg decodes each clip at the sample rate and bilinearly scales it to the app's analysis resolution, then the real `AnalysisEngine` + `BlobTracker` process it. Results are deterministic; only timing varies, by about ±5%.

Differences from the app:
- every sample is processed (no realtime dropping);
- timing is Node `analyzeFrame` time only.

**Profiles:**
- `auto` (default): runs each clip with the strategy matching its name.
- One profile per mode: that mode's `presetFor`.
- `v1-default`, `v1-motion-field`, `v1-comp-off`: reproduce V1 exactly through the strategy engine. Verified frame-for-frame identical by hash.

**Clips:** `test-vid/` (gitignored). Names are `steady*`, `moving_car*`, `moving_drone*`, `moving_handheld*`.

**Labels:** `scripts/eval/labels/<clip>.json` holds hand-labeled keyframes for the moving clips (movers / ignore / roi). They give precision and recall; fragments on a mover count as correct.

**Thresholds:** `scripts/eval/thresholds.ts` holds the rules approved 2026-10-02:
- **implausible frame:** more than 20 blobs;
- **car, drone, drone-2 (gate):**
  - at most 5% of frames over 20 blobs;
  - motion coverage mean at most 5%, p95 at most 10%;
  - blobs mean at most 10;
  - precision at least 0.6;
  - recall at least V1's;
- **handheld-2:** no regression;
- **handheld:** stretch goal, not a gate;
- **steady:** identical to V1 compensation-off, or within tolerance;
- **all clips:** p95 at most 83 ms/frame, and mean at most V1 + 10%.

**Committed:**
- `docs/v2/results/baseline/runs.json` + `summary.md`: V1 reference;
- `docs/v2/baseline.md`: findings and thresholds;
- `docs/v2/presets.md`: how each preset was chosen;
- `docs/v2/img/`.

Per-frame `<clip>__<profile>.json` files are gitignored and regenerated on demand.

`BlobDetector.getLastFrameStats()` is cheap, always-on instrumentation for the harness (motion-mask coverage, compensation applied, rejection reasons). It never reaches the UI.

## Known limitations (current)

- **Moving camera still fails the approved thresholds.** Car and drone footage still produce blobs on static structure; see the Phase 1 numbers in `docs/v2/presets.md`. Phase 2 restructures the moving strategies; `MovingCameraStrategy.estimateCameraMotion` is the seam.
- **A single global translation cannot model parallax.** Forward or sideways camera motion through a scene with depth breaks it, and a depth boundary that doesn't align with the fixed residual grid gets diluted across cells.
- **In-browser per-frame timing has not been systematically measured.** Only Node harness timing has; a spot check in headless Chrome showed ~80 ms per frame on the car clip with detector debug on.
