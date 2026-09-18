# Blob Analyzer

A browser-based tool that turns uploaded video footage into an interactive
visualization of image-analysis and motion-tracking data.

This is **not** a video editor. The video is treated as a source of data —
blob positions, sizes, tracking confidence, and exposure characteristics —
and the interface exists to make that otherwise invisible data visible and
understandable, the way a scientific instrument would present it.

## Conceptual pipeline

```
Video upload
  → video processing
  → image analysis
  → blob detection
  → blob tracking
  → extracted data
  → interactive visualization over the original video
```

The computer-vision layer produces structured, typed data (`BlobData`,
`Track`, `TrackPoint`). The rendering layer only visualizes that data — it
never drives detection or tracking. This separation is the core
architectural rule of the project.

## Current status (V1 foundation)

- Video upload (drag-and-drop or file picker), playback, seeking.
- A `video-stage` with three independently toggleable canvas overlays
  (exposure/analysis, tracking, annotations) layered above an untouched
  `<video>` element.
- A full data pipeline wired end to end: frame extraction → `AnalysisEngine`
  (exposure stats + blob detection hook) → `BlobTracker` → `TrackManager` →
  renderer/UI. Exposure analysis (RGB clipping, crushed blacks, luminance
  range) is implemented and running live.
- Blob detection itself is a stub (`BlobDetector`) — the intended
  integration point for OpenCV.js (threshold → `findContours` →
  bounding rects). It returns no blobs until that pipeline is implemented,
  so tracks won't appear yet on real footage.
- UI: upload panel, playback controls, layer toggles, a temporal track
  timeline (not an editing timeline), a track list, and a data inspector
  for the selected track.

Not yet implemented: OpenCV.js-backed blob detection, Web Worker
offloading of analysis, video export, and project persistence — all left
as deliberate gaps for the next phase.

## Architecture

Responsibilities are kept in separate layers so tracking logic never
touches the DOM and rendering never touches CV logic:

```
video/        native <video> playback + frame extraction (canvas)
analysis/     per-frame image analysis: exposure stats, blob detection
workers/      off-main-thread analysis (reserved, not yet wired in)
tracking/     Track / TrackPoint data model + TrackManager store
annotations/  text labels bound to a track's live position
rendering/    canvas overlay renderers, one per layer
ui/           DOM panels (upload, timeline, controls, track list, inspector)
app/          top-level wiring (App, AppState)
utils/        math / geometry / timing helpers
```

### Data model

Spatial values (`x`, `y`, `width`, `height`) are normalized `0..1` against
frame dimensions rather than hard-coded to a resolution.

```ts
interface BlobData {
    id: number;
    x: number; y: number;
    width: number; height: number;
    centerX: number; centerY: number;
    area: number;
}

interface TrackPoint {
    frame: number;
    x: number; y: number;
    width: number; height: number;
    confidence: number;
}

interface Track {
    id: number;
    blobs: TrackPoint[];
    startFrame: number; endFrame: number;
    confidence: number;
    status: "active" | "lost";
}
```

Text annotations attach to a track ID and are positioned dynamically from
the track's current point each frame — there is no manual keyframing. If a
track goes `lost`, its annotation stops rendering.

### Rendering layers

```html
<div class="video-stage">
    <video id="video"></video>
    <canvas id="analysis-layer"></canvas>
    <canvas id="tracking-layer"></canvas>
    <canvas id="annotation-layer"></canvas>
</div>
```

`VideoRenderer` drives all three canvases from playback state (a
`requestAnimationFrame` loop while playing, a single render on seek/pause)
and each layer can be shown or hidden independently.

## Stack

TypeScript, Vite, vanilla DOM/CSS, Canvas 2D. No framework, no backend, no
database, no auth. OpenCV.js and WebCodecs are anticipated but not yet
wired in; Web Workers are scaffolded (`AnalysisWorker.ts`) but analysis
currently runs on the main thread until profiling shows it needs to move.

## Target

Chrome/Chromium, 1080p, 30fps, browser-side processing only, uploads up to
roughly 500MB. Video export and project persistence are out of scope for
V1.

## Getting started

```bash
npm install
npm run dev
```

Open the printed local URL, drop in a video file, and use the layer
toggles to show/hide the exposure, tracking, and annotation overlays.
