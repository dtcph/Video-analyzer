# Performance pass (Phase 8)

Measured 2026-10-06 on the production build (`vite preview`), headless Chrome 154, Apple M4 Max. That is a fast machine: **nothing here was measured on weaker hardware.** Earlier numbers: [benchmarks.md](benchmarks.md).

## 1. How it was measured

`scripts/e2e/profileFlow.ts` plays clips in the real app and times every frame without changing app code. It wraps the page's `Worker` before the app loads and records:

- when each frame is sent;
- when its answer arrives;
- the worker's own stage times (preprocessing, model run including GPU upload and download, postprocessing);
- main-thread long tasks.

```bash
node scripts/e2e/profileFlow.ts --build --label x            # realtime, 8 s per clip after a 1 s settle
node scripts/e2e/profileFlow.ts --build --label x --pre      # pre-analysis, whole clip
node scripts/e2e/profileFlow.ts --build --label x --load     # first visit, empty cache, 50 Mbit/s
```

**Configurations:** YOLOv8s on WebGPU (the default "Auto"), YOLOv8n on WebGPU ("Fast"), and YOLOv8n on WASM with 8 threads (what Auto picks without WebGPU).

**Clips:** `moving_car` (1080p), `steady-2` (720p) and `moving_drone-2` (4K), all at 30 fps, with the 30 fps cap. Pre-analysis speed for all 7 clips comes from `npm run e2e:pre -- --build --speed [--model n] [--backend wasm]`.

Values are p50 / p95 per frame. Run-to-run spread is about ±15% on WebGPU (benchmarks.md), so smaller differences are noise.

## 2. Baseline profile: where the time went

Realtime, before any change:

| config      | inference fps | frames dropped | round trip | pre     | model run | post    | messaging | worker idle until next frame |
| ----------- | ------------- | -------------- | ---------- | ------- | --------- | ------- | --------- | ---------------------------- |
| YOLOv8s GPU | 30.1          | 0–1%           | 12.6–13.4  | 2.3–3.1 | 9.5–9.7   | 0.6     | 0.1       | 20–21 ms                     |
| YOLOv8n GPU | 29.4–30.1     | 0–2%           | 12.7–13.1  | 2.3–2.9 | 9.5–9.8   | 0.5–0.6 | 0.1       | 20–21 ms                     |
| YOLOv8n CPU | 18.6–26.3     | 12–38%         | 20.9–21.9  | 1.8–3.0 | 18.5–18.8 | 0.4     | 0.1       | 12–29 ms                     |

Findings:

- **WebGPU already keeps up with 30 fps video on this machine.** A frame takes 13 ms out of the 33 ms between frames. The model run takes 9.5 ms, close to the Phase 1 bench (8.3–8.6 ms).
  - Phase 7 had reported 22.7–24.6 fps for YOLOv8s. Re-running that same test (`e2e:video`) now gives 30 fps, so the Phase 7 figure was a noisy run, not a gap between the app and the bench.
- **WASM dropped 12–38% of frames although a frame takes 21 ms, less than the 33 ms between frames.** Logging every `requestVideoFrameCallback` showed why:
  - With the CPU busy, Chrome presents the video frames unevenly, alternating 17 ms and 50 ms apart instead of every 33 ms.
  - The frame after a 17 ms gap always arrived while the worker was still busy, and the app dropped it, as designed.
  - The worker then sat idle until the next frame.
- **The main thread is not a bottleneck.** There were no long tasks (≥ 50 ms), messaging costs 0.1 ms, and the tracker ≤ 0.6 ms (Phase 4).
- **Pre-analysis kept the worker 98–99% busy**, one frame at a time. Main-thread overlap could not gain anything there. Only the worker's own steps can overlap: on WebGPU, the model run hands the work to the GPU and the worker thread just waits, so preprocessing the next frame fits in that wait.
- **First visit** (Auto, empty cache, 50 Mbit/s, 20 ms latency): the model is ready after **8.6 s**.
  - Downloads: the model (22.4 MB), then the WebGPU runtime (26.8 MB uncompressed in `vite preview`).
  - A reload with the Cache API filled: **0.37 s**.
  - Downloading both in parallel would not help, because they share the same bandwidth. Compression would: Vercel compresses responses depending on file type, to be checked on the real deployment (§5).

## 3. Changes and their effect

### Fix 1: the newest frame waits instead of being dropped (realtime)

`FrameGate` keeps one frame in flight plus **one waiting frame**:

- A frame sampled while the worker is busy waits and is sent the moment the answer arrives.
- A newer frame replaces it, and the replaced one counts as dropped.
- A seek drops the waiting frame.

The paused-frame detection still waits until the gate is idle. Files: [FrameGate.ts](../src/inference/FrameGate.ts), [RealtimeVideo.ts](../src/app/RealtimeVideo.ts).

| config      | clip           | inference fps before → after | frames dropped before → after |
| ----------- | -------------- | ---------------------------- | ----------------------------- |
| YOLOv8n CPU | moving_car     | 19.9 → **30.1**              | 33% → **0%**                  |
| YOLOv8n CPU | steady-2       | 18.6 → **30.0**              | 38% → **0%**                  |
| YOLOv8n CPU | moving_drone-2 | 26.3 → **30.0**              | 12% → **0%**                  |
| YOLOv8s GPU | all three      | 30.1 → 30.1                  | 0–1% → 0%                     |
| YOLOv8n GPU | all three      | 29.4–30.1 → 30.1             | 0–2% → 0%                     |

