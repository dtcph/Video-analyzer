# CLAUDE.md

Guidance for Claude Code in this repository. Keep it short and current; update it at the end of every phase. Reasoning belongs in `docs/`.

## Concept

**Object Counter (V3)**: a public, open-source, client-side website for study research. YOLOv8 (COCO, ONNX via onnxruntime-web) on an image, an uploaded video or a live webcam; boxes and labels over the media; counts per class: **Total** (unique confirmed tracks, always visible) and **Current frame** (paused only). Chrome/Chromium only; no backend, accounts, persistence, recording or export.

**Resuming? Read [docs/HANDOFF.md](docs/HANDOFF.md) first.** Requirements: [docs/BRIEF.md](docs/BRIEF.md). Reasoning: [docs/decisions.md](docs/decisions.md). Numbers: [docs/benchmarks.md](docs/benchmarks.md), [docs/clip-counts.md](docs/clip-counts.md).

Phases 0–8, each ending with a report and the user's approval. **0–6 done.** Next: **7** tracking quality check + overhaul (camera motion, occlusion, misclassification; options in decisions.md §12, ask first). Then **8** performance pass + release. Never make git commits: the user commits.

`old/` is the previous project (V1/V2 blob analyzer), gitignored and excluded from all tooling. **Never edit, import from, delete or commit it**; read it for reference only.

## Commands

```bash
npm run dev | build | preview   # Vite (dev and preview send COOP/COEP); build = tsc --noEmit + vite build
npx tsc --noEmit && npm run lint && npm run test && npx prettier --check .   # the gate, after every change set
npm run e2e         [-- --build]                    # image flow (test-img/), WASM + YOLOv8s, cache
npm run e2e:video   [-- --build]                    # realtime: 3 clips × WebGPU/WASM × 15/30 fps, pause/seek
npm run e2e:counts  [-- --build]                    # Total section: play, pause, seek, class change, Reset
npm run e2e:webcam  [-- --build] [--backend wasm]   # fake camera (steady-2 as MJPEG): all flows + errors
npm run e2e:pre     [-- --build] [--backend wasm] [--speed]   # pre-analysis flows; --speed: all 7 clips timed
npm run e2e:clips   [-- --build] [--backend wasm] [--label name]   # all clips to the end, records tracker input
node scripts/e2e/sweepTracker.ts [--label name] [--every 2] [--detail clip.mp4]   # offline tracker replay
npm run bench -- --plan smoke|full|rect|release     # Phase 1 ORT benchmark (needs .cache/models-bench/)
.venv-export/bin/python scripts/export_models.py --set release|benchmark   # see scripts/export-model.md
```

e2e reports and recordings go to `.cache/e2e/`. `scripts/*.ts` run with Node type stripping: erasable TS only, `.ts` import extensions. DOM tests use `// @vitest-environment happy-dom`. ESLint gives `src/` browser/worker globals only. TypeScript pinned `~6.0` (typescript-eslint 8).

## Architecture

**Inference, tracking, counting and analysis never touch the DOM; rendering never touches inference logic.** Data flows one way: input → inference (worker) → tracking → counting → rendering/ui; `app/App.ts` is the only module that knows everything.

```
settings/   SettingsSchema (THE source of truth: label, range, default, group main/advanced/debug),
            SettingsStore (nothing persisted), classGroups (9 groups), ClassSelectionStore (mask).
input/      ImageSource; VideoSource + VideoPlayer (file or camera stream); videoCapture (VideoFrame
            from a presented frame, waits/retries); WebcamSource + webcam.ts (WEBCAM_CONFIG, errors,
            device list); FrameSampler (rVFC, SampleRateLimiter); MediaFiles (upload validation).
inference/  inference.worker.ts + InferenceClient: modelPlan → ortRuntime → modelCache (SHA-256) →
            rect letterbox → ORT → decode (floor 0.05) → class-aware NMS → normalized Detections.
            FrameGate (one frame in flight), DetectionHold, postprocess (+ filterDetections).
analysis/   Pre-analysis: AnalysisCache (+ InMemory, all classes), TrackingRun (deterministic, re-runnable),
            analysisKeys (staleness none/tracking/full), PreAnalysisMachine (tested), PreAnalysisRunner
            (mediabunny + WebCodecs, lazy; frames re-tagged with the file's rotation).
tracking/   Tracker (ByteTrack-style, 3 stages, majority-vote class, DEFAULT_TUNING), BoxKalmanFilter,
            association (IoU − class penalty, buffered IoU for lost tracks, Hungarian AssignmentSolver).
counting/   countByClass, summary text, TotalCounter (count follows the majority class; inactive classes).
rendering/  OverlayRenderer (per presented frame, exact media time), DetectionLayer (#id labels), colors.
ui/         SettingsPanel (from the schema), ClassGroupPanel, CountsPanel, ModelStatusPanel, DebugReadout,
            UploadPanel, PlaybackControls (lockable), WebcamPanel, AnalysisPanel (mode, progress, Re-analyze).
app/        App (layout + wiring), RealtimeVideo (file or camera: sampling → gate → worker; seek → tracks
            cleared; live resume → Tracker.skip), PreAnalysisSession (cache, run, state machine).
bench/      Phase 1 spike (bench.html, dev only). utils/: geometry, format, math, RateMeter.
```

