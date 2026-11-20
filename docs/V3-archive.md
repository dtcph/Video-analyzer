# V3 archive: Object Counter

V3 is finished and deployed (https://video-analyzer-sable.vercel.app/, Vercel; Phases 0–8 approved, V3 merged into `main`). This file condenses what the old V3 docs held; the full texts are in the git history (commit `414f26f` and earlier: `HANDOFF`, `decisions`, `performance`, `benchmarks`, `clip-counts`, `release-checklist`, `reuse-audit`, `CONTINUE-PROMPT`). Original requirements: [BRIEF.md](BRIEF.md) (verbatim).

All measurements: one machine (M4 Max, Chrome 154, headless). **Nothing was measured on weaker hardware, phones, Windows or headed Chrome.**

## 1. What V3 does

YOLOv8 (ONNX, onnxruntime-web) in a worker on an image, a video (Realtime or Pre-analysis) or the webcam. Boxes on the media; counts next to it: **Total** (unique confirmed tracks per class) and **Current frame** (paused only). No backend, persistence or export. Architecture: [CLAUDE.md](../CLAUDE.md).

**Defaults:** model "Auto" (YOLOv8s on WebGPU with `shader-f16`, else YOLOv8n); confidence 35%; confirmation 3 frames; lost buffer 2 s; max 30 fps; input 640 long side, rect letterbox. Class groups on load: People, Animals, Transportation.

## 2. Decisions and why

- **Runtime:** ORT-Web 1.30.0. Native WebGPU EP, else plain WASM (SIMD, `clamp(cores/2, 1, 8)` threads; 8 beat 16). Each build loads on demand, inside the worker. Falls back to WASM once if WebGPU session creation fails.
- **Models** (committed in `public/models/`, SHA-256 in `manifest.json`, 41.4 MB; export reproducible: [scripts/export-model.md](../scripts/export-model.md)): `yolov8n`/`yolov8s`, dynamic H/W, FP16; an FP32 yolov8n for GPUs without `shader-f16`. FP16 halves the download at no speed cost; INT8 was slower on WASM and less accurate; dynamic shapes cost nothing. The Cache API stores models keyed by file name + hash.
- **Postprocess:** export without NMS; decode + greedy class-aware NMS in JS (0.4 ms). In-graph NMS was slower and fixed the IoU at export.
- **Class filter:** the worker returns everything ≥ 0.05; threshold and class mask apply on the main thread after the argmax, so sliders act instantly. Disabled classes never reach tracker, renderer or counters; their totals stay, marked "not counting".
- **Tracker** (pure TS, ByteTrack-style, ≤ 0.6 ms/frame): Kalman with variable time step; three-stage Hungarian association; **buffered IoU (+50% per side) for lost tracks** (−15…−28% on moving-camera clips); cross-class association with IoU − 0.2; cross-class duplicate suppression. Counted once at confirmation; the count follows the score-weighted majority class (sum unchanged, ties keep the class).
- **Seek / replay:** any seek clears tracks and keeps totals; replaying counts again; Reset counts clears both. Only forward-played frames feed the tracker, so pausing never adds counts.
- **Frames:** `FrameGate` = one in flight + the newest waiting. Sampling via `requestVideoFrameCallback`, capped at 30 fps. Boxes are drawn from the Kalman prediction at the displayed time. A paused frame is detected itself (waits for a presented frame: `new VideoFrame(video)` fails otherwise).
- **Webcam:** `WEBCAM_CONFIG` 1920×1080 @ 24 as `ideal`; rVFC + `VideoFrame` (same as files; `MediaStreamTrackProcessor` measured no better). Pause freezes and shows Current frame; `Tracker.skip()` shifts track times over a pause. Not mirrored; Stop keeps totals; camera switch drops tracks; typed error messages for denied, missing, busy, gone, no HTTPS.
- **Pre-analysis:** WebCodecs decoding via **mediabunny 1.61.0** (lazy chunk; MPL-2.0), ~25× faster than seeking a `<video>`. Every frame, two in flight. Cache holds all classes (confidence/class/tracker changes only re-run tracking: ~33 ms). State machine idle → running → stopped ⇄ running → complete; any setting change → stale → Re-analyze. Stop keeps a resumable partial and locks playback. Decoded frames are re-wrapped with `{rotation, flip}`. Deterministic totals. Realtime is the default mode.
- **Hosting:** Vercel Hobby (100 MB static limit, `dist/` ≈ 82 MB: no room for more model variants). `vercel.json`: COOP/COEP (without them WASM is single-threaded, ~6× slower) and immutable caching of `/assets/`. Footer links the deployed commit and the third-party notices.
- **License:** AGPL-3.0 (Ultralytics YOLOv8), "Copyright (C) 2026 Paul", public repo `github.com/dtcph/Video-analyzer`, COCO credit in the README. `public/THIRD_PARTY_NOTICES.txt` (a test checks every runtime dependency), `public/ONNXRUNTIME_THIRD_PARTY_NOTICES.txt`. `test-vid/`, `test-img/` never committed.

## 3. Performance (production build)

- **Realtime at the 30 fps cap:** 30 inference fps and 0% dropped on WebGPU (Auto, Fast) and WASM. A frame takes ~13 ms on WebGPU (model run 9.5 ms); no main-thread long tasks. The waiting frame (Fix 1) lifted WASM from 18–26 fps and 12–41% drops to 30 fps and 0%: Chrome presents frames unevenly under CPU load and the app used to drop the frame after a short gap.
- **Pre-analysis** (worker preprocesses on arrival, two in flight): Auto 3.4–4.5× realtime, Fast 4.2–5.3×, WASM 1.5–1.9× (+17–44% on WebGPU, WASM unchanged). Totals identical before and after.
- **Model run (Phase 1):** YOLOv8n/s on WebGPU ~8.4 ms (latency-bound on this GPU), WASM 8 threads 18–20 ms (n) / 52–58 ms (s). Rect letterbox: 1.6× faster on WASM than square. Input 320/416 misses small objects (recall vs 640: 0.29 / 0.42).
- **First visit** at 50 Mbit/s 8.6 s (model 22.4 MB + WebGPU runtime 26.8 MB), reload 0.37 s. Run-to-run spread ±15%.
- **Not done:** parallel download (same bandwidth), GPU preprocessing / IO binding (≤ 3 ms, hidden behind the model run), realtime overlap (only helps GPUs slower than the video).

## 4. Counting quality

Fixed camera and large objects count well; moving cameras and dense scenes over-count (≈ 1.5–2×): on `moving_car` (YOLOv8s, 63 counts) ≈ 43 real objects, 10–12 concurrent duplicates (part boxes), ≈ 5 re-counts, 2–3 false positives. ID switches are a minor part. Small or distant objects are missed (26 pedestrians in `moving_car`: 0–6 counted). `steady.mp4`: a person shrinking from 67% to 15% of the frame height in ~2 s breaks the track, so each shot counts them twice. YOLOv8n confuses dog/horse/cow; YOLOv8s does not (and finds 13 instead of 2 motorcycles on `steady-2`, with phantom bird/sheep on `moving_drone-2`).

- **Confirmation N = 3:** N = 1 counts flicker (1.3–2.7× totals, phantom classes), N = 2 still +10–50%, N ≥ 4 drops real brief objects. **Lost buffer 2 s** beats 1 s on every clip; 3 s adds nothing.
- **Confidence 35%** beat 25% (duplicates) and 60% (misses real cars) for both models against the user's ground truth (`moving_car` 33–34 car, 10 truck, 3 bus, 3 motorcycle, 26 person; `moving_handheld-2` 10 car, 2 truck, 1 motorcycle, 3–4 person; `steady` 2 person, 2 dog). Cars at 35%: YOLOv8s 36 / 11 vs truth 33–34 / 10.
- **Project stance (2026-11-20):** a re-count after occlusion is acceptable, since the project shows how many impressions reach us.

## 5. Tried and dropped (measured, replay of recorded detections)

| idea                                                     | result                                                                                                   |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Camera-motion compensation (pure TS, 160 px thumbnail)   | totals −2…+4; the Kalman filter already predicts the slow pans; 3.5–5.7 ms/frame in the worker. Removed. |
| Occlusion-aware lost handling                            | ±1–4 per clip. Removed.                                                                                  |
| Contained-duplicate suppression (car/bus/truck ≥ 80%)    | −4 on `moving_car` at 25%, −1 at 35%; can hide a far vehicle behind a near one. Removed (user).          |
| Per-class minimum scores (horse/sheep/cow 50–60%, truck) | leave the dog as "horse"; moves 1–2 counts. Not built.                                                   |
| Strict per-class matching, penalty 0 / 0.5               | worse than 0.2 on most clips.                                                                            |

## 6. Ideas kept for later

- Observation-centric re-update after gaps (OC-SORT) for the fast scale change in `steady.mp4`; not measured.
- Larger inference input (> 640) for small objects: needs a schema option; not measured.
- Cheap appearance (color histogram) or learned re-ID to re-match lost tracks; offline tracklet stitching in pre-analysis (changes totals: needs approval; keep track pieces in the cache).
- Per-device default model by measured speed; GPU preprocessing for weak GPUs.
- Not verified: real camera and unplugging, mobile, integrated GPUs, no `shader-f16`, Windows/Android, headed Chrome, 500 MB files, WebM/MKV/HEVC/AV1, WASM determinism, Retry after a real model-load failure.
- Still open after deployment: record the real first-load time; check `.wasm`/`.onnx` compression on Vercel (`curl -sI -H 'Accept-Encoding: br, gzip' URL/models/yolov8s-640-dyn-fp16.onnx`). Headers, caching and the notices file passed on 2026-10-06.

## 7. Release checklist (short)

- Before committing: gate + `npm run build` (≈ 82 MB) + `e2e`, `e2e:video`, `e2e:counts`, `e2e:webcam`, `e2e:pre` with `-- --build`.
- In the commit: `LICENSE`, `README.md`, `public/models/*`, both notices files, `vercel.json`, source. Not in the commit: `old/`, `test-vid/`, `test-img/`, `dist/`, `node_modules/`, `.cache/`, `.venv-export/` (check `git ls-files | grep -E '^(old|test-vid|test-img|dist|\.cache)/'`).
- Vercel: import the repo, Vite preset, Node ≥ 22; `VERCEL_GIT_COMMIT_SHA` feeds the footer link.

## 8. Tools and environment

- `npm run e2e:clips -- --build [--model auto|n|s] [--backend wasm] --label x` records all clips to `.cache/e2e/clip-counts/<label>/`; `node scripts/e2e/sweepTracker.ts --label x [--switches|--truth|--detail clip.mp4|--every 2]` replays them with other tracker settings; `node scripts/e2e/profileFlow.ts --build [--pre|--load]` profiles per frame; `npm run e2e:pre -- --build --speed` times pre-analysis; `scripts/bench/` holds the Phase 1 bench.
- Baseline: 170 unit tests; `e2e*` all PASS. Image counts at 35% (Auto/YOLOv8s): moving_car 3 cars, 2 buses, 2 trucks; steady-2 16 cars, 4 trucks, 1 bus, 1 person; steady 1 dog, 1 person. YOLOv8n/WASM: 4 cars, 1 bus, 1 truck; 16 cars, 2 people, 1 bus, 1 truck; 1 horse, 1 person.
- `test-vid/` has 7 H.264 clips (~30 fps); `test-img/` is rebuilt with `ffmpeg -y -ss 2.0 -i test-vid/moving_car.mp4 -frames:v 1 -q:v 2 test-img/moving_car_t2.0.jpg` (same for `steady-2` at 1.0 s, `steady` at 4.9 s).
- The project path has spaces and Korean characters: quote it. Node 24 (≥ 22.12), `CHROME_PATH` overrides Chrome.

## 9. Gotchas

- TypeScript pinned `~6.0.3` (typescript-eslint 8 needs < 6.1); ORT-Web `1.30.0`; mediabunny `1.61.0`.
- `new VideoFrame(video)` works only for a presented frame, synchronously inside the rVFC callback; `captureDisplayedVideoFrame` waits and retries. It carries rotation; decoded WebCodecs frames do not (re-wrap with `{rotation, flip}`, missing from TS 6's `VideoFrameInit`).
- Worker: GPU canvas for `VideoFrame`s, CPU canvas for `ImageBitmap`s. WebGPU needs a warm-up run.
- Camera streams: the clock runs on while paused; `track.stop()` fires no `ended`. Fake camera flags: `--use-fake-device-for-media-stream`, `--use-fake-ui-for-media-stream`, `--use-file-for-fake-video-capture=<mjpeg>`.
- Vite dev: in-page `import("/src/…")` reloads the page once (load, wait, reload, evaluate). Run Prettier before exact-string edits. Never run a bare `cat > file`. e2e scripts run from the repo root. macOS has no `timeout`. happy-dom: a disconnected checkbox fires no `change` on `click()`.
- e2e hooks: `.media-stage[data-draw-time|data-result-time|data-boxes]`, `data-trace="1"` → `trackerupdate` events; `.counts-panel[data-revision]`, `.model-status[data-state]`, `.webcam-panel[data-state]`, `.analysis-panel[data-mode|data-status]`. DOM tests use `// @vitest-environment happy-dom`.
