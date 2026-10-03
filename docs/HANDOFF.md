# Handoff: Object Counter V3

**Written 2026-10-03, at the close of Phase 6.** Read this first when resuming; start a session with [CONTINUE-PROMPT.md](CONTINUE-PROMPT.md).

## 1. State

| phase | content                                                        | status                      |
| ----- | -------------------------------------------------------------- | --------------------------- |
| 0–3   | scaffold, model/runtime spike, image detection, realtime video | approved, committed         |
| 4     | tracking + total counts                                        | approved 2026-10-03         |
| 5     | webcam                                                         | approved 2026-10-03         |
| 6     | pre-analysis mode                                              | approved 2026-10-03         |
| **7** | **tracking quality check + overhaul** (inserted by the user)   | **next: ask options first** |
| 8     | performance pass + release (the brief's Phase 7)               |                             |

Branch `V3`, remote `github.com/dtcph/Video-analyzer` (public). The user commits; Phase 6 is in the working tree, ready to commit.

## 2. Read, in this order

1. [CLAUDE.md](../CLAUDE.md): commands, layering, module map, known limitations.
2. [BRIEF.md](BRIEF.md): original requirements, verbatim. Decisions below override it.
3. [decisions.md](decisions.md): §12 (Phase 7 candidates) first; §6 tracker, §13 webcam, §14 pre-analysis.
4. [clip-counts.md](clip-counts.md): per-clip totals and failure analysis (the Phase 7 baseline).
5. [benchmarks.md](benchmarks.md): all measurements.

## 3. Working agreements

- Phase by phase: stop at the end, give the 5-part report (what changed; verified / NOT verified; numbers; unsure points and reversible decisions; next step), wait for approval.
- Never make git commits. Never touch `old/` (read-only reference archive). Never add OpenCV.
- After every change set: `npx tsc --noEmit && npm run lint && npm run test && npx prettier --check .`
- Do not change counting rules silently. Check library APIs against the installed version. One sentence of justification per new dependency; ask before any UI framework.
- **Questions:** one batch, recommended option first; the user answers briefly. **In a discussion or suggestion turn, do not edit code.**
- Replies concise, with markdown file links (VS Code). Pronouns: they/them.

## 4. User decisions (override the brief)

| topic           | decision                                                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Models, hosting | Model files committed (`public/models/`, SHA-256 in `manifest.json`). Vercel, deployed by the user (Phase 8). Copyright "Paul". |
| Class flicker   | Associate across classes, IoU − 0.2 on a class mismatch.                                                                        |
| Counting        | Majority-vote class (score-weighted); counted once at confirmation; the count follows the majority class (sum unchanged).       |
| Seek / replay   | Any seek clears tracks, keeps totals; replaying counts again; Reset counts clears both.                                         |
| Tracker         | Confirmation 3 frames, lost buffer 2 s (chosen on the clips). Max inference rate 30 fps.                                        |
| Webcam          | Pause freezes + Current frame (tracker skips the paused time); not mirrored; Stop keeps totals.                                 |
| Pre-analysis    | Stop keeps a resumable partial (locked); cache holds all classes; Realtime is the default mode; sampling capped by the rate.    |
| Phase 7         | Tracking quality check + overhaul: camera motion, occlusion, misclassification (book → cell phone), every helper. Ask first.    |

## 5. Phase 7: how to start

1. **Ask in one batch** which options to build ([decisions.md](decisions.md) §12), recommended first: ground-truth labels (needs the user's help), occlusion-aware lost handling, observation-centric re-update (OC-SORT), color-histogram appearance, camera-motion compensation (pure TS, global shift on a ~160×90 downscale with detections masked), misclassification measures (YOLOv8s default, per-class thresholds, input size), learned ReID (pre-analysis only), offline tracklet stitching (would lower totals: a counting-rule change, needs approval).
2. **Measure before/after** with what exists: `npm run e2e:clips` records detections per clip; `node scripts/e2e/sweepTracker.ts --label reattr-webgpu-30` replays them through the tracker offline (recordings kept in `.cache/e2e/clip-counts/`). Image-based options (camera motion, appearance) need the runner to record those per frame too.
3. Update `clip-counts.md` with before/after per clip.

## 6. Environment

- M4 Max, macOS, Node 24.16 (≥ 22.12), Chrome 154 (`CHROME_PATH` overrides). The path has spaces and Korean characters: quote it.
- Gitignored: `node_modules/ dist/ .cache/ test-vid/ test-img/ old/ .venv-export/`.
- `test-vid/`: 7 H.264 clips (~30 fps), described in [clip-counts.md](clip-counts.md) §1. `test-img/` (3 stills) if missing: `ffmpeg -y -ss 2.0 -i test-vid/moving_car.mp4 -frames:v 1 -q:v 2 test-img/moving_car_t2.0.jpg`, and the same for `steady-2` at 1.0 s and `steady` at 4.9 s.
- Python export venv only for re-exporting models: [scripts/export-model.md](../scripts/export-model.md).

## 7. Regression baselines

- Unit tests: 164. On the build: `e2e` (image counts below), `e2e:video` (0 stale draws, paused frame exact, 0 dropped video frames), `e2e:counts` 6/6, `e2e:webcam` 15/15, `e2e:pre` 15/15.
- Image counts, Fast / Accurate: moving_car 4 cars, 1 bus, 1 truck / 4 cars, 2 buses, 2 trucks; steady-2 17 cars, 2 people, 1 bus, 1 truck / 18 cars, 4 trucks, 1 bus, 1 motorcycle, 1 person; steady 1 horse, 1 person / 1 dog, 1 person.
- Realtime WebGPU at the 30 fps cap: 25–30 inference fps; WASM ~17–20. Pre-analysis: 3.4–3.8× realtime (WebGPU), 1.4–1.8× (WASM).

## 8. Gotchas

- TypeScript pinned `~6.0.3` (typescript-eslint 8 needs < 6.1); onnxruntime-web pinned `1.30.0`; mediabunny `1.61.0` (lazy chunk).
- `new VideoFrame(video)` only works for a presented frame and must be created synchronously inside the rVFC callback; `captureDisplayedVideoFrame` waits and retries.
- Worker: GPU canvas for `VideoFrame`s, CPU canvas for `ImageBitmap`s. WebGPU needs a warm-up run; 8 WASM threads beat 16.
- Rotation: `new VideoFrame(video)` carries it, decoded WebCodecs frames do not: re-wrap with `{rotation, flip}` (missing from TS 6's `VideoFrameInit`). Test files: `transpose` + `-display_rotation` mimics a phone.
- Camera streams: the clock runs on while paused; `track.stop()` fires no `ended`. Fake camera: `--use-fake-device-for-media-stream[=device-count=2]`, `--use-fake-ui-for-media-stream`, `--use-file-for-fake-video-capture=<mjpeg>` (ignores device-count).
- In-page `import("/src/…")` on the dev server makes Vite's optimizer reload the page once: load, wait, reload, then evaluate.
- Run Prettier before exact-string edits (it breaks anchors). Never run a bare `cat > file` (hangs). e2e scripts run from the repo root. macOS has no `timeout`.
- happy-dom: a disconnected checkbox fires no `change` on `click()`.

## 9. Not verified / open

- Real camera, real unplugging, mobile; weaker or integrated GPUs, no `shader-f16`, Windows/Android; headed Chrome; long or 500 MB files; WebM/MKV, HEVC, AV1; WASM determinism; Retry after a real model-load failure.
- Phase 8 to-dos: `vercel.json` (COOP/COEP + immutable `/assets/*`, check with `curl -I`), `THIRD_PARTY_NOTICES` (onnxruntime-web MIT, mediabunny MPL-2.0), README, `docs/performance.md`, pre-commit checklist, final CLAUDE.md, WebGPU IO binding (≤ 1 ms). Repo rename: unanswered.
