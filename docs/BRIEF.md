# Object Counter V3: the original brief (verbatim)

Saved from the user's first V3 message so it survives across sessions. This is the **requirements source of truth**. Where a later user decision changed something, it is recorded in [HANDOFF.md](HANDOFF.md) (section "User decisions") and [decisions.md](decisions.md); those override this text.

Notes on status, 2026-10-02: Phases 0–3 are done and committed. The brief's "Phase 0" step list mentions `old/` handling; that is complete.

---

## Goal

Build a new project, **Object Counter**, on top of YOLOv8, replacing the old motion/blob analyzer in this repository. The old code is archived into an ignored `old/` folder (Phase 0) and used only as a source to port reusable pieces from. The new commit history contains only what V3 needs.

Note: until Phase 0 replaces it, the `CLAUDE.md` at the repository root describes the OLD project. Treat it as reference only.

The result is a public, open-source website (for study research), client-side only (Chrome/Chromium, no backend), where the user can:

1. Provide an input: an uploaded **image**, an uploaded **video** (up to ~500MB, 1080p), or a **live webcam feed**.
2. See detected objects drawn **on top of the media** (bounding boxes + class labels).
3. See **count analytics next to the media**, for example "3 people, 2 dogs, 1 car":
   - **Total (always visible):** unique objects counted over the whole video / webcam session, per class.
   - **Current frame (shown only while paused):** objects visible in the paused frame, per class (for example "1 person visible").
4. Choose which classes to detect and count via **class groups** (People, Animals, Transportation, ...).

Realtime is preferred. If a device is too slow, degrade gracefully (lower inference rate) instead of failing.

## How to work

- Work phase by phase (Phase 0 to Phase 7). **Stop at the end of each phase**, give the Phase report, and wait for my approval before starting the next.
- The main engineering goal is efficiency: run YOLOv8 the most efficient way available in a browser, off the main thread, without blocking playback or UI.
- Stack: TypeScript, Vite, Canvas 2D, Web Workers. New libraries are allowed if they clearly help (for example onnxruntime-web); give one sentence per dependency on why it is worth it. Ask me before adding a UI framework.
- Layering rule: inference, tracking and counting logic never touch the DOM; rendering never touches inference logic.
- After every change set, `npx tsc --noEmit`, `npm run lint` and `npm run test` must pass. Unit-test pure logic: preprocessing/postprocessing, NMS, tracker, counting, class groups, settings, state machines.
- Check every library API against the installed version and its current documentation. Do not invent signatures.
- **Do not make git commits.** I commit myself after reviewing each phase. Leave changes in the working tree and tell me what is ready to commit.

### Phase report (end of every phase)

1. What changed (files/modules).
2. What you verified and how, and what you could NOT verify. Never claim verification you did not run.
3. Measured numbers where relevant: ms per frame (preprocess / inference / postprocess), effective FPS, dropped-frame ratio, active backend, on the test clips.
4. Unsure points and decisions I may want to reverse.
5. Recommended next step.

## Technical direction (confirm in Phase 1, then follow)

| Area             | Direction                                                                                                                                                                                                                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Model            | YOLOv8 (Ultralytics), COCO-pretrained, exported to ONNX. Default `yolov8n`; `yolov8s` selectable as "accuracy" if performance allows. Choose input size (640 vs. 320/416) by measurement.                                                                                                                          |
| Runtime          | `onnxruntime-web`: WebGPU execution provider when available, WASM (SIMD, multi-threaded if possible) fallback. Auto-select the backend and show which is active.                                                                                                                                                   |
| Precision / size | Evaluate FP16 (WebGPU) and INT8 (WASM) for speed vs. accuracy. Keep model files small.                                                                                                                                                                                                                             |
| Postprocessing   | Choose by measurement between export without NMS plus class-aware NMS in JS, and NMS inside the model.                                                                                                                                                                                                             |
| Preprocessing    | Letterbox resize in the worker (OffscreenCanvas), minimal copies. Evaluate WebGPU IO binding / GPU tensors if the installed ORT-Web supports them.                                                                                                                                                                 |
| Frame handling   | One frame in flight; drop frames when inference is slower than the video. Hold/interpolate boxes between inferred frames so overlays look smooth.                                                                                                                                                                  |
| Class filtering  | Decide whether disabled classes are filtered before or after tracking, and what that means for the pre-analysis cache and total counts. Report the decision.                                                                                                                                                       |
| Tracking         | Lightweight multi-object tracker (ByteTrack-style or IoU + Kalman), persistent IDs per class, carrying `classId`, `label`, `confidence`.                                                                                                                                                                           |
| Deployment       | Static hosting. Multi-threaded WASM needs cross-origin isolation (COOP/COEP). Recommend a specific host and explain how to get the headers there (a service-worker workaround such as coi-serviceworker may be needed where headers cannot be set). Cache the model after first load (Cache API / service worker). |
| License          | YOLOv8 code and Ultralytics weights are AGPL-3.0. The project is open source: publish under AGPL-3.0, include the `LICENSE` file from the first scaffold, and add a README section naming Ultralytics YOLOv8, AGPL-3.0, and linking its source. List anything else I must do for compliance.                       |

