# CLAUDE.md

**Object Counter (V4, in progress):** client-side desktop website (Chrome) that runs YOLOv8 (ONNX, onnxruntime-web) on an image, video or webcam, draws boxes and counts objects per class (unique confirmed tracks). The result is shown as a treemap (D3) in a pop-up, live for the camera. No backend, persistence or export.

Live: https://video-analyzer-sable.vercel.app/

**V3 is finished and deployed; V4 (branch `V4`) is built phase by phase (see the user's prompt): Phases 0–3 approved, Phase 4 (polish, release check) done; now single UI changes bit by bit (list: end of docs/V4.md). Decisions, numbers and checks: [docs/V4.md](docs/V4.md).** Flow: start screen → two ways to start (photo/video, camera) → analysis page (box, result pop-up, model + classes, settings pop-up). "Current frame" is commented out (disabled in V4); pre-analysis is removed. Decisions, numbers, ideas and gotchas of V3: [docs/V3-archive.md](docs/V3-archive.md); original requirements: [BRIEF.md](docs/BRIEF.md).

## Rules

- Phase by phase; stop with the 5-part report and wait for approval. **Never make git commits** (the user commits).
- `old/` (previous project, gitignored): **never edit, import, delete or commit**; reference only. **Never add OpenCV.**
- Gate after every change set: `npx tsc --noEmit && npm run lint && npm run test && npx prettier --check .`
- Don't change counting rules silently. New libraries only with a one-sentence reason; ask before any UI framework; verify APIs against the installed version.
- License AGPL-3.0 (Ultralytics YOLOv8); keep the notice with models and code. A new runtime dependency goes into `public/THIRD_PARTY_NOTICES.txt` (a test checks it). `test-vid/`, `test-img/` are local media: never commit.

## Commands

```bash
npm run dev | build | preview          # Vite, COOP/COEP headers
npm run e2e | e2e:video | e2e:counts | e2e:webcam | e2e:contrast  [-- --build]   # browser flows (puppeteer); contrast = text contrast audit
npm run e2e:clips -- --build [--model auto|n|s] [--label x]                 # record all clips
node scripts/e2e/sweepTracker.ts --label x [--switches|--truth|--detail clip.mp4] [--confidence 0.35]
node scripts/e2e/profileFlow.ts --build [--load]                            # per-frame timing profile
```

Reports go to `.cache/e2e/`. `scripts/*.ts` run with Node type stripping (erasable TS, `.ts` imports). TypeScript pinned `~6.0`, onnxruntime-web `1.30.0`.

## Architecture

Inference, tracking, counting and analysis never touch the DOM; rendering never touches inference. One-way flow: input → inference (worker) → tracking → counting → rendering/ui; only `app/App.ts` knows everything.

```
settings/   SettingsSchema (source of truth for every setting), stores, class groups
input/      image, video, webcam sources; frame sampling (rVFC); upload validation
inference/  worker: modelPlan → ORT (WebGPU, else WASM) → letterbox (on arrival) → decode → class-aware NMS
tracking/   ByteTrack-style Tracker (Kalman, Hungarian, majority-vote class)
counting/   totals (count follows the majority class)
rendering/  overlay per presented frame, treemap layout, palette (class colors, contrast);  ui/: panels, dialogs, treemap, icons, spotlight;  app/: wiring, realtime
styles/     tokens.css (type scale, 60/30/10 colors, glass), main.css
```

- **Design:** dark off-black ground (60%), off-white and grays (30%), accents (10%: `ACCENTS` in `rendering/palette.ts`, mirrored in `tokens.css`, a test keeps them in step). Flat dark ground with fine grain, faint stroke-colored light from the window edges (`body::before/::after`) and a pointer spotlight (`ui/spotlight.ts`); button strokes are thin animated accent gradients (one per button kind, masked ring, shown on hover/focus; `--stroke-*`, no WebGL: the GPU belongs to inference); glass panels with backdrop blur only beside the picture, never over it. Buttons are icons (`ui/icons.ts`). Fonts are self-hosted (COEP blocks CDNs).
- **Defaults:** model "Auto" = YOLOv8s on WebGPU with `shader-f16`, else YOLOv8n; confidence 35%; confirmation 3 frames; lost buffer 2 s; max 30 fps.
- **Detections:** the worker returns all ≥ 0.05; threshold and class mask apply on the main thread (no re-inference).
- **Realtime:** one frame in flight + the newest waiting (FrameGate); only forward-played frames feed the tracker; seek clears tracks, keeps totals.

## Known limitations

Busy moving footage over-counts (duplicate boxes on one object, re-counts after occlusion); objects that shrink fast (walking away) or leave and return are counted again; small or distant objects are missed; YOLOv8n confuses some classes (dog → horse). A re-count counts as a new impression and is acceptable. Details: [V3-archive.md](docs/V3-archive.md) §4.
