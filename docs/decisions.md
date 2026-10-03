# Phase 1 decisions

**Status:** proposed 2026-10-02. Questions answered by the user on 2026-10-02 (section 11). Host changed to Vercel.

Evidence is in [benchmarks.md](benchmarks.md). All measurements come from one high-end machine (M4 Max, Chrome 154). Decisions that depend on slower hardware are marked as assumptions.

## 1. Runtime: onnxruntime-web 1.30.0

|                  | choice                                                                  | why                                                                                                                                   |
| ---------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **GPU path**     | native WebGPU EP, `import("onnxruntime-web/webgpu")`                    | Same FP32 speed as the legacy JSEP build, FP16 is 1.7× faster than on JSEP, and it's ORT's actively developed path.                   |
| **CPU path**     | plain WASM build, `import("onnxruntime-web/wasm")`, SIMD + threads      | Half the download of the WebGPU builds (3.5 vs 6.3 MB gzip), and devices without WebGPU are the ones that most need a small download. |
| **Loading**      | Each build is loaded on demand, so a device downloads only one runtime. |                                                                                                                                       |
| **Where**        | Inside our inference worker, with `env.wasm.proxy = false`.             | Never on the main thread.                                                                                                             |
| **WASM threads** | `clamp(floor(hardwareConcurrency / 2), 1, 8)`                           | 8 was best on 16 logical cores; 16 was slower and unstable. **Assumption:** half the cores is right on other devices too.             |
| **wasm URL**     | Vite `?url` import of the exact `.wasm` file into `env.wasm.wasmPaths`  | Content-hashed asset name, safe to cache forever.                                                                                     |

**Backend selection** (Settings → Advanced → Backend: Auto / WebGPU / WASM):

1. **Auto or WebGPU:**
   - If `navigator.gpu.requestAdapter()` returns an adapter, use WebGPU.
   - Otherwise use WASM. When "WebGPU" was forced, show "WebGPU not available, using WASM".
2. **If WebGPU session creation fails**, fall back to WASM once and show the reason.
3. **Show the active backend** in the UI (Debug section) as "WebGPU" or "WASM ×N threads".

## 2. Model files

| setting        | file                        | size    | used when                               |
| -------------- | --------------------------- | ------- | --------------------------------------- |
| Fast (default) | `yolov8n-640-dyn-fp16.onnx` | 6.1 MB  | WebGPU with `shader-f16`, and WASM      |
| Fast, fallback | `yolov8n-640-dyn.onnx`      | 12.1 MB | WebGPU adapter **without** `shader-f16` |
| Accurate       | `yolov8s-640-dyn-fp16.onnx` | 21.3 MB | WebGPU with `shader-f16`, and WASM      |

- **FP16:**
  - lossless in the accuracy check (rect, n: 0.996 / 0.998);
  - half the download;
  - same or better speed on WebGPU;
  - neutral on WASM, where ORT computes in FP32, so WASM uses the smaller FP16 file too.
- **INT8 rejected:** slower on WASM (37.5 vs 28.4 ms) and recall drops to 0.855.
- **Dynamic H/W:**
  - one file serves every input size and the rect letterbox (section 3);
  - no measurable cost against static shapes;
  - replaces 3 sizes × variants with one file per model.
- **Unverified fallback for GPUs without `shader-f16`:**
  - I could not test such a GPU, so it is unknown whether ORT's WebGPU EP would run an FP16 graph there at all.
  - The app therefore checks `adapter.features.has("shader-f16")` and uses FP32 for yolov8n.
  - For yolov8s it uses WASM: an FP32 yolov8s file would add 43 MB to a deployment that must stay under Vercel Hobby's 100 MB static-file limit (section 9).
- **yolov8s is offered as "Accurate".**
  - It costs nothing extra on this GPU (~10 ms per frame).
  - On WASM it runs 53–60 ms, about 17 FPS.
  - yolov8n misses 38% of yolov8s's detections on the test frames and calls the test dog a horse.

