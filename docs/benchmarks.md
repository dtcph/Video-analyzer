# Phase 1 benchmarks

All numbers measured 2026-10-02 on **one machine**:

- Apple M4 Max (16 logical cores, 40-core GPU, Metal 3);
- macOS;
- Chrome 154, headless, through `scripts/bench/runBrowserBench.ts`.

This is a high-end device. Expect mid-range laptops and phones to be several times slower. **Nothing here was measured on other hardware.**

## Setup

**Test stills** (`test-img/`, gitignored, extracted with ffmpeg from `test-vid/`):

| still                 | source                   | resolution | content                                      |
| --------------------- | ------------------------ | ---------- | -------------------------------------------- |
| `moving_car_t2.0.jpg` | `moving_car.mp4` @ 2.0 s | 1920×1080  | street: trucks, cars, bus                    |
| `steady-2_t1.0.jpg`   | `steady-2.mp4` @ 1.0 s   | 1280×720   | dense highway: ~20 vehicles, motorcycles     |
| `steady_t4.9.jpg`     | `steady.mp4` @ 4.9 s     | 2560×1440  | person and dog in a meadow, strong backlight |

**Pipeline per frame**, in a dedicated worker (`src/bench/bench.worker.ts`):

| stage           | what it covers                                                         |
| --------------- | ---------------------------------------------------------------------- |
| **preprocess**  | letterbox on an OffscreenCanvas, `getImageData`, RGBA → planar float32 |
| **inference**   | `session.run`, including input upload and output download              |
| **postprocess** | decode, class-aware NMS, mapping back to the source frame              |

**Measurement:**

- Each configuration runs in a fresh worker and session.
- 3 warm-up runs, then 20 timed runs per still, so 60 samples per configuration.
- Tables show medians (p50) unless noted.
- "first run" is the first call after session creation, including shader compilation.
- **Not included:** model download and video decode / VideoFrame capture (that comes in Phase 3).

