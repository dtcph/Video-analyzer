# CLAUDE.md

Guidance for Claude Code in this repository. Keep it short and current, and update it at the end of every phase. Detailed reasoning belongs in `docs/`.

## Concept

**Object Counter (V3)** is a public, open-source, client-side website for study research. It runs YOLOv8 (COCO, ONNX via onnxruntime-web) on an image, an uploaded video or a live webcam feed, draws boxes and labels over the media, and counts objects per class:

- **Total:** unique confirmed tracks over the session; always visible.
- **Current frame:** only while paused.

It targets Chrome/Chromium only. There is no backend, accounts, persistence, recording or export.

Work proceeds in phases 0–7. Each phase ends with a report, and the next one starts only after the user approves. Never make git commits: the user commits after review.

| phase | content                                                                      | status                |
| ----- | ---------------------------------------------------------------------------- | --------------------- |
| 0     | archive old project, scaffold, port reusable modules                         | done, awaiting review |
| 1     | spike: model export, ORT-Web on WebGPU/WASM, benchmarks, `docs/decisions.md` |                       |
| 2     | image detection end-to-end                                                   |                       |
| 3     | realtime video                                                               |                       |
| 4     | tracking + total counts                                                      |                       |
| 5     | webcam                                                                       |                       |
| 6     | pre-analysis mode                                                            |                       |
| 7     | performance pass + release                                                   |                       |

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
```

**Rule:** `npx tsc --noEmit`, `npm run lint` and `npm run test` must all pass after every change set.

Tooling notes:

- TypeScript is pinned to `~6.0`, because typescript-eslint 8.x supports `<6.1` (TS 7 is out but unsupported there).
- DOM tests use `// @vitest-environment happy-dom`.
- ESLint gives `src/` browser and worker globals only, so Node APIs can't leak in.

## Layering rule

**Inference, tracking and counting never touch the DOM. Rendering never touches inference logic.** Data flows one way: input → inference (worker) → tracking → counting → rendering/ui.

```
src/
  settings/   Plain data. SettingsSchema is THE source of truth for user settings (label, range,
              default, group main/advanced/debug). SettingsStore holds state and sanitizes; nothing persisted.
  input/      Media sources (DOM allowed): VideoPlayer, FrameSampler (rVFC, rate-capped capture to
              VideoFrame/ImageBitmap), MediaFiles (pure upload validation, size limits), MediaTypes.
  inference/  No DOM. FrameGate: one frame in flight, drop when busy. Worker, pre/postprocess, NMS later.
  tracking/   No DOM. AssignmentSolver (Hungarian). Tracker in Phase 4.
  counting/   No DOM. Per-class totals / current-frame counts (Phase 2+).
  rendering/  Canvas 2D only. OverlayRenderer: one DPR-sized canvas over the media, layers get the
              letterboxed media rect (utils/geometry containRect); rAF loop while playing.
  ui/         Plain DOM panels: SettingsPanel (generated from the schema; Advanced/Debug <details>
              closed on every load; Reset to defaults), UploadPanel, PlaybackControls.
  app/        App.ts: the only module that knows everything; builds the layout and wires services.
  utils/      Pure helpers: geometry (top-left Box, IoU, contain/fit), format, math.
```

Boxes use a top-left origin (`Box {x, y, width, height}`), in pixels or normalized 0..1 as each API states.

## Stack

TypeScript, Vite 8, vanilla DOM/CSS, Canvas 2D, Web Workers, Vitest 5, ESLint 10, Prettier.

- New libraries are allowed when they clearly help; give one sentence of justification per dependency.
- Ask the user before adding any UI framework.
- Do not add OpenCV.
- Verify every library API against the installed version.

## License

The project is AGPL-3.0 (`LICENSE`, `"license": "AGPL-3.0-only"`), because Ultralytics YOLOv8 code and weights are AGPL-3.0. The README must credit Ultralytics YOLOv8 with the license and a source link. Never ship model files or code without the notice.

## Test media

`test-vid/` (clips) and `test-img/` (stills, Phase 1) are gitignored local media. Never commit them.