## 3. Input size and letterbox

- **Default: 640 on the long side, "rect" letterbox.** The short side is padded only to a multiple of 32, so 16:9 becomes 640×384.
  - It reproduces Ultralytics' predictions exactly (precision and recall 1.000 vs PyTorch).
  - It is 1.6× faster on WASM than 640×640.
- **Advanced "Inference input size"** stays at 320 / 416 / 640 (long side). The UI notes that smaller sizes miss small objects: recall against 640 was 0.29 / 0.42 on the test clips.
- **Slow devices should keep 640 and lower the inference rate** (degrade gracefully) rather than shrink the input. Phase 3 measures this on video.
- **Letterbox implementation:** OffscreenCanvas 2D `drawImage` with gray 114 padding (`src/inference/preprocess.ts`). It costs 1.1 ms per frame here.
- **GPU preprocessing / IO binding is deferred to Phase 7.** ORT 1.30 supports it, but the saving is at most ~1 ms per frame here, and graph capture would need static shapes.

## 4. NMS: in JavaScript, class-aware

- **Export without NMS. Decode + greedy class-aware NMS** in `src/inference/postprocess.ts`: 0.4 ms per frame.
- **In-graph NMS was rejected:**
  - slower on WebGPU (10.1 vs 8.8 ms);
  - its IoU threshold is baked in at export, so the Advanced IoU setting could not work;
  - its confidence floor is baked in too.
- **Output contract:** `output0 [1, 84, N]`. Boxes cx, cy, w, h in input pixels, then 80 sigmoid class scores.

## 5. Class filtering: after the argmax, before tracking

- **When:** the decoder takes each anchor's best class _first_, then drops the anchor if that class is disabled. This is Ultralytics' `classes=` semantics.
  - The alternative, filtering before the argmax, would relabel a disabled "car" as its runner-up "truck" and inflate truck counts. Rejected.
- **Where (Phase 2 implementation):** the worker returns all classes above a 0.05 score floor after class-aware NMS; the main thread drops disabled classes and scores below the threshold (`filterDetections`) before anything else sees them. Because NMS is class-aware and greedy by score, this is identical to filtering before NMS (a 200-case randomized test checks it). Slider and class changes therefore apply instantly, without a new inference run.
- **Effect:** disabled classes never reach the tracker, the renderer or the counters. The tracker does less work, and a disabled class cannot create, steal or keep tracks.
- **Realtime and webcam:**
  - a selection change applies from the next inferred frame;
  - tracks of newly disabled classes are dropped;
  - existing totals stay visible but stop increasing, marked "not counting";
  - nothing is recomputed, and the UI says so.
- **Pre-analysis:**
  - the cache holds only enabled-class detections and tracks;
  - a selection change is a settings change and triggers the "Settings changed, re-analyze" prompt, as the brief requires.
  - **Alternative for you to consider:** cache all classes and filter at display time. Class changes would then be instant in pre-analysis, but tracking all 80 classes costs more, and counts would depend on cross-class interactions. Not chosen; say if you want it.

## 6. Tracker (built in Phase 4)

Final design, built and measured in Phase 4. Evidence and per-clip numbers: [clip-counts.md](clip-counts.md).

