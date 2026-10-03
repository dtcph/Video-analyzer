# Handoff: Object Counter V3

**Written 2026-10-02, at the close of Phase 3.** Read this first when resuming. It is meant to be enough, together with the files it links, to continue without any other context. To start a new session, paste [CONTINUE-PROMPT.md](CONTINUE-PROMPT.md).

## 1. Where things stand

| phase | content                                                        | status                                            | commit    |
| ----- | -------------------------------------------------------------- | ------------------------------------------------- | --------- |
| 0     | archive old project to `old/`, scaffold, port reusable modules | done, approved                                    | `1ef26da` |
| 1     | model export, ORT-Web WebGPU/WASM spike, benchmarks, decisions | done, approved                                    | `e37a4a3` |
| 2     | image detection end to end                                     | done, approved                                    | `93b5ab8` |
| 3     | realtime video                                                 | done, **approved by the user 2026-10-02**, closed | `e768321` |
| **4** | **tracking + total counts**                                    | **done 2026-10-03, awaiting the user's approval** |           |
| 5     | webcam                                                         |                                                   |           |
| 6     | pre-analysis mode                                              |                                                   |           |
| 6b    | camera-motion compensation spike (added 2026-10-03)            | planned; go/no-go on measurement                  |           |
| 7     | performance pass + release                                     |                                                   |           |

- The branch is `V3`. Remote: `github.com/dtcph/Video-analyzer` (public). The user makes every commit themselves.
- At the moment of writing, the only uncommitted files are the ones created for this handoff: `docs/BRIEF.md`, `docs/HANDOFF.md`, `docs/CONTINUE-PROMPT.md` and a small `CLAUDE.md` edit. They are ready to commit.
- **Do not start Phase 4 work until the user says to** (they will, with the continue prompt).

## 2. Read these files, in this order

1. [CLAUDE.md](../CLAUDE.md): commands, layering rule, architecture map, model/runtime summary. Kept current.
2. [BRIEF.md](BRIEF.md): the user's original requirements, verbatim. **Phase 4 section and "Counting rules" are the contract for the next phase.**
3. [decisions.md](decisions.md): decisions with reasoning. Section 6 (tracker) and section 5 (class filtering) matter most for Phase 4.
4. [benchmarks.md](benchmarks.md): all measurements. Phase 3 table = the performance baseline.
5. [reuse-audit.md](reuse-audit.md): what was ported from the old project (see its tracking rows for what Phase 4 reuses).

## 3. Working agreements (how this user works)

- **Phase by phase.** Stop at the end of each phase, give the report, wait for approval. Never start the next phase early.
- **Never make git commits.** Leave changes in the working tree and say what is ready to commit (mention which new dirs are gitignored).
- **Never edit, import from, delete or commit anything in `old/`** (ignored archive of the V1/V2 blob analyzer; the user deletes it later).
- **Phase report format (5 parts):** (1) what changed, (2) what was verified and how, and what could NOT be verified, (3) measured numbers, (4) unsure points and decisions the user may want to reverse, (5) recommended next step. Never claim verification that was not run.
- **After every change set:** `npx tsc --noEmit`, `npm run lint` and `npm run test` must all pass (plus `npx prettier --check .`).
- **Do not change counting rules silently;** report any change.
- Check every library API against the installed version. Do not invent signatures.
- New dependency: allowed if it clearly helps; give one sentence of justification. Ask before adding a UI framework. **Never add OpenCV.**
- The user answers briefly and in numbered form. Ask questions in one batch, recommended option first, and keep reports concise. Use markdown file links in replies (the user works in VS Code).
- When producing a document for someone else, open the message with one line naming the audience ("Written for: …").
- The user's pronouns are not stated: use they/them if needed.

## 4. User decisions so far (these override the brief where they differ)

| topic                        | decision                                                                                                                                                         |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model files                  | Committed to git (`public/models/`, ~39.5 MiB, SHA-256 in `manifest.json`). Approved.                                                                            |
| Hosting                      | **Vercel**, deployed by the user later. `vercel.json` with COOP/COEP does not exist yet (Phase 7). Hobby plan: 100 MB static files; the build is ~82 MB.         |
| Copyright line               | "Copyright (C) 2026 Paul" (README, done). Repo is public (AGPL §13 source link is in the footer).                                                                |
| Class flicker in the tracker | **Associate across classes, with an IoU penalty for a class mismatch.** (Strict per-class association would double-count a flickering object, e.g. dog ↔ horse.) |
| Default max inference rate   | 30 fps (Phase 3, approved with the phase).                                                                                                                       |
| Repo rename                  | Question left unanswered; stays "Video-analyzer".                                                                                                                |

