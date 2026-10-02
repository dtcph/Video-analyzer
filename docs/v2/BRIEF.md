# Blob Analyzer V2: the original brief (verbatim, as given by the user)

Saved so a new session has the full requirements. If this conflicts with CLAUDE.md, this brief wins; update CLAUDE.md at the end of every phase.

---

## Goal

Upgrade Blob Analyzer from V1 to V2. V1 is described in `CLAUDE.md`; read it first. V2 adds:

1. Switchable analysis modes: Steady camera, and Moving camera with sub-modes Handheld / Drone / Car.
2. Switchable processing modes: Realtime (analysis runs next to playback) and Pre-analysis (analyze everything first, then play back smoothly from a cache).
3. A cleaned-up settings UI: a few high-impact controls always visible, everything else collapsed.
4. Webcam as a second input source with live analysis.
5. Groundwork for future object classification (Human, Dog, Car, Motorcycle, ...). No model is implemented in V2.

The product concept is unchanged: a data-analysis instrument, not a video editor, running client-side in Chrome/Chromium. If this prompt conflicts with `CLAUDE.md`, this prompt wins; update `CLAUDE.md` at the end of every phase so it stays accurate.

## How to work

- Work phase by phase (Phase 0 to Phase 5). **Stop at the end of each phase**, report using the "Phase report" template below, and wait for my review before starting the next phase.
- Performance is a priority. Refactor and optimize wherever it helps, including rewriting the moving-camera path if its current design is not good enough.
- The V1 "no new frameworks" rule is lifted. New libraries are allowed if they replace inefficient code or enable a smoother pipeline. Give one sentence per new dependency on why it is worth it. Do not add a UI framework without asking me first.
- Layering rule stays: CV/tracking logic never touches the DOM; rendering never touches CV logic.
- After every change set: run `npx tsc --noEmit`, `npm run lint`, `npm run test`. All three must pass before a phase ends.

### Phase report template