- **Design:** ByteTrack-style, pure TypeScript in `src/tracking/` (no DOM), on the main thread (≤ 0.6 ms per update on the busiest 4K clip).
  - **Motion:** constant-velocity Kalman filter on box center, aspect ratio and height (`BoxKalmanFilter`). ByteTrack's noise constants, with a **variable time step**: frames arrive at a varying rate, so each step is media seconds × 30 nominal frames. Exact equivalent of ByteTrack's 8-D filter, stored as four 2×2 blocks.
  - **Association, three stages (Hungarian, `AssignmentSolver`):**
    1. detections ≥ the confidence threshold ↔ confirmed and lost tracks, IoU ≥ 0.2;
    2. low-score detections (0.1 up to the threshold) ↔ still unmatched confirmed tracks, IoU ≥ 0.5; they only _extend_ tracks (no hits, no class votes, never drawn on their own, never counted);
    3. remaining high-score detections ↔ tentative tracks, IoU ≥ 0.3; unmatched tentative tracks are removed, so confirmation needs **consecutive** frames.
  - **Buffered IoU for lost tracks** (C-BIoU, Yang et al. 2023): when re-associating a lost track, both boxes are enlarged by 50% of their size per side before the IoU. Small objects under a moving camera no longer overlap their prediction after a gap; this cut moving-camera totals by 15–28% and changed fixed-camera totals by ≤ 4%. _Added in Phase 4 after measurement; a lightweight mitigation, not camera-motion compensation. Reversible: `DEFAULT_TUNING.lostBuffer = 0`._
  - **Cross-class duplicates:** an unmatched detection overlapping a track matched in the same frame by IoU ≥ 0.7 _with a different class_ does not start a track (class-aware NMS keeps e.g. a car and a truck box on one vehicle; steady-2: 10 trucks → 1).
  - All of these are internal constants in `DEFAULT_TUNING` (`src/tracking/Tracker.ts`), not settings.
- **States:** tentative → confirmed (after N hits, Advanced "Confirmation frames", **default 3**) → lost (kept for the "Track-lost buffer", **default 2 s** of media time) → removed. A lost track that is re-associated becomes confirmed again with the same ID.
- **Per-class IDs:** each track carries `classId`, `label` and the score of its latest above-threshold detection.
- **Class flicker** (car ↔ truck, the dog ↔ horse ↔ cow in `steady.mp4`):
  - **User decision:** associate across classes, with an IoU penalty for a class mismatch. Penalty **0.2** (association score = IoU − 0.2). Measured better than strict per-class matching on every clip.
  - **User decisions (2026-10-03):** each track's class is the **majority vote** of its above-threshold detections (score-weighted). A track is **counted once, when it is confirmed**, and its count then **follows the majority class**: when the winning class changes, the tracker reports it (`TrackerUpdate.reclassified`) and `TotalCounter.move` moves the count, so the sum never changes. A tie keeps the current class (no flip-flopping).
    - Revised the same day: the first answer was "counted under the majority class at confirmation, never moved"; it counted the `steady.mp4` dog as "cow" from its first 3 frames, and the user asked for the count to follow the majority.
    - Limit: re-attribution works per track. When an object's track breaks (ID switch), each piece votes on its own; on `steady.mp4` the near-camera piece of the dog is labeled "horse" by YOLOv8n in most frames, so it is counted as a horse ([clip-counts.md](clip-counts.md) §2).
- **Seek / rewind / replay (user decision, 2026-10-03):** any seek clears the tracks and keeps the totals; rewinding or replaying counts objects again; **Reset counts** clears both (and restarts IDs at 1). The tracker itself also resets when it sees time go backwards.
- **What feeds the tracker:** only frames sampled during forward playback. The paused frame's detection (pause, seek while paused, end) only feeds the display and "Current frame", so pausing can never add counts.
- **Display:** while playing, boxes are the tracks seen in the latest update (tentative and confirmed), Kalman-extrapolated to the displayed media time; hidden when the latest update is more than 0.5 s of media time away. While paused, the paused frame's own detections are drawn (they are what "Current frame" counts), labeled with the IDs of overlapping tracks. "Show raw detections" (Debug) still draws the held raw result.
- **Class selection change:** tracks of newly disabled classes are dropped at once; totals of disabled classes stay, marked "not counting"; the class panel says earlier counts are not recomputed.

## 7. Frame handling (Phases 3–5)