Model files live in `public/models/`. The export must be reproducible: commit the export script/commands (for example `scripts/export-model.md` or a script file) so anyone can regenerate the files. If the export cannot run in your environment, say so and propose an alternative source with checksum; do not use unverified third-party weights without telling me. Decide whether the `.onnx` files are committed or generated/downloaded, and tell me why.

## Counting rules

- **Total (always visible):** number of unique tracks per class over the session. A track counts once it is confirmed (seen in N frames; N is an Advanced setting, default chosen from testing) so that single-frame false positives and flicker do not inflate totals.
- Objects that leave and later reappear may be counted again. This is a known limitation: document it and expose the track-lost buffer in Advanced.
- **Current frame (paused only):** per-class count of detections visible in the displayed frame. Hidden while playing. For a still **image**, the frame's counts are the total and are labeled as such.
- Only enabled classes are detected, drawn and counted.
  - **Realtime and webcam:** a change in class selection applies from that moment on; the UI states that earlier counts are not recomputed.
  - **Pre-analysis:** a change in class selection is a settings change and triggers the "re-analyze" prompt (see Phase 6).
- **Reset counts** button clears totals and tracks (video and webcam).
- Do not change counting rules silently; report any change.

### Class groups

Checkable groups, each expandable to individual classes. Adjust if something fits better, and tell me.

| Group                    | Classes                                                                                                                           |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| People                   | person                                                                                                                            |
| Animals                  | bird, cat, dog, horse, sheep, cow, elephant, bear, zebra, giraffe                                                                 |
| Transportation           | bicycle, car, motorcycle, airplane, bus, train, truck, boat                                                                       |
| Street & outdoor         | traffic light, fire hydrant, stop sign, parking meter, bench                                                                      |
| Personal items           | backpack, umbrella, handbag, tie, suitcase                                                                                        |
| Sports                   | frisbee, skis, snowboard, sports ball, kite, baseball bat, baseball glove, skateboard, surfboard, tennis racket                   |
| Kitchen & food           | bottle, wine glass, cup, fork, knife, spoon, bowl, banana, apple, sandwich, orange, broccoli, carrot, hot dog, pizza, donut, cake |
| Furniture & household    | chair, couch, potted plant, bed, dining table, toilet, vase, scissors, teddy bear, hair drier, toothbrush, clock, book            |
| Electronics & appliances | tv, laptop, mouse, remote, keyboard, cell phone, microwave, oven, toaster, sink, refrigerator                                     |

Default on first load: People, Animals, Transportation.

## UI

- Layout: media stage (image/video/webcam with box + label overlay) with the stats panel next to it (below it on narrow screens). The panel has a Total section (always), a Current-frame section (paused only) and the Reset counts button.
- Box colors are consistent per class; labels show class and confidence.
- **Always visible:** input source, class groups, confidence threshold, model size (n / s).
- **Advanced** (collapsed on every load, state not persisted): NMS/IoU threshold, inference input size, max inference FPS, tracker parameters (confirmation frames, lost buffer), forced backend (auto / WebGPU / WASM).
- **Debug** (separate section): ms per stage, effective FPS, active backend, dropped frames, raw detections before tracking, track IDs on boxes (toggle).
- **Reset to defaults** button.
- Show model loading progress and clear errors: no WebGPU, model failed to load, camera denied, unsupported or oversized file.
- One typed settings schema is the single source of truth (label, range, default, group main/advanced/debug); generate the UI from it.

## Phase 0: Archive the old project and scaffold the new one

**Input:** the current repository (the old motion/blob analyzer), `test-vid/`.
**Task, in this order:**

