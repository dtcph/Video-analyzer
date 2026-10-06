# Handoff: Object Counter V3

**Updated 2026-10-06 at the close of Phase 8 (awaiting approval).** Read this first when resuming; start a session with [CONTINUE-PROMPT.md](CONTINUE-PROMPT.md).

## 1. State

| phase | content                                                        | status                      |
| ----- | -------------------------------------------------------------- | --------------------------- |
| 0–3   | scaffold, model/runtime spike, image detection, realtime video | approved, committed         |
| 4     | tracking + total counts                                        | approved 2026-10-03         |
| 5     | webcam                                                         | approved 2026-10-03         |
| 6     | pre-analysis mode                                              | approved 2026-10-03         |
| 7     | tracking quality check (inserted by the user)                  | approved 2026-10-06         |
| **8** | **performance pass + release** (the brief's Phase 7)           | **done, awaiting approval** |

Branch `V3`, remote `github.com/dtcph/Video-analyzer` (public). The user commits; Phase 8 is in the working tree. All phases of the brief are built; what remains is the user's deployment and its check (§5).

## 2. Read, in this order

1. [CLAUDE.md](../CLAUDE.md): commands, layering, module map, known limitations.
2. [BRIEF.md](BRIEF.md): original requirements, verbatim. Decisions below override it.
3. [decisions.md](decisions.md): §9 hosting, §10 license, §15 Phase 8.
4. [performance.md](performance.md): the Phase 8 profile and fixes; [release-checklist.md](release-checklist.md): commit, deploy, checks.
5. [clip-counts.md](clip-counts.md): per-clip totals, ground truth (§5); [benchmarks.md](benchmarks.md): all measurements.

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
| Phase 7         | Camera motion, occlusion handling, per-class thresholds and contained-duplicate suppression measured and dropped.               |
| Model default   | "Auto": YOLOv8s on WebGPU with `shader-f16`, YOLOv8n elsewhere (2026-10-06).                                                    |
| Confidence      | Default 35% (2026-10-06, was 25%; best for both models against the user's counts).                                              |
| Phase 8         | Fix top bottlenecks; footer links the deployed commit; static third-party notices; repo name kept; user deploys, sends the URL. |

## 5. After Phase 8: deployment check

The user deploys on Vercel ([release-checklist.md](release-checklist.md) §2) and sends the URL. Then: run the checks of §3 there (headers, caching, compression of the `.wasm` and `.onnx`, footer links), open the site and run image, video (both modes) and webcam, and record the real first-load time in [performance.md](performance.md) §5. Nothing else is planned; new work starts with questions in one batch.

Tools: `node scripts/e2e/profileFlow.ts --build [--pre | --load]` profiles; `npm run e2e:clips -- --build [--model auto|n|s] [--backend wasm] --label x` records; `node scripts/e2e/sweepTracker.ts --label x --switches | --truth | --detail clip.mp4` replays. Recordings in `.cache/e2e/clip-counts/`: `p7-webgpu` (YOLOv8n), `p7-webgpu-s` (YOLOv8s), `p8-wasm`.

## 6. Environment

- M4 Max, macOS, Node 24.16 (≥ 22.12), Chrome 154 (`CHROME_PATH` overrides). The path has spaces and Korean characters: quote it.
- Gitignored: `node_modules/ dist/ .cache/ test-vid/ test-img/ old/ .venv-export/`.
- `test-vid/`: 7 H.264 clips (~30 fps), described in [clip-counts.md](clip-counts.md) §1. `test-img/` (3 stills) if missing: `ffmpeg -y -ss 2.0 -i test-vid/moving_car.mp4 -frames:v 1 -q:v 2 test-img/moving_car_t2.0.jpg`, and the same for `steady-2` at 1.0 s and `steady` at 4.9 s.
- Python export venv only for re-exporting models: [scripts/export-model.md](../scripts/export-model.md).

## 7. Regression baselines

- Unit tests: 170. On the build: `e2e` (image counts below), `e2e:video` (0 stale draws, paused frame exact, 0 dropped video frames), `e2e:counts` 6/6, `e2e:webcam` and `e2e:pre` all PASS, no console errors.
- Image counts at 35% (default since 2026-10-06): Auto on WebGPU (YOLOv8s) moving_car 3 cars, 2 buses, 2 trucks; steady-2 16 cars, 4 trucks, 1 bus, 1 person; steady 1 dog, 1 person. Fast or WASM (YOLOv8n): 4 cars, 1 bus, 1 truck; 16 cars, 2 people, 1 bus, 1 truck; 1 horse, 1 person.
- Image counts at 25% (before 2026-10-06), Fast / Accurate: moving_car 4 cars, 1 bus, 1 truck / 4 cars, 2 buses, 2 trucks; steady-2 17 cars, 2 people, 1 bus, 1 truck / 18 cars, 4 trucks, 1 bus, 1 motorcycle, 1 person; steady 1 horse, 1 person / 1 dog, 1 person.
- Realtime at the 30 fps cap (Phase 8): 30 inference fps, 0% dropped on WebGPU (Auto and Fast) and WASM. Pre-analysis: Auto 3.4–4.5× realtime, Fast 4.2–5.3×, WASM 1.5–1.9×. First visit at 50 Mbit/s 8.6 s, reload 0.37 s.

## 8. Gotchas

- TypeScript pinned `~6.0.3` (typescript-eslint 8 needs < 6.1); onnxruntime-web pinned `1.30.0`; mediabunny `1.61.0` (lazy chunk).
- `new VideoFrame(video)` only works for a presented frame and must be created synchronously inside the rVFC callback; `captureDisplayedVideoFrame` waits and retries.
- Worker: GPU canvas for `VideoFrame`s, CPU canvas for `ImageBitmap`s. WebGPU needs a warm-up run; 8 WASM threads beat 16.
- Rotation: `new VideoFrame(video)` carries it, decoded WebCodecs frames do not: re-wrap with `{rotation, flip}` (missing from TS 6's `VideoFrameInit`). Test files: `transpose` + `-display_rotation` mimics a phone.
- Camera streams: the clock runs on while paused; `track.stop()` fires no `ended`. Fake camera: `--use-fake-device-for-media-stream[=device-count=2]`, `--use-fake-ui-for-media-stream`, `--use-file-for-fake-video-capture=<mjpeg>` (ignores device-count).
- In-page `import("/src/…")` on the dev server makes Vite's optimizer reload the page once: load, wait, reload, then evaluate.
- Run Prettier before exact-string edits (it breaks anchors). Never run a bare `cat > file` (hangs). e2e scripts run from the repo root. macOS has no `timeout`.
- happy-dom: a disconnected checkbox fires no `change` on `click()`.
- e2e hooks: `.media-stage[data-draw-time|data-result-time|data-boxes]`, `data-trace="1"` → `trackerupdate` events; `.counts-panel[data-revision]`, `.model-status[data-state]`, `.webcam-panel[data-state]`, `.analysis-panel[data-mode|data-status]`. DOM tests use `// @vitest-environment happy-dom`.
- Hosting budget: Vercel Hobby 100 MB, `dist/` ~82 MB: no extra model variants.

## 9. Not verified / open

- Real camera, real unplugging, mobile; weaker or integrated GPUs, no `shader-f16`, Windows/Android; headed Chrome; long or 500 MB files; WebM/MKV, HEVC, AV1; WASM determinism; Retry after a real model-load failure.
- Not measured in Phase 7: input size > 640 (needs a schema option), OC-SORT re-update for fast scale change (`steady.mp4`).
- The real deployment (headers, compression, first load over a real network) until the user sends the URL. Repo name kept (2026-10-06).