- **One frame in flight** (`FrameGate`). Frames that arrive while busy are dropped and counted as dropped. Capture is rate-capped by Advanced "Max inference rate".
- **Sampling:** at the moment each frame is presented (`requestVideoFrameCallback`), capped by "Max inference rate". **Default 30** (Phase 3 measurement: 24–30 fps on WebGPU, ~18 on WASM, no dropped video frames on the M4 Max; slower devices drop more samples). Reversible: 15 gave 0% drops everywhere here.
- **Smooth overlays:**
  - Phase 3 holds the latest result for up to 0.5 s of media time, so it lags about one sampling interval.
  - The overlay redraws on every presented video frame and never shows a result from before a seek.
  - Since Phase 4, boxes are drawn from the tracker's Kalman prediction at the displayed media time (see §6). Untracked raw detections (Debug view) stay held.
- **Paused frame:** on pause, at the end, and after a seek while paused, the displayed frame itself is detected; it is never dropped. "Current frame" counts appear only once that result is in.
  - Chrome can only capture a paused frame after it has been presented: `new VideoFrame(video)` and even `createImageBitmap(video)` fail right after loading, even at `readyState` 4. So capture waits for the next presented frame and retries.
- **Preprocessing:** a GPU canvas for video frames (2–5 ms at 4K instead of ~15) and a CPU canvas for still images; see benchmarks.md, Phase 3.

## 8. Model files are committed to git

- **What:** the three release files (39.5 MiB in total) plus `public/models/manifest.json` (SHA-256 per file and per source `.pt`) are committed.
- **Why:**
  - Deployment then needs no Python/PyTorch toolchain, no build-time download and no Git LFS setup.
  - The repository stays well under GitHub's limits: the largest file is 21.3 MB, against a 50 MB warning and a 100 MB hard limit.
- **Verification:** the export is reproducible byte-for-byte (`scripts/export-model.md`), so anyone can check that the committed files match their source.
- **Cost:** every re-export adds about 40 MB to git history. Re-exports should be rare.
- **Not committed:** benchmark candidates (`.cache/models-bench/`), the rest of `.cache/` and `.venv-export/` are gitignored.

## 9. Hosting: Vercel (user's choice)