| Track class and counting moment (2026-10-03) | Majority-vote class (score-weighted); each track **counted once, at confirmation**; its count then **follows the majority class** (moved on change, sum unchanged, ties keep the current class). Revised the same day from "never moved". |
| Seek / rewind / replay (2026-10-03) | **Any seek clears tracks and keeps totals.** Rewinding or replaying counts again (documented); Reset counts clears both. |

Phase 4 results and the chosen tracker defaults (3 frames, 2 s): [clip-counts.md](clip-counts.md), [decisions.md](decisions.md) §6. Section 8 below is the plan as written before Phase 4.

## 5. Architecture in one page

Data flows one way: `input → inference (worker) → tracking → counting → rendering/ui`; `app/App.ts` is the only module that knows everything. Full module map in [CLAUDE.md](../CLAUDE.md).

- **Image:** `ImageSource` decodes once to an `ImageBitmap`; `App.detect()` sends one capture to the worker; counts of the result are the total ("Total (this image)").
- **Video (Phase 3):** `RealtimeVideo` (`src/app/RealtimeVideo.ts`):
  - `FrameSampler` fires inside `requestVideoFrameCallback`, capped by `SampleRateLimiter` (max inference FPS, by media time);
  - `FrameGate` allows one frame in flight; others are dropped and counted;
  - `VideoSource.captureFrame` makes a `VideoFrame` synchronously inside the callback; the worker closes it;
  - the result is tagged with its frame's media time and stored in `DetectionHold` (shown ≤ 0.5 s, never across a seek);
  - `OverlayRenderer.startVideoLoop` redraws per presented video frame with the exact media time; its `onBeforeRender` hook makes `App.updateLayer(time)` pick the detections for that time;
  - pause / seek-while-paused / end → `detectDisplayedFrame()`: waits for an idle gate, then `captureDisplayedFrame()` (waits for a presented frame, retries); the paused frame is never dropped;
  - `seeking` event → `epoch++`, `hold.clear()`: results from before the seek are discarded.
- **Worker** (`inference.worker.ts`): `modelPlan` (backend + file choice) → `ortRuntime` (loads WebGPU or WASM ORT build) → `modelCache` (Cache API, SHA-256 verified, progress) → WebGPU warm-up run → per frame: rect letterbox (GPU canvas for `VideoFrame`, CPU `willReadFrequently` canvas for `ImageBitmap`) → ORT → `decodeYoloV8` (score floor 0.05) → class-aware NMS → boxes **normalized 0..1 of the source frame** (`Detection {classId, score, box}`).
- **Filtering on the main thread:** `filterDetections(raw, confidenceThreshold, classMask)`. Equivalent to filtering before NMS (tested), so the confidence slider and class toggles never trigger a new inference. Changing IoU or input size re-runs detection; changing model size or backend reloads the model.
- **Settings:** `SettingsSchema` is the single source of truth (typed complete mapping; the panel is generated from it). `ClassSelectionStore` holds enabled classes (default People/Animals/Transportation).
- **Test hooks in the DOM** (used by `scripts/e2e/*`): `.counts-panel[data-revision]` (increments per render), `.model-status[data-state=loading|ready|error]`, `.media-stage[data-draw-time|data-result-time|data-boxes]`.

### Extension points already prepared for Phase 4