**Settings:** conf 0.25, IoU 0.7 (Ultralytics' predict defaults).

**Letterbox modes:**

- `square`: 640×640.
- `rect`: the long side is scaled to 640 and the short side padded to the next multiple of 32, so 1080p becomes 640×384. Needs a dynamic-shape export.

**Run-to-run spread:** about ±15% for WebGPU at these short times (yolov8n FP16 rect: 7.6–9.8 ms total over 4 runs) and about ±8% for WASM. Treat differences smaller than that as noise.

## 1. Runtime

yolov8n, FP32, 640 square:

| runtime               | onnxruntime-web entry    | session create | first run | pre | infer | post | total   | FPS |
| --------------------- | ------------------------ | -------------- | --------- | --- | ----- | ---- | ------- | --- |
| WebGPU (native EP)    | `onnxruntime-web/webgpu` | 296 ms         | 57 ms     | 1.5 | 8.8   | 0.60 | 10.9 ms | 92  |
| WebGPU (JSEP, legacy) | `onnxruntime-web`        | 290 ms         | 41 ms     | 1.5 | 8.6   | 0.59 | 10.7 ms | 94  |
| WASM, SIMD, 8 threads | `onnxruntime-web/wasm`   | 140 ms         | 47 ms     | 1.5 | 28.4  | 0.62 | 30.5 ms | 33  |

**WASM thread scaling** (yolov8n FP32 640 square):

| threads        | 1     | 4    | 8    | 16                          |
| -------------- | ----- | ---- | ---- | --------------------------- |
| infer p50 (ms) | 191.0 | 50.8 | 28.4 | 55.4 (an earlier run: 40.1) |

16 threads is worse than 8 and unstable: the M4 Max has 12 performance + 4 efficiency cores, and the main thread and video decode need cores too.

**Cross-origin isolation:** without it there is no SharedArrayBuffer and ORT runs 1 thread, which is about 6× slower than 8 threads. Every run above had `crossOriginIsolated === true`.

**Runtime download size** (`.wasm`):

| build                    | raw     | gzip -9 |
| ------------------------ | ------- | ------- |
| plain WASM               | 13.6 MB | 3.5 MB  |
| JSEP (WebGPU)            | 27.0 MB | 6.3 MB  |
| native WebGPU (asyncify) | 25.5 MB | 6.3 MB  |

The JS glue is under 0.4 MB.

## 2. Precision, NMS placement, dynamic shapes

yolov8n, 640 square unless noted:

| variant               | file    | runtime     | infer | total | FPS |
| --------------------- | ------- | ----------- | ----- | ----- | --- |
| FP32                  | 12.3 MB | WebGPU      | 8.8   | 10.9  | 92  |
| FP16                  | 6.2 MB  | WebGPU      | 8.8   | 10.9  | 92  |
| FP16                  | 6.2 MB  | WebGPU JSEP | 15.3  | 17.6  | 57  |
| FP16                  | 6.2 MB  | WASM 8t     | 29.7  | 31.9  | 31  |
| INT8 (dynamic quant.) | 3.3 MB  | WASM 8t     | 37.5  | 39.8  | 25  |
| NMS in graph          | 12.3 MB | WebGPU      | 10.1  | 11.7  | 86  |
| NMS in graph          | 12.3 MB | WASM 8t     | 29.6  | 31.2  | 32  |
| dynamic H/W, rect     | 12.4 MB | WebGPU      | 8.4   | 9.8   | 102 |
| dynamic H/W, rect     | 12.4 MB | WASM 8t     | 18.0  | 19.6  | 51  |

- **FP16** halves the download at no speed cost on the native WebGPU EP. It is slower on JSEP, and roughly neutral on WASM (ORT computes in FP32 there).
- **INT8** (`quantize_dynamic`, uint8 weights → ConvInteger) is **slower** on WASM _and_ less accurate (section 4).
- **In-graph NMS** is slower on WebGPU, likely because its `NonZero` / `ScatterND` / `NonMaxSuppression` nodes fall back to the CPU (not verified per node). Its IoU threshold is fixed at export, so the IoU setting could not change it.
- **Dynamic shapes** cost nothing measurable, and they allow rect letterboxing.

## 3. Rect letterboxing, input size, model size

| model   | variant  | letterbox    | runtime | infer     | total     | FPS     |
| ------- | -------- | ------------ | ------- | --------- | --------- | ------- |
| yolov8n | dyn FP16 | rect 640×384 | WebGPU  | 6.0–8.3   | 7.6–9.8   | 102–132 |
| yolov8n | dyn FP16 | square 640   | WebGPU  | 8.9       | 11.1      | 90      |
| yolov8n | dyn FP16 | rect         | WASM 8t | 18.6–20.8 | 20.1–22.5 | 44–50   |
| yolov8n | dyn FP16 | rect         | WASM 4t | 32.2–33.9 | 33.6–35.4 | 28–30   |
| yolov8n | dyn FP16 | square       | WASM 8t | 32.8      | 35.2      | 28      |
| yolov8n | FP16     | square 416   | WebGPU  | 7.7       | 8.5       | 117     |
| yolov8n | FP16     | square 320   | WebGPU  | 5.3       | 5.8       | 172     |
| yolov8n | FP32     | square 416   | WASM 8t | 14.3      | 15.3      | 65      |
| yolov8n | FP32     | square 320   | WASM 8t | 9.1       | 9.7       | 103     |
| yolov8s | dyn FP16 | rect         | WebGPU  | 8.4–8.6   | 9.8–10.1  | 99–102  |
| yolov8s | dyn FP16 | square       | WebGPU  | 10.9      | 12.9      | 77      |
| yolov8s | FP32     | square       | WebGPU  | 12.2      | 14.4      | 70      |
| yolov8s | dyn FP16 | rect         | WASM 8t | 51.7–58.2 | 53.3–60.0 | 17–19   |
| yolov8s | FP32     | square       | WASM 8t | 91.2      | 93.6      | 11      |
| yolov8s | INT8     | square       | WASM 8t | 106.7     | 109.3     | 9       |

Ranges are from the four repeated runs of the shipped configurations.

- **Rect (640×384 for 16:9)** has 40% fewer pixels than 640×640 at identical detail. It makes WASM about 1.6× faster for both models and yolov8s on WebGPU about 1.25× faster.
- **yolov8n on this GPU barely changes with input size or model size.** n and s both land around 8.3 ms. The GPU is latency-bound here, not compute-bound; the floor sits suspiciously close to one 120 Hz display frame (8.33 ms). On weaker GPUs, compute will dominate and rect / n will matter more. Not verified.
- **Preprocessing** takes 1.1 ms (rect) to 1.5 ms (square) and **postprocessing** 0.4–0.6 ms, together about 15% of a WebGPU frame. That was measured on decoded stills; capture from a playing 1080p/4K video is measured in Phase 3.

## 4. Accuracy proxy

`scripts/bench/compare_variants.py`, run on CPU onnxruntime 1.30.0 in Python. The numpy pipeline mirrors the JS one.

**Frames:** the 3 stills plus 6 evenly spaced frames from each of the 7 clips, 45 frames in total. Several clips are 4K drone or handheld footage with many small objects.

**Reference:** Ultralytics' own PyTorch prediction of the same model at 640 (rect, conf 0.25, IoU 0.7).

**Matching:** same class and IoU ≥ 0.5. This measures agreement with the reference model, **not COCO mAP**; no ground truth was labeled.

| file                 | letterbox | detections (ref.) | precision | recall    |
| -------------------- | --------- | ----------------- | --------- | --------- |
| yolov8n FP32         | square    | 454 (447)         | 0.974     | 0.989     |
| yolov8n FP16         | square    | 455 (447)         | 0.971     | 0.989     |
| yolov8n INT8         | square    | 413 (447)         | 0.925     | **0.855** |
| yolov8n NMS in graph | square    | 454 (447)         | 0.974     | 0.989     |
| **yolov8n dyn FP32** | rect      | 447 (447)         | **1.000** | **1.000** |
| **yolov8n dyn FP16** | rect      | 448 (447)         | 0.996     | 0.998     |
| yolov8n 416          | square    | 245 (447)         | 0.763     | **0.418** |
| yolov8n 320          | square    | 173 (447)         | 0.751     | **0.291** |
| yolov8s FP16         | square    | 539 (535)         | 0.976     | 0.983     |
| yolov8s INT8         | square    | 534 (535)         | 0.936     | 0.935     |
| **yolov8s dyn FP16** | rect      | 533 (535)         | 0.998     | 0.994     |
| yolov8s 416 FP16     | square    | 329 (535)         | 0.784     | **0.482** |

- **Rect with a dynamic model reproduces Ultralytics exactly** (1.000 / 1.000 for FP32). That verifies letterbox, decode, NMS and box mapping end to end. Square letterboxing differs slightly (0.97 / 0.99) only because Ultralytics itself uses rect.
- **FP16 is effectively lossless.** INT8 is not.
- **Smaller inputs lose most detections on this footage:** 42% recall at 416 and 29% at 320. The lost detections are mainly small or distant objects in the drone and highway clips.
- **yolov8n finds only 61.5% of what yolov8s finds** (447 vs 535 detections). On `steady_t4.9.jpg` yolov8n labels the clearly visible dog as **horse** (88%) and a lens flare as **frisbee**. yolov8s labels it **dog**. These are model limitations, not pipeline errors: PyTorch yolov8n gives the same labels.

## 5. Spike: detections on the test stills (browser)

`bench.html` (dev server only) runs yolov8n-640 on all three runtimes. All three agree with each other and with the PyTorch reference.

| still                 | browser, all 3 runtimes, square                         | PyTorch yolov8n                  | PyTorch yolov8s                                |
| --------------------- | ------------------------------------------------------- | -------------------------------- | ---------------------------------------------- |
| `moving_car_t2.0.jpg` | 4 car, 1 truck, 1 bus                                   | same                             | 4 car, 2 truck, 2 bus                          |
| `steady-2_t1.0.jpg`   | 16 car, 2 person, 1 truck, 1 bus                        | 17 car, 2 person, 2 truck, 1 bus | 17 car, 4 truck, 1 bus, 1 person, 1 motorcycle |
| `steady_t4.9.jpg`     | 1 person, 1 horse (= the dog), 1 frisbee (= lens flare) | same                             | 1 person, 1 dog                                |

The square letterbox misses one car and one truck on `steady-2` compared with PyTorch. The rect pipeline that ships matches PyTorch exactly (section 4).

On the dense highway still, yolov8n reports motorcycle riders as "person" without a motorcycle, and misses the white van in the bottom-left corner.

Annotated screenshots are regenerated with `node scripts/bench/runBrowserBench.ts --plan smoke --shots` into `.cache/bench/shots/`. I inspected them: boxes are tight and correctly placed.

## 6. Not measured

- **Other hardware:** integrated GPUs, Windows/Android, phones, GPUs without `shader-f16`.
- **WebGPU IO binding / GPU tensors.**
  - ORT-Web 1.30 has `Tensor.fromGpuBuffer`, `preferredOutputLocation: "gpu-buffer"` and `enableGraphCapture`.
  - Moving preprocessing to the GPU could save at most the ~1.1 ms preprocess step here. The output must come back to the CPU for NMS anyway.
  - Graph capture needs static shapes, which conflicts with rect.
  - Deferred to the Phase 8 performance pass.
- **Video frame capture cost** (VideoFrame → OffscreenCanvas at 1080p/4K): Phase 3.
- **Cold model download and cache behavior:** Phase 2.

## Reproduce

```bash
.venv-export/bin/python scripts/export_models.py --set benchmark
.venv-export/bin/python scripts/bench/compare_variants.py
node scripts/bench/runBrowserBench.ts --plan full     # also: smoke, rect, release; --headed, --shots
```

## Phase 3: realtime video (in the app)

Measured 2026-10-02 with `npm run e2e:video -- --build`. Setup:

- the production bundle in `vite preview`, headless Chrome 154, M4 Max;
- YOLOv8n, rect 640 input;
- 6 s of playback per run, starting at 0 s.

Column meanings:

- **inference fps:** results per second actually achieved.
- **samples dropped:** sampled frames skipped because the previous frame was still in flight. This is the intended way to degrade, not an error.
- **latency:** capture → result on the main thread.
- **video frames dropped:** from `getVideoPlaybackQuality()`, i.e. playback smoothness.
- **box lag:** media time of the drawn frame minus media time of the result its boxes come from.

| clip                     | backend | max fps | inference fps | samples dropped | latency ms | pre / infer / post ms | video frames dropped | box lag p50 / p95 ms |
| ------------------------ | ------- | ------- | ------------- | --------------- | ---------- | --------------------- | -------------------- | -------------------- |
| moving_car (1080p30)     | WebGPU  | 15      | 15.0          | 0%              | 16         | 2.5 / 13.0 / 0.6      | 0 / 182              | 67 / 100             |
| steady-2 (720p30)        | WebGPU  | 15      | 14.9          | 0%              | 23         | 5.2 / 16.4 / 0.8      | 0 / 179              | 66 / 100             |
| moving_drone-2 (2160p30) | WebGPU  | 15      | 15.2          | 0%              | 15         | 4.9 / 8.7 / 0.8       | 0 / 183              | 67 / 100             |
| moving_car               | WebGPU  | **30**  | 26.4          | 12%             | 18         | 2.7 / 14.5 / 0.7      | 0 / 183              | 34 / 100             |
| steady-2                 | WebGPU  | **30**  | 29.2          | 11%             | 14         | 2.2 / 10.7 / 0.6      | 0 / 182              | 34 / 67              |
| moving_drone-2           | WebGPU  | **30**  | 29.8          | 6%              | 12         | 2.6 / 9.1 / 0.5       | 0 / 183              | 33 / 67              |
| moving_car               | WASM ×8 | 15      | 14.9          | 0%              | 21         | 1.9 / 19.1 / 0.4      | 0 / 183              | 67 / 100             |
| steady-2                 | WASM ×8 | 15      | 15.1          | 0%              | 21         | 1.6 / 18.9 / 0.4      | 0 / 182              | 67 / 100             |
| moving_drone-2           | WASM ×8 | 15      | 14.9          | 0%              | 23         | 3.2 / 19.4 / 0.4      | 0 / 183              | 67 / 100             |
| moving_car               | WASM ×8 | **30**  | 18.1          | 40%             | 21         | 1.8 / 18.9 / 0.4      | 0 / 183              | 67 / 100             |
| steady-2                 | WASM ×8 | **30**  | 17.8          | 39%             | 21         | 1.8 / 18.9 / 0.4      | 0 / 182              | 67 / 100             |
| moving_drone-2           | WASM ×8 | **30**  | 16.8          | 40%             | 22         | 2.9 / 18.4 / 0.4      | 0 / 183              | 67 / 100             |

**Correctness checks**, all 12 runs:

- The paused frame is detected exactly: the result's media time equals the displayed frame's.
- **0 stale draws** after seeking, both while paused (to 70%) and while playing (backwards to 20%).
- Results resume after every seek.
- No console errors.

A seek lands on the frame at or just before the target, so the first fresh result can lie up to one frame before it (measured: −3 to −9 ms, or +31 ms when the next frame was sampled).

**Preprocessing video frames.** Decoded `VideoFrame`s live on the GPU, so drawing one into a `willReadFrequently` (CPU) canvas makes Chrome read back the full frame first.

- 4K preprocessing took ~15 ms that way, and the WebGPU 30 fps cap only reached 15–26 fps.
- A GPU canvas scales on the GPU and reads back only 640×384: 2–5 ms, which gives the table above.
- Still images (CPU-side ImageBitmaps) are faster on the CPU canvas (1–2.5 vs 3–11 ms). The GPU path's resampling also shifted one borderline detection on the highway still (17 → 16 cars).
- So the worker uses a GPU canvas for video and a CPU canvas for images.

**Box lag** comes from holding the last result until the next one: about one sampling interval, plus latency. It is 33–67 ms median depending on the effective rate. Phase 4's Kalman prediction draws boxes at the displayed time instead.

**Not measured:**

- Weaker hardware, where the main risk is GPU contention with video decode.
- Long playback (> 6 s per run).
- Headed Chrome; all runs were headless. Headless reported 0 dropped video frames, but its compositor may differ from a visible window.

## Phase 4: tracker cost and full-clip runs

Measured 2026-10-03 with `npm run e2e:clips -- --build` (M4 Max, Chrome 154, headless, YOLOv8n, max 30 fps), each of the 7 clips played to the end once. Tracker time = main-thread `Tracker.update` per sampled frame (filtering, 3 association stages, Kalman), from `performance.now()`.

| clip              | WebGPU inference fps | dropped samples | tracker ms p50 / p95 / max | WASM ×8 inference fps | dropped samples | tracker ms p50 / p95 / max |
| ----------------- | -------------------- | --------------- | -------------------------- | --------------------- | --------------- | -------------------------- |
| moving_car        | 28.4                 | 5%              | 0.05 / 0.08 / 0.34         | 22.1                  | 37%             | 0.05 / 0.08 / 0.34         |
| moving_drone (4K) | 19.6                 | 13%             | 0.30 / 0.41 / 0.60         | 18.9                  | 24%             | 0.18 / 0.25 / 0.38         |
| moving_drone-2    | 23.0                 | 19%             | 0.04 / 0.08 / 0.16         | 18.6                  | 40%             | 0.04 / 0.06 / 0.09         |
| moving_handheld   | 30.2                 | 4%              | 0.02 / 0.02 / 0.05         | 17.0                  | 44%             | 0.01 / 0.02 / 0.05         |
| moving_handheld-2 | 30.2                 | 0%              | 0.04 / 0.06 / 0.22         | 19.4                  | 34%             | 0.03 / 0.04 / 0.06         |
| steady            | 28.5                 | 3%              | 0.02 / 0.03 / 0.07         | 18.1                  | 38%             | 0.02 / 0.03 / 0.05         |
| steady-2          | 25.7                 | 9%              | 0.09 / 0.14 / 0.18         | 19.4                  | 39%             | 0.06 / 0.09 / 0.11         |

- **The tracker costs ≤ 0.6 ms per frame** even on the busiest clip (moving_drone: ~40 tracks, 100+ raw detections), negligible next to inference. No reason to move it into the worker.
- The 4K drone clips reach fewer inference fps on WebGPU here than in the 6 s Phase 3 runs (19.6–23 vs. 26–30): probably denser later sections and contention with 4K decode over a full playthrough (not investigated). 1080p and smaller stay at 25–30 fps.
- Counts and the choice of tracker defaults: [clip-counts.md](clip-counts.md).

## Phase 5: webcam

Measured 2026-10-03 with `npm run e2e:webcam -- --build [--backend wasm]` (M4 Max, Chrome 154, headless, YOLOv8n, max 30 fps). No real camera: Chrome's fake camera played `test-vid/steady-2.mp4` as MJPEG; the camera delivered 1280×720 at 24 fps (asked 1920×1080 at 24). Values after ~6 s of live counting.

| backend | inference fps | sampled frames dropped | latency capture → result | pre / infer / post ms |
| ------- | ------------- | ---------------------- | ------------------------ | --------------------- |
| WebGPU  | 23.1          | 0%                     | 12 ms                    | 2.3 / 9.0 / 0.6       |
| WASM ×8 | 23.9          | 1%                     | 21 ms                    | 1.8 / 18.3 / 0.4      |

- Both backends keep up with a 24 fps 720p camera. A 1080p camera at 30 fps on WASM would drop samples like the video files (~17–20 fps, Phase 3).
- Capture method (rVFC vs. MediaStreamTrackProcessor): no measurable difference, see [decisions.md](decisions.md) §13.