- **Detections:** the worker returns everything ≥ 0.05 after class-aware NMS; the main thread applies threshold and class mask (equivalent to filtering before NMS, tested), so slider and class changes need no inference. IoU / input size re-run detection; model size / backend reload the model. Boxes are top-left `{x, y, width, height}`, normalized to the source frame.
- **Realtime (video, webcam):** only forward-played samples feed the tracker; boxes while playing are tracks extrapolated to the displayed time; while paused, the frame's own detections (= Current frame). Reset counts clears totals and tracks; a class change drops tracks of disabled classes and marks their totals "not counting".
- **Pre-analysis (video files, opt-in):** every sample decoded and detected in order (3.4–3.8× realtime on WebGPU); playback locked until complete; then boxes, totals and Current frame come from the cache. Settings change → stale (cache kept) → Re-analyze (tracking-only or full).
- **e2e hooks:** `.media-stage[data-draw-time|data-result-time|data-boxes]`, `data-trace="1"` → `trackerupdate` events; `.counts-panel[data-revision]`, `.model-status[data-state]`, `.webcam-panel[data-state]`, `.analysis-panel[data-mode|data-status]`.

### Known limitations

- **ID switches re-count objects:** no camera-motion compensation yet (Phase 7): panning footage over-counts ~1.5–2×; occlusion + fast scale change breaks tracks (`steady.mp4`).
- **Re-entry** after the lost buffer (2 s) and **scene cuts** start new tracks; **seek/replay** counts again (realtime).
- **Class per track** = the model's majority over that track: YOLOv8n confuses some classes (dog → horse/cow, book → cell phone).
- **Small objects** (4K drone) are under-detected; slower devices confirm fewer brief objects (N counts frames).
- **Webcam pause** keeps IDs of objects that stayed put; moved ones get new tracks.
- **Pre-analysis** needs a container mediabunny reads (MP4/MOV, WebM/MKV) and a codec Chrome decodes; WebGPU (FP16) and WASM (FP32) totals differ slightly.

## Model, runtime, hosting

- `public/models/` (committed, reproducible, SHA-256 in `manifest.json`): `yolov8n-640-dyn-fp16.onnx` (default), `yolov8n-640-dyn.onnx` (FP32 fallback without `shader-f16`), `yolov8s-640-dyn-fp16.onnx` ("Accurate"). Default input 640, rect letterbox.
- onnxruntime-web **1.30.0 (pinned)**: WebGPU EP when available, else WASM with `clamp(cores/2, 1, 8)` threads (needs COOP/COEP).
- Vercel (user deploys, Phase 8: `vercel.json` with COOP/COEP). Hobby limit 100 MB; `dist/` ~82 MB: no extra model variants.

## Stack and rules

TypeScript, Vite 8, vanilla DOM/CSS, Canvas 2D, Web Workers, onnxruntime-web, mediabunny 1.61.0 (MPL-2.0, lazy chunk), Vitest 5, ESLint 10, Prettier, puppeteer-core (dev). Python only for model export (`scripts/requirements-export.txt`).

- New libraries only when they clearly help (one sentence of justification); ask before any UI framework; **never add OpenCV**; verify every API against the installed version.
- **License:** AGPL-3.0 (Ultralytics YOLOv8). README credits Ultralytics; copyright "Paul"; the footer links the public repo (`SOURCE_URL` in App.ts). Never ship model files or code without the notice.
- **Test media:** `test-vid/` (7 clips, several 4K) and `test-img/` (3 stills) are gitignored local media; never commit them.