| where                              | what is there                                                                                                                                                                                                            |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/tracking/AssignmentSolver.ts` | Hungarian `solveAssignment(cost: number[][]) → col per row or -1`. Matrix must be **finite**; use a large finite "gated out" cost and reject assignments at that cost. Tested vs. brute force.                           |
| `src/utils/geometry.ts`            | `Box` (top-left origin), `intersectionOverUnion`.                                                                                                                                                                        |
| `src/settings/SettingsSchema.ts`   | `confirmationFrames` (default 3, range 1–10, Advanced, **provisional**), `lostBufferSeconds` (default 1 s, 0–5, Advanced, **provisional**), `showTrackIds` (Debug), `showRawDetections` (Debug), `maxInferenceFps` (30). |
| `src/ui/CountsPanel.ts`            | `render({totalTitle, total, current?, currentMessage?, message?, busy?, canReset?})`, `onReset(handler)`; Reset button already built, hidden unless `canReset`.                                                          |
| `src/ui/ClassGroupPanel.ts`        | `setNote(text)`: for "earlier counts are not recomputed" (unused so far).                                                                                                                                                |
| `src/app/App.ts`                   | `VIDEO_TOTAL_MESSAGE` placeholder in `renderVideoCounts()`; `updateLayer(time)` currently draws `DetectionHold` boxes for video.                                                                                         |
| `src/app/RealtimeVideo.ts`         | `run()` receives each `DetectResult`; `seeking` handler is where a tracker reset belongs.                                                                                                                                |
| `src/rendering/DetectionLayer.ts`  | Draws `Detection[]` (+ dashed raw boxes). Needs a track-ID label option; keep it data-only (no import from tracking logic).                                                                                              |
| `src/counting/countDetections.ts`  | `countByClass`, `summarize` ("3 people, 2 dogs, 1 car").                                                                                                                                                                 |

## 6. Environment and setup (new machine or fresh clone)

- Machine used so far: Apple M4 Max, macOS, Node 24.16 (needs ≥ 22.12), Chrome 154 at `/Applications/Google Chrome.app` (override with `CHROME_PATH`). The project path contains spaces and Korean characters; everything works with it, but quote paths in shell commands.
- `npm ci` (or `npm install`). `node_modules/`, `dist/`, `.cache/`, `test-vid/`, `test-img/`, `old/`, `.venv-export/` are gitignored.
- **`test-vid/`** (7 clips, local only, not redistributable): `moving_car.mp4` (1080p, 19.7 s, street intersection, cars/trucks/bus), `moving_drone.mp4` (4K 24 fps, 20.8 s, aerial parking lot, many cars + people), `moving_drone-2.mp4` (4K, 38.3 s, aerial park, courts, parking), `moving_handheld.mp4` (1440p, 14.3 s, woman walking toward camera on a field path), `moving_handheld-2.mp4` (4K, 9 s, bus shelter, pedestrians, passing cars), `steady.mp4` (1440p, 18.3 s, person + dog, strong backlight, low camera), `steady-2.mp4` (720p, 15.7 s, dense highway seen from a bridge, cars/trucks/motorcycles). All H.264, ~30 fps.
- **`test-img/`** (3 stills; recreate if missing):

  ```bash
  mkdir -p test-img
  ffmpeg -y -ss 2.0 -i test-vid/moving_car.mp4 -frames:v 1 -q:v 2 test-img/moving_car_t2.0.jpg
  ffmpeg -y -ss 1.0 -i test-vid/steady-2.mp4  -frames:v 1 -q:v 2 test-img/steady-2_t1.0.jpg
  ffmpeg -y -ss 4.9 -i test-vid/steady.mp4    -frames:v 1 -q:v 2 test-img/steady_t4.9.jpg
  ```

- **Python export venv** (only needed to re-export models, run `npm run bench`'s model set, or `compare_variants.py`; **not needed for Phase 4**): the one used in Phases 1–3 lived in a temporary directory and is gone. Recreate per [scripts/export-model.md](../scripts/export-model.md): `python3 -m venv .venv-export && .venv-export/bin/pip install -r scripts/requirements-export.txt`. The committed `public/models/*.onnx` are what the app uses; rebuilding them must reproduce the SHA-256s in `manifest.json`.
- **Benchmark candidate models** live in `.cache/models-bench/` (gitignored; `npm run bench` needs them: `python scripts/export_models.py --set benchmark`).

### Commands

```bash
npm run dev                         # Vite dev server (COOP/COEP headers)
npm run build / preview             # tsc --noEmit + vite build / serve dist/
npx tsc --noEmit && npm run lint && npm run test && npx prettier --check .   # the gate
npm run e2e -- --build              # image flow in real Chrome on the production bundle (reports in .cache/e2e/)
npm run e2e:video -- --build        # video flow: 3 clips × WebGPU/WASM × 15/30 fps, pause/seek checks
npm run bench -- --plan smoke       # Phase 1 ORT benchmark (needs .cache/models-bench/)
```

`scripts/*.ts` run with Node's type stripping (no tsx): erasable TS only, `import type`, `.ts` extensions in imports.

## 7. Regression baselines (should still hold after Phase 4)

**Image counts** (default classes, confidence 25%; WebGPU = WASM). Fast = YOLOv8n, Accurate = YOLOv8s:

| still                 | Fast                                       | Accurate                                         |
| --------------------- | ------------------------------------------ | ------------------------------------------------ |
| `moving_car_t2.0.jpg` | 4 cars, 1 bus, 1 truck                     | 4 cars, 2 buses, 2 trucks                        |
| `steady-2_t1.0.jpg`   | 17 cars, 2 people, 1 bus, 1 truck          | 18 cars, 4 trucks, 1 bus, 1 motorcycle, 1 person |
| `steady_t4.9.jpg`     | 1 horse, 1 person (the "horse" is the dog) | 1 dog, 1 person                                  |

**Video** (production build, M4 Max, YOLOv8n): WebGPU at 30 fps cap reaches 26–30 inference FPS (6–12% samples dropped, latency 12–18 ms, 0 dropped video frames); WASM ×8 reaches ~17–18 FPS (~40% dropped); at 15 fps cap both reach 15 with 0% dropped. 0 stale boxes after seeks; paused frame result's media time equals the displayed frame's. Details: [benchmarks.md](benchmarks.md), "Phase 3".

Unit tests: **90 passing** at the end of Phase 3.

## 8. Phase 4: plan

**Contract** ([BRIEF.md](BRIEF.md), Phase 4 + Counting rules): tracker with persistent per-class IDs (carrying `classId`, `label`, `confidence`), confirmation logic, always-visible **Total** section, **Reset counts**, tracker settings in Advanced, optional track-ID labels (Debug toggle). Output: unique totals per class; tests for association, confirmation, lost handling, counting; **`docs/clip-counts.md`**. Done when totals on the test clips are stable and not inflated by flicker, `clip-counts.md` exists, and known limitations (ID switches, re-entry counting) are in `CLAUDE.md`.

### Design (from decisions.md §6, plus the user's class decision)

- **ByteTrack-style, no DOM, in `src/tracking/`.** Runs on the main thread (tens of boxes per frame; cheap). Keep it pure so it could move into the worker later.
- **Motion model:** constant-velocity Kalman filter on box center, aspect ratio and height (and their velocities). Time base is **media time in seconds** (frames are sampled at a variable rate; `dt` varies); non-monotonic time means a seek, so reset.
- **Association, two stages (Hungarian via `solveAssignment`):**
  1. Detections with score ≥ the user's confidence threshold are matched to all live tracks by IoU against the Kalman-predicted box.
  2. Low-score detections (score from ~0.1 up to the threshold) can only **extend unmatched existing tracks**. They are never drawn or counted.
  - **Cross-class (user decision):** matching ignores class but applies an **IoU penalty when classes differ**, so a flickering dog/horse stays one track. The penalty size and the gates are internal constants (not UI settings); document them.
- **Track states:** tentative → confirmed (after `confirmationFrames` hits) → lost (kept for `lostBufferSeconds` of media time) → removed.
- **Track data:** `id`, `classId`, `label`, `confidence`, per-class vote counts, box (normalized), velocity, hits, first/last seen, state, `counted`.
- **Class filtering:** disabled classes are dropped **before** the tracker (decisions.md §5). A class-selection change takes effect from that moment: tracks of newly disabled classes are dropped; existing totals stay visible but are marked "not counting"; the UI states earlier counts are not recomputed (use `ClassGroupPanel.setNote`).
- **Smooth overlay:** for video, draw confirmed/tentative tracks' **Kalman-predicted boxes at the displayed media time** instead of held detections (replaces `DetectionHold` for the main overlay; keep it for the Debug "raw detections" view). This removes the 33–67 ms box lag measured in Phase 3.
- **Paused frame:** "Current frame" counts stay the per-class count of **detections in the displayed frame** (not tracks), as the brief says. Paused-frame detections must **not** feed the tracker or the totals (otherwise pausing/seeking would double-count).
- **Total section:** always visible for video; per-class count of confirmed tracks; Reset counts clears totals and tracks.
- **Debug:** track IDs on boxes (`showTrackIds`), raw detections before tracking (existing), plus tracker stats (live/lost/confirmed counts) in `DebugReadout`.
- **Settings:** `confirmationFrames` and `lostBufferSeconds` already exist in the schema; replace the "provisional" defaults with values **chosen from testing on the clips** and record the evidence in `clip-counts.md`.

### Open questions: ask the user first, in one batch (recommended option first)

1. **Class per track and counting moment.** Proposed: each track's class = majority vote of its detections; a track is counted **once, at confirmation, under its majority class at that moment**; later class changes never change totals. (Alternative: re-attribute on change, which makes totals fluctuate.)
2. **Seek / rewind / replay in realtime mode.** Seeking invalidates tracks (the scene jumps). Proposed: **clear tracks on any seek, keep totals**, document that rewinding or replaying counts objects again, and point users to **Reset counts**. (Alternatives: freeze totals while behind the furthest-played time; reset on any backward seek.) Pre-analysis (Phase 6) gives deterministic totals for files anyway.

### Known risks to measure and document (do not hide them)

- **Moving-camera clips** (`moving_*`): there is no camera-motion compensation (it was part of the dropped OpenCV code). Expect many ID switches and double counts there; measure, document in `clip-counts.md` and `CLAUDE.md`. Adding OpenCV is forbidden; any mitigation must be lightweight and discussed first.
- **Class flicker:** YOLOv8n labels the dog in `steady.mp4` as "horse" and a lens flare as "frisbee" (Sports not enabled by default); riders on motorcycles are often "person" with duplicate boxes. These are the test cases for the cross-class association.
- **Re-entry counting:** an object that leaves and returns after the lost buffer is counted again (known limitation per the brief); expose the lost buffer in Advanced and document it.
- **Low sampling rate:** if the inference rate drops (slow device), `dt` grows and association gets harder; the lost buffer is in seconds for this reason.
- **Small objects in 4K drone footage:** many small cars near the confidence threshold flicker in and out; confirmation N and the low-score second stage are the main levers.

### Suggested work order

1. Ask the two open questions. 2. Pure modules + unit tests first (Kalman filter, IoU-with-class-penalty cost matrix, association stages, track lifecycle, counting, scripted-detection scenarios: flicker, occlusion gap, re-entry, seek reset, class disable/enable, reset counts). 3. Integrate in `RealtimeVideo`/`App` (feed only forward-played sampled frames; reset on seek; Total section; Reset button; Kalman-predicted overlay; ID labels in `DetectionLayer`; Debug rows). 4. Extend `scripts/e2e` with a clip runner that plays each clip to the end at 1× (≈ 136 s per configuration for all 7 clips), logs per-track data (id, class, first/last time, hits, counted) and screenshots with IDs at intervals; use it to pick `confirmationFrames` / `lostBufferSeconds` defaults (try N = 1, 3, 5 and lost buffer 0.5 / 1 / 2 s). 5. Write `docs/clip-counts.md`: for each of the 7 clips, totals per class, plus ID switches / double counts observed (view the ID screenshots; say what the footage actually contains so the user can compare), and caveats from model mistakes. 6. Update `CLAUDE.md` (architecture, known limitations), `decisions.md` (§6 final), `benchmarks.md` (tracker cost per frame, if measurable). 7. Run the full gate, `npm run e2e -- --build`, `npm run e2e:video -- --build`; confirm Section 7 baselines still hold. 8. Phase report in the 5-part format, with the not-verified list.

## 9. Gotchas learned (save yourself the debugging)

- **TypeScript is pinned to `~6.0.3`** because typescript-eslint 8.x supports `<6.1`. onnxruntime-web is pinned to **exactly 1.30.0** (all measurements and the FP16 recipe depend on it).
- **Chrome cannot capture a paused video frame that was never presented:** `new VideoFrame(video)` fails ("Invalid source state") and `createImageBitmap(video)` fails too, even at `readyState` 4. `VideoSource.captureDisplayedFrame()` waits for the next `requestVideoFrameCallback` and retries. `new VideoFrame(video)` must be created **synchronously** inside the rVFC callback to get exactly that frame.
- **Canvas split in the worker:** GPU canvas for `VideoFrame`s (decoded frames live on the GPU; a CPU canvas makes Chrome read back the whole 4K frame, ~15 ms), CPU `willReadFrequently` canvas for `ImageBitmap`s. The GPU path resamples differently and shifted one borderline detection on stills.
- **ORT:** WebGPU build = `onnxruntime-web/webgpu` + asyncify wasm; WASM build = `onnxruntime-web/wasm`; wasm URLs come from Vite `?url` imports. Silence the expected "shape ops on CPU" warning with `logSeverityLevel: 3` in session options. WebGPU needs a warm-up run (first run ~240 ms) which the worker does while "Preparing the model" shows. 16 WASM threads is slower than 8; default = clamp(cores/2, 1, 8).
- **FP16 conversion recipe** (`scripts/export_models.py`): clear `value_info` first, exclude the graph's own `Cast` nodes for dynamic exports, strip `date` metadata and `value_info` afterwards; this is what makes exports byte-reproducible. Ultralytics' native `half=True` gives FP16 inputs (rejected). In-graph NMS and INT8 were rejected by measurement.
- **Seek landing:** a seek lands on the frame at or just before the target (up to one frame early); e2e checks tolerate that.
- **happy-dom:** a checkbox in a disconnected DOM tree fires no `change` on `click()`; attach the panel to `document.body` in tests.
- **Editing habit:** run Prettier before exact-string edits (Prettier reformats and breaks later `replace` anchors), or re-read the file first. A bare `cat > file` without a heredoc hangs the shell.
- **e2e scripts must run from the repo root** (module resolution of `puppeteer-core`, `vite`). Headless Chrome with `--enable-unsafe-webgpu --use-angle=metal` gets real WebGPU on this Mac.
- Vitest is v5 (`// @vitest-environment happy-dom` for DOM tests); ESLint 10; Vite 8.

## 10. Not yet verified / open items (carry forward)

- Weaker hardware, integrated GPUs, Windows/Android; GPUs without `shader-f16` (the FP32 yolov8n fallback and the "yolov8s → WASM" rule are a precaution, untested).
- Headed (visible) Chrome smoothness; playback longer than ~10 s per run; very long videos / 500 MB files (size check only unit-tested).
- The **Retry** button after a real model-load failure; running with WebGPU completely absent (only the forced-WASM setting was exercised).
- WebGPU IO binding / GPU tensors: deferred to Phase 7 (saving ≤ ~1 ms here; graph capture conflicts with dynamic shapes).
- Phase 7 to-dos: `vercel.json` (COOP/COEP + immutable cache for `/assets/*`; verify with `curl -I` after the first deploy), `THIRD_PARTY_NOTICES` (onnxruntime-web is MIT), full README, `docs/performance.md`, pre-commit checklist, final CLAUDE.md. Repo rename question (unanswered).
- Phase 5 notes: webcam `InputSource` + device picker; 1080p/24 fps from one config object; `MediaStreamTrackProcessor` only if measurably better than rVFC; the realtime pipeline (`RealtimeVideo`, tracker, totals, Reset) should be reused as-is.
- Phase 6b (added by the user 2026-10-03, after Phase 6, before Phase 7): camera-motion compensation spike, plan in [decisions.md](decisions.md) §12. Pure TypeScript, no OpenCV; worker estimates global translation (+ scale) on a ~160×90 downscale with detected boxes masked; `Tracker.update` shifts predicted boxes; record the estimates in the clip runner and compare by offline replay; go/no-go on the numbers. Old V2 estimators in `old/src/analysis/` are reference only.
- Phase 6 notes: Realtime / Pre-analysis selector; `AnalysisCache` interface with an in-memory implementation; playback locked until complete; decide (and tell the user) whether Stop discards or keeps a partial result (keep playback locked either way); "Settings changed, re-analyze" prompt; WebCodecs decoding evaluation; deterministic totals per cache. The class-filtering decision in decisions.md §5 (cache holds enabled-class detections only) was proposed there with an alternative (cache all classes), so mention it again.