1. **Safety check.** Run `git status`. If there are uncommitted changes, stop and tell me before touching anything.
2. **Archive.** Create `old/` and move the old project into it with plain filesystem moves (not `git mv`): everything at the repository root EXCEPT this keep-list: `.git/`, `.gitignore`, `.claude/` (if present), `test-vid/`, `node_modules/`, `dist/`, `old/`, and any prompt file I placed here for you. This includes `src/`, `scripts/`, `index.html`, `vite.config.ts`, `tsconfig*.json`, `package.json`, `package-lock.json`, `CLAUDE.md`, `README*`, lint/format configs and other dotfiles. After the move, delete `node_modules/` and `dist/` (they are regenerable); run a fresh install in step 5.
3. **Ignore it.** Add `old/`, `node_modules/`, `dist/`, `test-vid/` and `test-img/` to `.gitignore`. Run `git ls-files test-vid`: if clips are currently tracked, do NOT untrack them; report it to me and let me decide (the clips are large and may not be redistributable). Verify with `git status` that `old/` and `test-vid/` do not appear as untracked files and that the old root files show up only as deletions.
4. **Audit.** Read `old/CLAUDE.md` and the old source for reference only. Write `docs/reuse-audit.md` listing, per module, whether it is reused (video player, upload panel, layered canvas overlay renderer, worker client pattern, track manager concept, settings/UI patterns), adapted, or dropped (everything specific to motion/blob detection, OpenCV, camera-motion estimation). One line of reasoning per item.
5. **Scaffold.** Create the new project at the repository root: `package.json` (name `object-counter` unless I say otherwise), Vite + TypeScript, Vitest, ESLint + Prettier, `tsconfig.json`, `vite.config.ts` (including COOP/COEP dev headers), `index.html`, a source folder layout that matches the layering rule (inference / tracking / counting / rendering / ui / app / utils), `LICENSE` (AGPL-3.0), a short README stub, and scripts `dev`, `build`, `preview`, `test`, `lint`.
   - Configure `tsc`, ESLint, Prettier and Vitest to **exclude `old/`**, so archived code is never type-checked, linted, formatted, or run as tests.
   - `npm run test` must exit successfully: include at least one real unit test (for example for a ported pure utility) or configure Vitest to pass with no tests.
6. **Port.** Copy the modules marked reused/adapted from `old/` into the new layout and adapt them, removing every blob/motion/OpenCV dependency and dead code. Do not add OpenCV to the new project.
7. **Fresh CLAUDE.md.** Write a new `CLAUDE.md` for V3: concept, commands, layering rule, stack, license, and the instruction that `old/` is an ignored archive that must never be edited, imported from, or committed.

**Output:** `old/` archive, updated `.gitignore`, `docs/reuse-audit.md`, the new scaffold with ported modules, fresh `CLAUDE.md`.
**Done when:** `npm install` works on a clean tree; `npm run dev`, `npm run build`, `npx tsc --noEmit`, `npm run lint` and `npm run test` all pass; `git status` shows only the new/changed V3 files plus deletions of the old root files (nothing from `old/` or `test-vid/`); nothing under `src/` imports from `old/`; and I have reviewed the audit.

## Phase 1: Spike and decisions

**Input:** Phase 0 scaffold, `test-vid/`.
**Task:**

- Create test stills: extract 3 frames from different clips in `test-vid/` into `test-img/` (gitignored), choosing frames with clearly visible objects. Tell me which clips and timestamps.
- Export `yolov8n` to ONNX into `public/models/`, load it with onnxruntime-web in a worker, run it on the test stills on WebGPU and WASM, and measure ms per stage. Try the precision/size/NMS variants and record results in `docs/benchmarks.md`.
- Write `docs/decisions.md`: runtime config, model variant, input size, NMS approach, class-filtering approach, tracker, model-file handling (committed vs. generated), recommended host and header plan, license plan.
  **Output:** `test-img/`, `docs/benchmarks.md`, `docs/decisions.md`, export script/commands, a minimal working spike.
  **Done when:** the spike shows correct detections on the test stills in the browser, benchmark numbers exist for both backends, and I have approved `decisions.md`.

## Phase 2: Image detection end-to-end