`e2e:video` (WASM at the 30 fps cap):

- before: 16.8–18.3 fps, 38–41% of frames dropped;
- after: **30.0–30.2 fps, 0% dropped**;
- box lag p50 67 → 34 ms.

The waiting frame adds no latency on this machine: the round trip stays 21–22 ms.

On a slower device, the worker no longer idles until the next video frame, which removes up to one frame interval per inference. That could not be measured here.

**Effect on counts.** The counting rules are unchanged, but WASM now analyzes about 1.7× more frames, so its totals change. Scored against the user's ground truth at 35% (`sweepTracker.ts --truth`; summed per-class error, lower is better):

| run                             | Σ error |
| ------------------------------- | ------- |
| WASM before (Phase 4 recording) | 42      |
| WASM after (`p8-wasm`)          | 40      |
| YOLOv8n on WebGPU (`p7-webgpu`) | 37      |

35% remains the best threshold on WASM (tied with 40%).

### Fix 2: preprocessing overlaps the model run (WebGPU; mostly pre-analysis)

- **Worker:** each frame is preprocessed as soon as its message arrives; only the model run waits its turn. Input buffers come from a small pool, and each is reused only after its model run has finished.
- **Pre-analysis:** keeps **two frames in flight** and stores the results in sample order, so the worker always has the next frame ready.
- Files: [inference.worker.ts](../src/inference/inference.worker.ts), [PreAnalysisRunner.ts](../src/analysis/PreAnalysisRunner.ts).

Pre-analysis, frames per second (profile, 3 clips):

| config      | moving_car       | steady-2          | moving_drone-2    |
| ----------- | ---------------- | ----------------- | ----------------- |
| YOLOv8s GPU | 95.6 → **113.1** | 97.0 → **114.8**  | 92.1 → **112.8**  |
| YOLOv8n GPU | 98.9 → **146.5** | 110.0 → **142.4** | 103.8 → **136.8** |
| YOLOv8n CPU | 47.3 → 46.9      | 47.9 → 45.9       | 44.9 → 43.8       |

All 7 clips (`e2e:pre --speed`), × realtime:

| clip              | Auto (YOLOv8s GPU) | Fast (YOLOv8n GPU) | YOLOv8n CPU |
| ----------------- | ------------------ | ------------------ | ----------- |
| moving_car        | 3.05 → **3.69**    | 3.51 → **4.42**    | 1.53 → 1.56 |
| moving_drone (4K) | 3.67 → **4.47**    | 4.03 → **5.33**    | 1.78 → 1.86 |
| moving_drone-2    | 3.01 → **3.67**    | 3.42 → **4.54**    | 1.44 → 1.48 |
| moving_handheld   | 3.08 → **3.68**    | 3.45 → **4.96**    | 1.52 → 1.52 |
| moving_handheld-2 | 2.86 → **3.39**    | 3.11 → **4.21**    | 1.46 → 1.46 |
| steady            | 3.09 → **3.72**    | 3.54 → **5.01**    | 1.53 → 1.53 |
| steady-2          | 3.05 → **3.57**    | 3.57 → **4.31**    | 1.54 → 1.58 |

- **Gains:** WebGPU +17–22% with YOLOv8s and +21–44% with YOLOv8n (all 7 clips). The YOLOv8n gain is larger than the preprocessing time alone (1.3–2 ms). The GPU also never idles between frames, and its model run dropped from 7.2–8.2 to 6.2–7.0 ms.
- **WASM is unchanged** (within noise): the model run blocks the worker thread there, so nothing can overlap.
- **Totals are identical** before and after in all 21 runs (7 clips × 3 configurations), as expected: the same frames are analyzed in the same order.
- **Realtime** still sends one frame at a time (fix 1), so this change does not help realtime on this machine. Overlapping realtime frames as well would only help a GPU that cannot keep up with the video, and would make the waiting frame older. Not done, since it can't be measured here.

## 4. Considered and not done

| idea                                                    | why not                                                                                                                                                      |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Download runtime and model in parallel                  | Same bandwidth: no gain on a bandwidth-limited link (measured 8.6 s, almost all of it download).                                                             |
| WebGPU IO binding (input/output stay on the GPU)        | Preprocessing is 1.3–3 ms and is now hidden behind the model run in pre-analysis. Keeping it all on the GPU needs a custom shader: more risk than gain here. |
| Preprocessing with a WebGPU shader (no canvas readback) | Same as above; may matter on weak GPUs, not measurable here.                                                                                                 |
| Tracker or rendering optimizations                      | No long tasks; tracker ≤ 0.6 ms per frame.                                                                                                                   |
| More than two frames in flight (pre-analysis)           | Two already keep the worker busy (overlapping stage times exceed 100% of the wall time).                                                                     |

## 5. Not measured

- **Weaker or integrated GPUs, phones, Windows, a device without `shader-f16`.** On such devices the model run dominates and Auto may be too slow with YOLOv8s. The Model setting offers "Fast". A measurement there would decide whether Auto should also consider speed.
- **The real deployment:** compression of `.wasm` and `.onnx` by Vercel, and the first-load time over a real network. Check with the commands in [release-checklist.md](release-checklist.md).
- **Headed Chrome** (all runs headless) and long sessions (thermal throttling).
