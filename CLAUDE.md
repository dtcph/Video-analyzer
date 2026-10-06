# CLAUDE.md

**Object Counter (V3):** client-side website (Chrome) that runs YOLOv8 (ONNX, onnxruntime-web) on an image, video or webcam, draws boxes and counts objects per class: **Total** (unique confirmed tracks) and **Current frame** (paused). No backend, persistence or export.

**Resuming? Read [docs/HANDOFF.md](docs/HANDOFF.md) first.** Phases 0–7 approved; next: **8** performance pass + release. Requirements: [BRIEF.md](docs/BRIEF.md); reasoning: [decisions.md](docs/decisions.md); numbers: [benchmarks.md](docs/benchmarks.md), [clip-counts.md](docs/clip-counts.md).

## Rules

- Phase by phase; stop with the 5-part report and wait for approval. **Never make git commits** (the user commits).
- `old/` (previous project, gitignored): **never edit, import, delete or commit**; reference only. **Never add OpenCV.**
- Gate after every change set: `npx tsc --noEmit && npm run lint && npm run test && npx prettier --check .`
- Don't change counting rules silently. New libraries only with a one-sentence reason; ask before any UI framework; verify APIs against the installed version.
- License AGPL-3.0 (Ultralytics YOLOv8); keep the notice with models and code. `test-vid/`, `test-img/` are local media: never commit.

## Commands

```bash
npm run dev | build | preview          # Vite, COOP/COEP headers
npm run e2e | e2e:video | e2e:counts | e2e:webcam | e2e:pre  [-- --build]   # browser flows (puppeteer)
npm run e2e:clips -- --build [--model auto|n|s] [--label x]                 # record all clips
node scripts/e2e/sweepTracker.ts --label x [--switches|--truth|--detail clip.mp4] [--confidence 0.35]
```

Reports go to `.cache/e2e/`. `scripts/*.ts` run with Node type stripping (erasable TS, `.ts` imports). TypeScript pinned `~6.0`, onnxruntime-web `1.30.0`.

## Architecture

Inference, tracking, counting and analysis never touch the DOM; rendering never touches inference. One-way flow: input → inference (worker) → tracking → counting → rendering/ui; only `app/App.ts` knows everything.

```
settings/   SettingsSchema (source of truth for every setting), stores, class groups
input/      image, video, webcam sources; frame sampling (rVFC); upload validation
inference/  worker: modelPlan → ORT (WebGPU, else WASM) → letterbox → decode → class-aware NMS
analysis/   pre-analysis: cache, deterministic TrackingRun, state machine, WebCodecs runner (mediabunny)
tracking/   ByteTrack-style Tracker (Kalman, Hungarian, majority-vote class)
counting/   totals (count follows the majority class)
rendering/  overlay per presented frame;  ui/: panels;  app/: wiring, realtime, pre-analysis session
```

- **Defaults:** model "Auto" = YOLOv8s on WebGPU with `shader-f16`, else YOLOv8n; confidence 35%; confirmation 3 frames; lost buffer 2 s; max 30 fps.
- **Detections:** the worker returns all ≥ 0.05; threshold and class mask apply on the main thread (no re-inference).
- **Realtime:** only forward-played frames feed the tracker; seek clears tracks, keeps totals. **Pre-analysis:** every frame, cached; settings change → stale → Re-analyze.

## Known limitations

Busy moving footage over-counts (duplicate boxes on one object, re-counts after occlusion); objects that shrink fast (walking away) or leave and return are counted again; small or distant objects are missed; YOLOv8n confuses some classes (dog → horse). Details: [clip-counts.md](docs/clip-counts.md) §5.
