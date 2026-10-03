# CLAUDE.md

Guidance for Claude Code in this repository. Keep it short and current, and update it at the end of every phase. Detailed reasoning belongs in `docs/`.

## Concept

**Object Counter (V3)** is a public, open-source, client-side website for study research. It runs YOLOv8 (COCO, ONNX via onnxruntime-web) on an image, an uploaded video or a live webcam feed, draws boxes and labels over the media, and counts objects per class:

- **Total:** unique confirmed tracks over the session; always visible.
- **Current frame:** only while paused.

It targets Chrome/Chromium only. There is no backend, accounts, persistence, recording or export.

**Resuming? Read [docs/HANDOFF.md](docs/HANDOFF.md) first** (state, user decisions, environment, gotchas, the Phase 4 plan); the original requirements are in [docs/BRIEF.md](docs/BRIEF.md).

Work proceeds in phases 0–7, plus 6b (camera-motion spike, added 2026-10-03). Each phase ends with a report, and the next one starts only after the user approves. Never make git commits: the user commits after review.

| phase | content                                                                       | status                   |
| ----- | ----------------------------------------------------------------------------- | ------------------------ |
| 0     | archive old project, scaffold, port reusable modules                          | done                     |
| 1     | spike: model export, ORT-Web on WebGPU/WASM, benchmarks, `docs/decisions.md`  | done                     |
| 2     | image detection end-to-end                                                    | done                     |
| 3     | realtime video                                                                | done                     |
| 4     | tracking + total counts                                                       | done (awaiting approval) |
| 5     | webcam                                                                        |                          |
| 6     | pre-analysis mode                                                             |                          |
| 6b    | camera-motion compensation spike (measured go/no-go, `docs/decisions.md` §12) |                          |
| 7     | performance pass + release                                                    |                          |

## `old/` is an archive

`old/` holds the previous project (V1/V2 motion/blob analyzer). It is gitignored and excluded from tsc, ESLint, Prettier, Vitest and the Vite watcher.

- **Never** edit, import from, delete or commit anything in `old/`.
- Read it only for reference. `docs/reuse-audit.md` records what was ported.
- The user deletes it.

## Commands

```bash
npm run dev            # Vite dev server with COOP/COEP headers
npm run build          # tsc --noEmit, then vite build to dist/
npm run preview        # serve dist/ (also with COOP/COEP)
npx tsc --noEmit       # type-check src/, tests/, configs
npm run lint           # ESLint (typescript-eslint recommended + prettier compat)
npm run format         # Prettier write  (format:check to verify)
npm run test           # Vitest, tests/**/*.test.ts
npm run e2e [-- --build] [--headed]
                       # drives the real app in Chrome: uploads test-img/*.jpg, toggles classes/settings,
                       # WASM + YOLOv8s, cache; --build tests the production bundle. Report: .cache/e2e/
npm run e2e:video [-- --build] [--seconds 6]
                       # 3 clips × WebGPU/WASM × 15/30 fps: rates, drops, latency, box lag, pause/seek checks
npm run e2e:counts [-- --build]   # Total section: grows while playing, pause adds nothing, seek keeps totals,
                       # disabled class "not counting", Reset counts
npm run e2e:clips [-- --build] [--backend wasm] [--label name]
                       # plays all 7 test-vid/ clips to the end (1×), records tracker input + totals + ID screenshots
                       # to .cache/e2e/clip-counts/<label>/; replay with other tracker parameters:
node scripts/e2e/sweepTracker.ts [--label name] [--every 2] [--detail clip.mp4]
npm run bench -- --plan smoke|full|rect|release [--shots] [--headed]
                       # in-browser ORT benchmark via bench.html + installed Chrome (puppeteer-core)
.venv-export/bin/python scripts/export_models.py --set release|benchmark   # see scripts/export-model.md
.venv-export/bin/python scripts/bench/compare_variants.py                  # accuracy vs PyTorch reference
```

**Rule:** `npx tsc --noEmit`, `npm run lint` and `npm run test` must all pass after every change set.

Tooling notes:

- TypeScript is pinned to `~6.0`, because typescript-eslint 8.x supports `<6.1` (TS 7 is out but unsupported there).
- DOM tests use `// @vitest-environment happy-dom`.
- ESLint gives `src/` browser and worker globals only, so Node APIs can't leak in.
- `scripts/*.ts` run directly with Node's type stripping (no tsx): erasable TS syntax only, `.ts` import extensions.