Every phase ends with a report containing:
1. What changed (files/modules).
2. What you verified, and how. State explicitly anything you could NOT verify (for example hardware you don't have access to).
3. Evaluation numbers per test clip, before vs. after (Phases 0-3).
4. What you were unsure about, and decisions you made that I may want to reverse.
5. Recommended next step.

Also update `CLAUDE.md` (architecture, commands, decisions, limitations) and list the edits.

## Test footage

Clips are in `test-vid/`. Names follow `<mode>[-<submode>]`:

| Pattern | Meaning |
|---|---|
| `steady*` | static camera |
| `moving-car*` | moving camera, vehicle-mounted |
| `moving-drone*` | moving camera, drone |
| `moving-handheld*` | moving camera, handheld |

(Actual files use an underscore: `moving_car.mp4`, `moving_drone.mp4`, `moving_drone-2.mp4`, `moving_handheld.mp4`, `moving_handheld-2.mp4`, `steady.mp4`, `steady-2.mp4`.)

### Known problems to fix (moving camera)

1. **Car footage:** blobs appear everywhere and detection fails almost immediately.
2. **Drone footage, slow flight:** static objects are detected as moving.

These two are the primary success criteria for the moving-camera work. Steady-camera detection works well today and must not regress.

## Phase 0: Baseline and evaluation harness  (DONE, approved)

Repeatable harness `scripts/evaluateClips.ts` running each clip through the current pipeline: blobs per frame (mean/max), fraction of frames with implausibly many blobs, fraction of frame area covered by motion, processing time per frame. Baseline saved in `docs/v2/baseline.md`. Keep `scripts/detectorScenarios.ts` working. Propose pass thresholds for approval.

## Phase 1: Settings cleanup, presets, strategy architecture  (DONE, awaiting review)

### Analysis strategies
- Introduce an `AnalysisStrategy` interface (or equivalent) so each mode plugs in: `steady`, `moving-handheld`, `moving-drone`, `moving-car`. Webcam will use `steady`.
- `steady` = the current motion-based detection with camera compensation off. Moving strategies build on the motion-field path, restructured as needed.
- Each strategy declares its default settings preset and which settings apply to it. Strategies are swappable at runtime; switching resets detector state.

### Mode selector
- Selector: Steady camera / Moving camera. Choosing Moving reveals a sub-mode selector: Handheld / Drone / Car.
- User choice only; no auto-detection in V2.
- Switching mode applies that mode's preset immediately.

### Settings UI
- Always visible: **threshold, minimum blob area, blur, small-object detection**, plus camera motion mode. The mode selector supersedes camera motion mode; if it fully replaces it, say so in the report and show the next most influential setting in its place.
- **Advanced** section: collapsible, closed on every load (do not persist state). Contains all remaining non-debug settings.
- **Debug** section: separate from Advanced. Contains raw diff, compensated diff, motion mask, rejected candidates, sparse flow, detector HUD.
- **Reset to defaults** button: restores the current mode's preset.
- One typed settings schema is the single source of truth (label, range, per-mode default, group: main / advanced / debug). Generate the UI from it so the UI cannot drift from the settings type.

### Presets
- Derive an initial preset per mode from the test clips using the harness. Record how each value was chosen in `docs/v2/presets.md`. Moving-camera presets are provisional until Phase 2 finishes.

Output: strategy modules, settings schema + generated UI, `docs/v2/presets.md`, Vitest tests for the settings schema, preset application, and reset.
Done when: switching mode changes the preset and the detector; Advanced is closed on load; Debug is separate; Reset works; steady clips stay within the approved thresholds.

## Phase 2: Moving-camera quality and optimization

**Input:** Phase 1 strategies, harness, baseline.

### Task
- Fix the two known problems using the harness. Restructure the moving path where needed. Approaches to evaluate (choose by measurement on the clips, not by assumption):
  - Fit the background-motion model from a larger set of LK-tracked features, robustly (homography/affine with RANSAC or MAGSAC via OpenCV), and flag only features/regions whose residual flow disagrees with the model over several consecutive frames.
  - Sub-mode priors: *Handheld* = small translation/rotation jitter, so affine is likely enough. *Drone* = slow, near-planar scene, so homography fits well; slow flight needs a low residual tolerance plus temporal persistence. *Car* = forward motion with an expanding flow field around a focus of expansion, so a single global transform is the wrong model; consider a flow-field/radial model or per-region fit.
  - Require temporal consistency of residual motion before a candidate becomes a blob; reject candidates whose residual is explained by parallax/depth.
  - Estimate motion at lower resolution and refine only candidate regions.
- Profile the pipeline and remove inefficiencies: per-frame Mat allocations (reuse buffers; every OpenCV Mat deleted reliably), unnecessary main-thread/worker copies, full-resolution work where lower resolution is enough.
- Evaluate a newer OpenCV.js build or another acceleration approach (for example WASM SIMD or WebGPU). Adopt it only if the harness shows a measured win.
- Verify OpenCV.js API availability at runtime against the actual WASM build before relying on a function (V1 found `goodFeaturesToTrack` declared in the typings but not exported).

**Output:** updated moving strategies with finalized presets in `docs/v2/presets.md`, before/after table for every clip in `docs/v2/moving-camera.md`, and a "what I chose, why, remaining limitations" section in `CLAUDE.md`.
**Done when:** car and drone clips meet the approved thresholds; steady clips have not regressed; no Mat leaks over a full clip (state how you checked); timing per frame is reported before and after.

## Phase 3: Processing modes (Realtime vs. Pre-analysis)

**Input:** Phases 1-2.

### Selector
Realtime / Pre-analysis.

### Realtime
Same as today: analysis runs next to playback and drops a frame when the worker is busy. This is intended; keep it.

### Pre-analysis
- The whole video is analyzed first; playback and overlays then run together from the cache.
- Playback is completely locked until analysis finishes: play and seek are disabled and the UI shows a clear locked state.
- **Start** and **Stop** buttons for the analysis run and a **progress bar** showing percent, frames done, elapsed time, and estimated time remaining.
- Stop must leave the app in a defined state. Choose between discarding the partial result and keeping it as incomplete, state which you chose in one line, and make sure playback stays locked after a stop.
- No frame dropping in this mode: process every sample in order. Drive extraction from decoded frames (`requestVideoFrameCallback`; evaluate WebCodecs `VideoDecoder` with demuxing where it is faster and more reliable than real-time playback, since faster-than-realtime analysis is an advantage of this mode).
- Cache: in memory only, keyed by frame index/timestamp at the sample rate. Playback looks up the nearest analyzed frame by timestamp. Put it behind an `AnalysisCache` interface so an IndexedDB implementation can be added later without changing callers. Store compactly (typed arrays, normalized values), since a 500MB video at 12 fps yields a lot of data.
- If settings or mode change while a cache exists, **keep the cache** and show a "Settings changed, re-analyze" prompt with a **Re-analyze** button. Only that button replaces the cache.
- Tracks must be identical on every playback of the same cache: either compute them during the analysis pass or recompute deterministically from cached blobs. State which you used.

**Output:** processing-mode selector, analysis run controller (state machine: idle / running / stopped / complete / stale), `AnalysisCache` interface + in-memory implementation, progress UI, Vitest tests for the state machine and nearest-timestamp lookup.
**Done when:** a full clip analyzes with a correct progress bar and ETA; playback is locked until completion and unlocks after; Stop behaves as documented; changing a setting shows the re-analyze prompt without discarding the cache; Realtime mode behaves as before.

## Phase 4: Webcam input source

**Input:** Phase 3 code.
**Task:**
- Add an `InputSource` abstraction (file vs. webcam) so the rest of the app is source-agnostic.
- Webcam mode forces **Realtime** processing and the **Steady** strategy. Lock or hide those selectors in webcam mode and show why.
- Camera device picker when more than one camera is available. Handle permission denied, no camera found, and device unplugged without crashing.
- Request 1080p at 24 fps. Keep resolution and fps in one config object so they are easy to change later.
- Use the most efficient capture path available: `requestVideoFrameCallback` on the MediaStream `<video>` as baseline, `MediaStreamTrackProcessor` where supported and measurably better, with a clean fallback.
- Live view only: no recording, export, or persistence.
- Stopping the webcam releases the camera and tears down workers and Mats.
**Output:** `InputSource` implementations, webcam UI, Vitest tests for source switching and error states where testable.
**Done when:** webcam live analysis runs with overlays; each error case shows a message; stopping releases the camera (check that the browser's camera indicator turns off, or state that you could not check it).

## Phase 5: Classification groundwork (design only, no model)

**Input:** Phases 1-4.
**Task:** Do NOT implement object detection or load a model. Prepare the architecture only:
- Define an `ObjectClassifier` interface (for example `classify(frame, regions) -> Promise<Classification[]>`) with a no-op default implementation, and a place for it in the pipeline and worker setup. Run off the main thread; choose between its own worker and the existing one, and justify the choice in one paragraph.
- Classification is **per track**: classify a track once or sparsely (re-check every N frames or when confidence is low) and store the result on the track. Add optional `label`, `labelConfidence` and, if useful, a short classification history to `Track`. Per-frame blobs stay unclassified.
- Design the feedback path so classification can later improve detection and tracking: per-class priors (expected size, speed, motion consistency) that tracking and `MotionCandidateFilter` can read, and a way to confirm or reject a motion candidate. Provide interfaces and data flow with no-op defaults; document where each hook plugs in.
- The annotation layer must be able to show a track's label later (no UI work now).
- Add a "Future: classification" section to `CLAUDE.md` with the design and this recommended model path: an object detector exported to ONNX, run in a worker with ONNX Runtime Web (WebGPU backend, WASM fallback). Candidates: YOLO-family nano/small (COCO classes cover person, dog, car, motorcycle, bicycle, bus, truck) or RT-DETR; lighter alternative: MediaPipe object detector (EfficientDet-Lite). Check each candidate's license before recommending it (Ultralytics YOLO is AGPL; YOLOX and RT-DETR are Apache-2.0). Prefer running on cropped track regions with an occasional full-frame pass.
**Output:** interfaces and no-op implementations, `Track` type extension, `CLAUDE.md` section, Vitest tests showing the no-op classifier leaves existing behavior unchanged.
**Done when:** the app behaves exactly as at the end of Phase 4, and a future classifier can be plugged in by implementing one interface.

## Constraints

- Never change steady-camera detection behavior except through measured, harness-verified improvements.
- Do not implement classification, video export, project persistence, a backend, auth, IndexedDB storage (interface only), camera-motion auto-detection, or webcam recording/export.
- Do not claim a phase is verified unless you ran the checks. List anything unverified in the phase report.
- Do not invent API signatures; check library and OpenCV.js APIs against the installed version.
- Do not skip ahead: no work from a later phase until I approve the current one.
