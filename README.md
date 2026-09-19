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
    blobs: TrackPoint[];               // "points" in tracking literature; kept as `blobs` here
    startFrame: number; endFrame: number;
    confidence: number;
    status: "tentative" | "active" | "uncertain" | "lost" | "abandoned";
    consecutiveMatches: number;
    lostFrames: number;
    expectedSize: { width: number; height: number; area: number };
    predictedPosition: { x: number; y: number };
    predictedSize: { width: number; height: number };
    searchRadius: number;
    events: TrackEvent[];
}
```

Text annotations attach to a track ID and are positioned dynamically from
the track's current point each frame — there is no manual keyframing. An
annotation stops rendering once its track's queried frame is more than
`POSITION_HOLD_FRAMES` (Track.ts) past its nearest recorded point — in
particular once a track is `lost`/`abandoned` and stays that way.

## Tracking algorithm

`BlobTracker.update(frame, blobs)` runs a full per-frame pipeline rather
than plain nearest-neighbor matching:

```
estimate camera motion (CameraMotionEstimator)
  → predict each track's next position (Track.predictPosition)
  → gate impossible (track, blob) pairs out (TrackAssociator)
  → globally-optimal association over what's left (AssignmentSolver, Hungarian)
  → reidentify lost tracks against anything still unmatched (TrackReidentifier)
  → start new tracks for genuinely new blobs
  → advance lifecycle for everything not matched this frame (TrackLifecycle)
  → merge any tracks that turned out to be duplicates (TrackManager)
```

**Prediction.** `Track.trackVelocity` is a weighted average over the last
few frame-to-frame deltas (not just the last two points), damping
single-frame detection noise. `Track.predictPosition` extrapolates from
that, with a one-off correction on a frame flagged as sudden camera
movement (see below) — a steady pan needs no correction since it's already
absorbed into each track's own smoothed velocity within a couple of
frames.

**Trust and search radius.** `Track.trackTrust` combines how consistent a
track's recent motion has been (`positionStability`) with how much history
backs it up. `TrackingConfidence.predictionRadius` shrinks a track's
matching search radius as trust rises (`stabilityTightening`, floored by
`minRadiusFraction`) and caps it absolutely at `maxAssociationDistance` —
this cap, plus the gating step, is what makes a track jumping across the
frame structurally impossible rather than merely unlikely. A widely-off,
larger blob will always score worse than the correct nearby one on
position, and gating rejects it outright if it falls outside the radius.

**Association.** `TrackAssociator` rejects out-of-radius pairs first
(gating), scores the rest on a weighted blend of position, IoU, size
(against each track's own EMA-learned `expectedSize`, not just its last
frame), aspect ratio, and motion consistency
(`TrackingConfidence.scoreMatch`), then finds the *globally* optimal
assignment over the whole cost matrix via a classic Hungarian /
Kuhn-Munkres solver (`AssignmentSolver`) — not each track greedily
grabbing its own best blob, which is what makes two crossing/nearby tracks
prone to swapping ids. `GreedyBlobMatcher` (`BlobMatcher.ts`) remains
available as a simpler alternative.

**Lifecycle.** `TrackLifecycle` owns every status transition:
`tentative` (needs `confirmationFrames` consecutive matches before being
trusted) → `active` → `uncertain` (still matched, but confidence has
dipped) → `lost` (unmatched, eligible for reidentification) → `abandoned`
(reidentify window expired, confidence collapsed, or predicted position is
at the frame edge — skips `lost` entirely, since there's nothing to search
for). A `lost` track revived by `TrackReidentifier` goes straight back to
`active` under the same id.

**Reidentification.** `TrackReidentifier` scores an unmatched blob against
each `lost` track's *predicted* (not last-known) position, camera-adjusted
and extrapolated by however long it's been gone, plus size/aspect
similarity against `expectedSize` and how recently it went lost. The
search radius grows with elapsed lost frames but is capped at
`maxReidentifyDistance` — growing uncertainty never lets a track jump
across the frame to reconnect.

**Camera motion.** `CameraMotionEstimator` takes the median velocity
across all matchable tracks each frame; if enough tracks
(`cameraMotionMinTracks`) agree closely enough, that's read as camera
motion rather than coordinated object motion, with a confidence score
reflecting both the amount and consistency of that agreement. A sudden
spike against its own running baseline (`cameraMotionSensitivity`) flags
`sudden: true` for one-off prediction correction and gate widening
(`cameraShakeRadiusBoost`); a steady ongoing pan needs neither, since it's
already captured by each track's own smoothed velocity.

**Debug mode.** The "Debug view" checkbox in the Tracking panel draws each
track's predicted position, search-radius gate, an association line to the
actual detection, a rough velocity vector, and a status/confidence readout
directly on the tracking canvas, plus a camera-motion HUD (dx/dy/confidence,
flagged when sudden). "Debug logging" (same panel) enables
`TrackerLogger`, which prints structured per-track state and
reidentification decisions to the console. Both default off.

### Limitations / deliberately deferred

- **No true Kalman filter.** The smoothed constant-velocity model above
  (weighted recent-history velocity + trust-adaptive gating) covers the
  practical benefit — stable prediction, wide tolerance for young/erratic
  tracks, narrow tolerance for proven ones — without the added complexity
  and tuning surface (process/measurement noise covariances) of a real
  multi-object Kalman filter. If prediction quality becomes a bottleneck
  in practice, `Track.predictPosition` is the seam to replace.
- **No explicit occlusion blob-merge/split detection.** When two blobs
  visually merge into one, this tracker doesn't specifically detect that
  and pick which track "owns" the merged blob — one track will match it
  (probably the closer/larger one) and the other will go `lost`, then
  reidentify normally once the blobs separate again and it reappears. The
  architecture supports this path (that's exactly what `lost` +
  reidentification is for) without a dedicated merge/split heuristic on
  top.
- **Translation-only camera motion.** No scale (zoom) or rotation
  compensation — acceptable for pans/shakes, not for zooms.
- **Greedy, not globally optimal, reidentification.** Unlike the primary
  matching pool (Hungarian), `TrackReidentifier` claims lost tracks
  greedily by score. Revival is comparatively rare and mostly
  one-directional (one blob reappearing, not many lost tracks colliding
  at once), so this costs little in practice.

### Testing

`npm run test:tracker` runs `scripts/trackerScenarios.ts` — synthetic,
dependency-free scenarios (no video/OpenCV involved) exercising constant
movement, camera panning, temporary occlusion + reidentification, a track
leaving the frame (`abandoned`, not `lost`), near-duplicate objects,
crossing paths, gradual size change, a sudden unrelated blob near a
trusted track's predicted position, and the Hungarian solver itself. This
is the project's only automated test coverage — there is no broader test
suite (see CLAUDE.md).

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