## Layering rule

**Inference, tracking and counting never touch the DOM. Rendering never touches inference logic.** Data flows one way: input → inference (worker) → tracking → counting → rendering/ui.

```
src/
  settings/   Plain data. SettingsSchema is THE source of truth for user settings (label, range,
              default, group main/advanced/debug). SettingsStore holds state and sanitizes; nothing persisted.
              classGroups (the brief's 9 groups; every COCO class in exactly one) and
              ClassSelectionStore (enabled classes + mask; default People/Animals/Transportation).
  input/      Media sources (DOM allowed): InputSource interface; ImageSource (decode once to an
              ImageBitmap, capture = bitmap copy); VideoSource (VideoFrame capture; captureDisplayedFrame
              waits for a presented frame: Chrome can't capture a paused, never-presented frame);
              VideoPlayer; FrameSampler (rVFC-driven, SampleRateLimiter caps by media time);
              MediaFiles (pure upload validation, size limits), MediaTypes.
  inference/  No DOM. inference.worker.ts (+ typed InferenceMessages, main-thread InferenceClient):
              plans backend+file (modelPlan), loads runtime (ortRuntime), fetches the model through
              modelCache (Cache API, SHA-256 verified, progress), warms up WebGPU, then detects:
              rect letterbox → ORT → decode (score floor 0.05) → class-aware NMS → normalized boxes.
              FrameGate (one frame in flight, acquireWhenIdle for the paused frame); DetectionHold (latest
              result shown ≤ 0.5 s of media time, never across a seek); preprocess; postprocess
              (+ filterDetections); cocoClasses. The worker uses a GPU canvas for VideoFrames and a CPU
              (willReadFrequently) canvas for ImageBitmaps; both measured.
  bench/      Phase 1 spike (bench.html, dev server only, not in the build): one ORT session per
              worker, per-stage timing, draws detections; driven by scripts/bench/runBrowserBench.ts.
  tracking/   No DOM. Tracker (ByteTrack-style: 3 association stages, tentative/confirmed/lost, majority-vote
              class, newlyConfirmed reported once; internal constants in DEFAULT_TUNING), BoxKalmanFilter
              (constant velocity, variable dt in media seconds), association (IoU − class penalty, buffered IoU
              for lost tracks, Hungarian via AssignmentSolver; trackIdsFor labels the paused frame).
  counting/   No DOM. countByClass, English summary ("3 people, 2 dogs, 1 car"); TotalCounter (session totals,
              inactive = disabled class, "not counting").
  rendering/  Canvas 2D only. OverlayRenderer: one DPR-sized canvas over the media, layers get the
              letterboxed media rect + pixelRatio; while a video plays it redraws per presented frame
              (startVideoLoop, exact media time); onBeforeRender hook picks the boxes for that time. DetectionLayer (boxes +
              "#id class NN%" labels, raw detections dashed; data-only DrawnBox); classColors (fixed color per class).
  ui/         Plain DOM panels: SettingsPanel (generated from the schema; Advanced/Debug <details>
              closed on every load; Reset to defaults), ClassGroupPanel (tri-state groups, expandable),
              CountsPanel (Total / Current frame / Reset), ModelStatusPanel (progress, notes, Retry),
              DebugReadout, UploadPanel, PlaybackControls.
  app/        App.ts: the only module that knows everything; builds the layout and wires services.
              RealtimeVideo: sampling → gate → worker → hold; pause/seek/end handling via an epoch counter;
              onSampledResult (forward-played frames only) feeds App's Tracker → TotalCounter; onSeek clears tracks.
              The stage element exposes data-draw-time / data-result-time / data-boxes for the e2e scripts, and
              with data-trace="1" dispatches a "trackerupdate" event per tracker update (clip runner).
  utils/      Pure helpers: geometry (top-left Box, IoU, contain/fit), format, math.
```

**Tracking and counting (Phase 4):** only frames sampled during forward playback feed the tracker (class mask applied, scores ≥ 0.1); the paused frame's detection never does. While playing, boxes are tracks extrapolated to the displayed time; while paused, the frame's own detections (= "Current frame"). Total = confirmed tracks per class: each track is counted once, at confirmation, and its count follows its majority class (moved on change, sum unchanged). Reset counts clears totals and tracks; a class change drops tracks of disabled classes and marks their totals "not counting".

### Known limitations (tracking and counting)