- **Setup:** import the GitHub repository; framework preset "Vite" (build command `npm run build`, output directory `dist`); Node 22 or newer.
- **Headers:** `vercel.json` at the repository root, using the documented `headers` syntax (https://vercel.com/docs/project-configuration/vercel-json):

  ```json
  {
    "$schema": "https://openapi.vercel.sh/vercel.json",
    "headers": [
      {
        "source": "/(.*)",
        "headers": [
          { "key": "Cross-Origin-Opener-Policy", "value": "same-origin" },
          { "key": "Cross-Origin-Embedder-Policy", "value": "require-corp" }
        ]
      },
      {
        "source": "/assets/(.*)",
        "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }]
      }
    ]
  }
  ```

  It is added in Phase 7 together with the deployment checklist. It is not verified on a real deployment yet; check with `curl -I` after the first deploy.

- **Why the headers matter:** without cross-origin isolation, WASM runs single-threaded, about 6× slower (191 vs 28 ms). WebGPU does not need it.
- **Size budget:** Vercel Hobby allows **100 MB of static files** per deployment (https://vercel.com/docs/limits). Expected `dist/`:
  - the three models, 41.4 MB;
  - the plain WASM and WebGPU `.wasm` builds, 13.6 + 25.5 MB;
  - JS and CSS.

  That is about 81 MB. It fits, but there's no room for more model variants. If it ever gets tight, drop the FP32 fallback (12.7 MB) first. The legacy JSEP build (27 MB) must stay out of the app bundle (bench page only).

- **Hobby plan terms:** non-commercial use only. A study research project fits.
- **Caching:**
  - Vite-hashed assets (JS and the ORT `.wasm`) are cached as immutable.
  - Model files keep stable names. The inference worker stores them in the **Cache API**, keyed by file name + SHA-256 from `manifest.json`, which is always fetched fresh. A re-export with a new hash invalidates the cache automatically. Built in Phase 2, together with download progress.
- **Alternatives,** if Vercel ever doesn't fit:
  - Cloudflare Pages or Netlify use a `_headers` file.
  - GitHub Pages cannot set headers and would need the `coi-serviceworker` workaround.

## 10. License plan: AGPL-3.0

The project is published under **AGPL-3.0-only** (`LICENSE`, `package.json`).

**What you must do for compliance (practical notes, not legal advice):**

1. **Make the source available to every user of the website (AGPL §13).**
   - The repository (`github.com/dtcph/Video-analyzer`) is **public** (confirmed by the user).
   - The app footer will link to it. Ideally the link points at the deployed commit; Vite can inject the commit hash at build time.
2. **Keep the license and notices:**
   - `LICENSE` in the repo;
   - an AGPL notice and the Ultralytics YOLOv8 credit with a source link in the README and the site footer;
   - the ONNX files keep Ultralytics' `author` / `license` metadata.
3. **Copyright line:** "Copyright (C) 2026 Paul", followed by the standard AGPL notice, in the README (done).
4. **Third-party notices:**
   - onnxruntime-web is MIT-licensed and bundled into `dist/`. MIT requires keeping its copyright and license text with copies. Plan: generate `THIRD_PARTY_NOTICES` at build time in Phase 7.
   - Other runtime dependencies: none so far.
5. **Courtesy credit for COCO:** the weights are trained on COCO (annotations CC BY 4.0). Credit it in the README.
6. **Never commit `test-vid/` or `test-img/`.** Their redistribution rights are unknown; they are gitignored.
7. **Closed-source or proprietary use** of YOLOv8 would need Ultralytics' Enterprise license. Not relevant while the project stays open source.

## 11. Questions answered (2026-10-02)

1. **Commit the three model files (39.5 MiB):** approved.
2. **Host:** Vercel, deployed later by the user (section 9).
3. **Copyright holder:** "Paul". The repository is public.
4. **Class flicker:** associate across classes with an IoU penalty for a class mismatch (section 6).
5. **Repository rename:** not answered; it stays "Video-analyzer" unless you say otherwise.

## 12. Camera-motion compensation: planned as Phase 6b (decided 2026-10-03)

Moving-camera clips over-count by about 1.5–2× from ID switches ([clip-counts.md](clip-counts.md)). The user decided to finish the original plan first (Phases 5–6) and add **Phase 6b, a measured spike**, before the Phase 7 performance pass.

- **What V2 had** (`old/`, reference only): OpenCV.js block matching (2×2 residual grid) and sparse LK optical flow on FAST corners (4×3 grid); translation only (affine and homography fits absorbed real object motion and stayed diagnostics); a parallax rejection rule. It helped a slow pan and failed on car and drone footage (confident in 63% of car frames, < 20% of late drone frames), at 50–70 ms per frame in Node. It compensated whole frames for frame differencing.
- **Why V3 needs much less:** only the tracker's predicted boxes have to be shifted before association, and YOLO's boxes tell us where likely movers are, so they can be masked out of the estimate.
- **Proposed approach** (pure TypeScript, no OpenCV): in the worker, reuse the letterboxed frame, downscale to ~160×90 grayscale, mask detected boxes, estimate a robust global translation (+ optional scale) by block matching or phase correlation; return it with the detections; `Tracker.update` applies it to predicted boxes, only when the estimate is confident. Expected ≈ 1–2 ms per frame (estimate, not measured).
- **Cheaper fallback:** the median displacement of confirmed tracks (no image work); unreliable with few tracks or many movers.
- **Evaluation:** extend the clip runner to record each frame's motion estimate so the offline replay can compare counts and suspected re-counts with and without it. Go/no-go on the numbers.
- **Not solvable by a global model:** parallax (side-facing car camera, low drone over houses); per-track velocity and the buffered IoU already absorb part of it.