**Input:** Phase 1 spike and decisions.
**Task:** `InputSource` abstraction (image / video / webcam; implement image now), inference worker with typed messages, preprocessing and postprocessing as pure functions, overlay renderer, class-group selection, confidence threshold, count panel (for an image, counts are the total), model download progress and caching.
**Output:** image upload -> detections -> overlay + counts; unit tests for letterbox math, box rescaling, NMS, class grouping.
**Done when:** for each still in `test-img/` you report the per-class counts shown, so I can compare them to the image; toggling class groups changes boxes and counts; all checks pass.

## Phase 3: Video, realtime

**Input:** Phase 2.
**Task:** video upload and playback with realtime inference alongside playback (one frame in flight, drop when busy), frame-synchronized overlay with held/interpolated boxes, play/pause, seek. Paused state shows the Current-frame section. Backend and FPS in Debug.
**Output:** realtime video analysis.
**Done when:** a test video plays smoothly while overlays follow objects; pausing shows the per-frame count; seeking leaves no stale boxes and does not crash; dropped frames are reported.

## Phase 4: Tracking and total counts

**Input:** Phase 3.
**Task:** tracker with persistent per-class IDs, confirmation logic, always-visible Total section, Reset counts, tracker settings in Advanced, optional track-ID labels (Debug toggle).
**Output:** unique totals per class; tests for association, confirmation, lost handling, counting; `docs/clip-counts.md` listing, for each clip in `test-vid/`, the reported totals per class and any ID switches or double counts you observed, so I can compare against the footage.
**Done when:** totals on the test clips are stable and not inflated by flicker, `clip-counts.md` exists, and known limitations (ID switches, re-entry counting) are documented in `CLAUDE.md`.

## Phase 5: Webcam

**Input:** Phase 4.
**Task:** webcam `InputSource` with device picker; handle permission denied, no camera, unplugged device; request 1080p at 24 fps from one config object (adjustable later); efficient capture (`requestVideoFrameCallback` baseline, `MediaStreamTrackProcessor` if measurably better); live totals with Reset; release the camera on stop. Live view only: no recording or export.
**Output:** live webcam analysis.
**Done when:** live detection, tracking and totals work; each error case shows a message; stopping releases the camera. If you cannot test with real hardware, say so and describe what you tested instead.

## Phase 6: Pre-analysis mode (video files)

**Input:** Phases 3-4.
**Task:**

- Selector Realtime / Pre-analysis for uploaded videos.
- Pre-analysis processes every sample in order (no dropping), with **Start / Stop buttons** and a **progress bar** (percent, frames done, elapsed, ETA), then plays back with overlays from an in-memory cache. Evaluate WebCodecs decoding for faster-than-realtime analysis.
- **Playback is locked until analysis completes.**
- Stop must leave a defined state: choose between discarding and keeping the partial result as incomplete, tell me which, and keep playback locked either way.
- Put the cache behind an `AnalysisCache` interface with an in-memory implementation so IndexedDB can be added later.
- If any setting (including class selection) changes after caching, keep the cache and show a "Settings changed, re-analyze" prompt with a **Re-analyze** button; only that button replaces the cache.
- Totals from pre-analysis are identical on every playback of the same cache.
  **Output:** pre-analysis flow, cache interface, state-machine tests (idle / running / stopped / complete / stale).
  **Done when:** a full video analyzes with correct progress and ETA, playback unlocks only on completion, final totals are shown from the start of playback, and re-analyze behaves as described.

## Phase 7: Performance pass and release

**Input:** Phases 0-6.
**Task:**

- Profile end to end and fix the top bottlenecks (copies, allocations, main-thread work, tensor reuse, threading). Record before/after in `docs/performance.md`.
- Finalize the settings UI (main / Advanced closed on load / Debug / Reset).
- Write the README: what it does, how to run, supported browsers, backend behavior, model and AGPL-3.0 notice, deployment steps including the COOP/COEP note, known limitations.
- Update `CLAUDE.md` so it matches the final architecture.
- Give me a pre-commit checklist: what should and should not be in the first commit (confirm `old/`, `test-vid/` and `test-img/` are ignored, model files handled per `decisions.md`, license file present).
  **Output:** README, `LICENSE`, `CLAUDE.md`, `docs/performance.md`, pre-commit checklist.
  **Done when:** `npm run build` produces a deployable static site, all checks pass, and image, video (both processing modes) and webcam work end to end.

## Constraints

- No backend, accounts, video export, recording, or persistence of results.
- Never edit, import from, delete, or commit anything in `old/`. I will delete it myself later.
- Never make git commits.
- Do not ship model files or code without the license notice.
- Do not start a phase before I approve the previous one.