- **ID switches re-count objects.** No camera-motion compensation yet (planned as Phase 6b, no OpenCV): panning or handheld footage over-counts about 2× (`moving_car`, `moving_handheld-2`). Occlusion plus fast scale change also breaks tracks (`steady.mp4`: 1 person → 3 tracks). A switch can also move an ID onto another object, which hides a count.
- **Re-entry is counted again:** an object that leaves (or is hidden) longer than the track-lost buffer (default 2 s) gets a new track.
- **Scene cuts** start new tracks for everything (`steady.mp4` at 14.38 s).
- **Seeking, rewinding or replaying counts again** (user decision); Reset counts before replaying. Pre-analysis (Phase 6) will give deterministic totals.
- **A track's class is only as good as the model's majority over that track:** after an ID switch each piece votes on its own (the near-camera `steady.mp4` dog is mostly "horse" to YOLOv8n, so that piece counts as a horse). Per-class totals can shift while playing; the sum does not.
- **Small objects** (4K drone footage) are under-detected by YOLOv8n, so totals are low there; slower devices (lower inference rate) confirm fewer brief objects, since N counts frames.

**Detection data flow:** the worker returns everything above the 0.05 score floor after class-aware NMS; the main thread applies the confidence threshold and class mask (`filterDetections`). That is provably equivalent to filtering before NMS (tested), so slider and class changes never need a new inference run. IoU / input size re-run detection; model size / backend reload the model.

Boxes use a top-left origin (`Box {x, y, width, height}`), in pixels or normalized 0..1 as each API states. Final `Detection` boxes are normalized to the source frame.

## Model and runtime (Phase 1 decisions, see `docs/decisions.md`, numbers in `docs/benchmarks.md`)

- `public/models/` (committed, reproducible export, SHA-256 in `manifest.json`): `yolov8n-640-dyn-fp16.onnx` (default), `yolov8n-640-dyn.onnx` (FP32 fallback for WebGPU without `shader-f16`), `yolov8s-640-dyn-fp16.onnx` ("Accurate"). Dynamic H/W; output `[1, 84, N]`, NMS in JS.
- Default input: 640 long side, **rect** letterbox (short side padded to a multiple of 32, 640x384 for 16:9). Matches Ultralytics' predictions exactly.
- Runtime: onnxruntime-web **1.30.0 (pinned)**. Native WebGPU EP (`onnxruntime-web/webgpu`) when an adapter exists, else plain WASM (`onnxruntime-web/wasm`) with `clamp(cores/2, 1, 8)` threads. Threads need COOP/COEP.
- Tracker (Phase 4, `docs/decisions.md` §6, evidence in `docs/clip-counts.md`): user decisions: associate across classes (IoU − 0.2 on a class mismatch); majority-vote class, counted once at confirmation, count follows the majority class; any seek clears tracks and keeps totals. Defaults chosen on the clips: confirmation 3 frames, lost buffer 2 s.
- Hosting: Vercel (user deploys later). `vercel.json` sets COOP/COEP (Phase 7). Hobby limit 100 MB static files; `dist/` budget ~81 MB, so no extra model variants and no JSEP build in the app bundle.
- Benchmark candidates live in `.cache/models-bench/` (gitignored, outside `public/` so they never reach `dist/`).

## Stack

TypeScript, Vite 8, vanilla DOM/CSS, Canvas 2D, Web Workers, onnxruntime-web, Vitest 5, ESLint 10, Prettier, puppeteer-core (dev: drives the installed Chrome for browser benchmarks). Python (export only, in `.venv-export/`): see `scripts/requirements-export.txt`.

- New libraries are allowed when they clearly help; give one sentence of justification per dependency.
- Ask the user before adding any UI framework.
- Do not add OpenCV.
- Verify every library API against the installed version.

## License

The project is AGPL-3.0 (`LICENSE`, `"license": "AGPL-3.0-only"`), because Ultralytics YOLOv8 code and weights are AGPL-3.0. The README must credit Ultralytics YOLOv8 with the license and a source link. Copyright holder: "Paul". AGPL §13: the site footer links to the public repo `github.com/dtcph/Video-analyzer` (`SOURCE_URL` in App.ts). Never ship model files or code without the notice.

## Test media

`test-vid/` (clips) and `test-img/` (stills, Phase 1) are gitignored local media. Never commit them. Several clips are 4K (the product targets 1080p). Stills: `moving_car_t2.0.jpg`, `steady-2_t1.0.jpg`, `steady_t4.9.jpg` (see `docs/benchmarks.md`).
