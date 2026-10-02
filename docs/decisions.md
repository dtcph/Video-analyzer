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

- **Design:** ByteTrack-style.
  - **Motion:** constant-velocity Kalman filter on box center, aspect ratio and height.
  - **Association, two stages:**
    1. Detections at or above the confidence threshold are matched to all tracks by IoU, with optimal assignment (`AssignmentSolver`, Hungarian).
    2. Low-score detections (0.1 up to the threshold) can only _extend_ unmatched existing tracks. This keeps IDs through partial occlusion.
  - **Low-score detections are never drawn or counted.**
- **States:** tentative → confirmed (after N hits, Advanced "Confirmation frames") → lost (kept for the "Track-lost buffer" seconds) → removed.
- **Per-class IDs:** each track carries `classId`, `label` and its latest confidence.
- **Class flicker** between similar classes (car ↔ truck, the dog ↔ horse seen in Phase 1). Strict per-class association would double count a flickering object.
  - **Decided by the user:** associate across classes, with an IoU penalty for a class mismatch.
  - **Still to confirm in the Phase 4 report** (my proposal, not yet explicitly approved): give each track its majority-vote class, and count it once, at confirmation, under that class.

## 7. Frame handling (Phases 3–5)

- **One frame in flight** (`FrameGate`). Frames that arrive while busy are dropped and counted as dropped. Capture is rate-capped by Advanced "Max inference rate".
- **Sampling:** at the moment each frame is presented (`requestVideoFrameCallback`), capped by "Max inference rate". **Default 30** (Phase 3 measurement: 24–30 fps on WebGPU, ~18 on WASM, no dropped video frames on the M4 Max; slower devices drop more samples). Reversible: 15 gave 0% drops everywhere here.
- **Smooth overlays:**
  - Phase 3 holds the latest result for up to 0.5 s of media time, so it lags about one sampling interval.
  - The overlay redraws on every presented video frame and never shows a result from before a seek.
  - From Phase 4, boxes are drawn from the tracker's Kalman prediction at the displayed media time. Untracked raw detections (Debug view) stay held.
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
