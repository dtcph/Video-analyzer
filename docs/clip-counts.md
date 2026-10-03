# Clip counts (Phase 4)

Totals the app reports for each clip in `test-vid/`, with the ID switches and double counts observed, so they can be compared against the footage. Measured 2026-10-03 on the M4 Max, Chrome 154, production build, YOLOv8n ("Fast"), default settings: People + Animals + Transportation, confidence 25%, max inference rate 30 fps, **confirmation frames 3, track-lost buffer 2 s**. Each clip was played once from start to end at 1×.

**Counting rule** (user decisions, 2026-10-03): a track is counted once, when it is confirmed; its count then **follows its majority class** (score-weighted votes of its above-threshold detections). When the majority changes, the count moves from the old class to the new one, so the sum never changes; a tie keeps the current class.

How to reproduce:

```bash
npm run e2e:clips -- --build [--backend wasm] [--label name]   # plays all clips in Chrome, records per clip
node scripts/e2e/sweepTracker.ts [--label name] [--every 2]     # replays the recordings with other tracker parameters
node scripts/e2e/sweepTracker.ts --detail steady.mp4            # lists every counted track of one clip
```

Recordings, the tracker input per frame and screenshots with track IDs every 3 s: `.cache/e2e/clip-counts/<label>/` (gitignored). The runs below are `reattr-webgpu-30` and `reattr-wasm-30`.

## 1. Totals per clip

"Expected" is what the footage shows to a person watching it (estimated from frame grids; exact numbers are impossible for the dense clips).

| clip                                   | footage                                                                                              | expected (rough)                                                            | WebGPU                                          | WASM ×8                                         |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------- |
| `moving_handheld.mp4` (1440p, 14.3 s)  | woman walking toward the camera on a field path, handheld                                            | 1 person                                                                    | **1 person**                                    | **1 person**                                    |
| `steady.mp4` (1440p, 18.3 s)           | person + dog walking away from a low camera, strong backlight; **hard cut at 14.38 s** to a new shot | 1 person, 1 dog (2 + 2 if the cut is counted, which a tracker cannot avoid) | 4 person, 2 dog, 1 cow, 1 horse                 | 4 person, 2 dog, 1 cow, 1 horse                 |
| `moving_handheld-2.mp4` (4K, 9 s)      | camera pans with a couple walking past a bus shelter; road behind with parked and passing cars       | 4–5 people (couple + 2–3 in the background), ~8–10 cars, 1 van              | 13 car, 5 person, 1 truck                       | 10 car, 5 person, 1 truck                       |
| `moving_car.mp4` (1080p, 19.7 s)       | handheld camera at a Seoul intersection, pans and walks along a wide road; trucks, buses, taxis      | ~20–30 vehicles, a few distant pedestrians                                  | 47 car, 10 person, 5 truck, 4 bus, 1 motorcycle | 49 car, 5 bus, 4 truck, 3 person, 1 motorcycle  |
| `steady-2.mp4` (720p, 15.7 s)          | dense highway from a bridge, traffic toward the camera, many motorcycles                             | 100+ vehicles (not countable by eye), riders count as people in COCO        | 77 car, 16 person, 1 bus, 1 motorcycle, 1 truck | 76 car, 13 person, 2 motorcycle, 2 truck, 1 bus |
| `moving_drone.mp4` (4K 24 fps, 20.8 s) | slow aerial pass over a parking lot and park                                                         | 150+ parked cars, ~40–60 people (most tiny)                                 | 83 car, 58 person                               | 76 car, 53 person                               |
| `moving_drone-2.mp4` (4K, 38.3 s)      | aerial pass over a park with courts and a parking area                                               | dozens of cars and people, mostly tiny                                      | 43 car, 36 person, 2 bus, 1 truck               | 42 car, 33 person, 2 bus                        |

- **Rates:** WebGPU reached 21.9–29.7 inference fps (3–21% of samples dropped), WASM 18.1–20.3 fps (23–39% dropped). WASM totals are mostly a little lower: fewer frames, so fewer brief objects confirmed.
- **Counted / created tracks** (WebGPU): moving_handheld 1 / 2, steady 8 / 18, moving_handheld-2 19 / 103, moving_car 67 / 408, steady-2 96 / 274, moving_drone 141 / 571, moving_drone-2 82 / 401. The difference is tentative tracks that never reached 3 consecutive frames: flicker that confirmation keeps out of the totals.
- **Run-to-run variation:** re-attribution only moves counts between classes, so the per-clip sums of this run and the previous WebGPU run (count-at-confirmation, same settings) differ only by realtime sampling: moving_car 75 → 67, moving_drone 132 → 141, moving_drone-2 80 → 82, moving_handheld-2 21 → 19, steady-2 100 → 96, steady 8 → 8, moving_handheld 1 → 1. **Expect ±10% between playthroughs on busy clips.**
- **Replay check:** the offline replay of a recording gives the app's totals (exact on `steady.mp4` and `moving_handheld-2.mp4`; ≤ 2 apart elsewhere, probably because the recording rounds scores to 3 decimals, which can move a detection that sits exactly at the 25% threshold).

## 2. What goes wrong, per clip (from the ID screenshots and per-track lists)

- **`moving_handheld.mp4`: correct.** One track for the whole clip.
- **`steady.mp4`: 4 people instead of 1–2, and the dog counted 4 times as dog / horse / cow.**
  - The person walks away from a camera at ground level and shrinks from 67% to 15% of the frame height in about 2 s while the dog walks right in front of them (screenshot `steady__t6.png`). Tracks break there: ID switches by occlusion plus fast scale change.
  - **Why the dog is still "horse" and "cow" with re-attribution:** the dog close to the camera (4.0–6.3 s) is one track, and YOLOv8n labels it "horse" most of the time there. Votes in that phase: horse 16 detections (score sum 12.5), cow 9 (5.6), dog 8 (5.6). Its majority is honestly "horse". A short track where dog and person overlap (5.9–6.5 s) gets mostly "cow" votes. The dog is "mostly dog" only later, far away (6.8–14.4 s), but that is a **separate track** after the break, and re-attribution cannot merge tracks. Re-attribution did change the outcome: compared with count-at-confirmation on the same detections, one count moved from "person" to "cow" and one from "cow" to "horse" (replay: 5 person, 2 dog, 1 cow → 4 person, 2 dog, 1 horse, 1 cow).
  - The cut at 14.38 s starts new tracks for both (expected; no tracker links across a cut).
  - One short false "person" after the cut (8 hits, 0.6 s).
- **`moving_handheld-2.mp4`: about 1.5× too many cars, people about right.** The camera pans continuously, so parked cars slide across the frame; small cars (1–3% of the width) behind the bus shelter and trees drop out and come back as new tracks. The couple is sometimes one box, sometimes two (model).
- **`moving_car.mp4`: about 2× too many cars.** Panning plus cars entering, leaving and being occluded by closer cars. Seen ID switch: track #102 is the silver sedan at t = 9 s and a distant white car at t = 12 s (the sedan left the frame and its track took over another car). Such a switch does not add a count but hides one. The "persons" are real pedestrians on the far sidewalk, 1–3% of the frame wide and visible only between passing cars; each glimpse is a new track.
- **`steady-2.mp4`: plausible.** Fixed camera, objects approach steadily; IDs are stable in the screenshots. Riders are counted as "person" (COCO semantics) and motorcycles are often missed or merged with their rider, so 1–2 motorcycles is far below what the footage shows (model limitation).
- **`moving_drone.mp4`, `moving_drone-2.mp4`: undercounted cars, plausible people.** Most IDs survive the slow drone motion (in the earlier run, compare `moving_drone__t9.png` and `__t12.png`: #1, #4, #5, #11, #15, #29, #96, #192, #199, #201, #223, #226, #306 persist). But YOLOv8n at 640 input finds only part of the small cars, near the threshold, so far fewer cars are counted than parked. "Accurate" (YOLOv8s) or a larger input size would help more than any tracker setting.

**Summary:** fixed-camera footage and large objects count well; moving cameras over-count by about 1.5–2×, from ID switches (no camera-motion compensation; planned as Phase 6b); tiny objects are under-detected by the model. Totals are no longer inflated by flicker (see N = 1 below), but re-counting after ID switches remains, and a track's class can only be as good as the model's majority over that track.

## 3. Choosing the defaults (evidence)

All numbers below come from replaying one WebGPU recording (`webgpu-30`, made at the earlier provisional defaults) through the tracker with other parameters and the re-attribution rule: every setting sees exactly the same detections. "Half rate" keeps every 2nd recorded frame, simulating a device that reaches ~15 fps. Format: objects counted (suspected re-counts). A suspected re-count is a counted track that starts within 3 s and about one box size of where an earlier counted track of the same kind was last seen (heuristic; it flags ID switches and re-entries). Re-attribution does not change these sums, only the class split.

### Confirmation frames N × track-lost buffer

| clip              | N=1, 2 s  | N=2, 2 s | **N=3, 1 s** | **N=3, 2 s** | N=3, 3 s | N=4, 2 s | N=5, 2 s |
| ----------------- | --------- | -------- | ------------ | ------------ | -------- | -------- | -------- |
| moving_car        | 200 (163) | 112 (76) | 80 (48)      | 75 (45)      | 75 (43)  | 59 (36)  | 51 (26)  |
| moving_drone      | 252 (59)  | 164 (24) | 158 (38)     | 134 (15)     | 127 (13) | 116 (10) | 99 (5)   |
| moving_drone-2    | 196 (50)  | 106 (16) | 90 (13)      | 83 (7)       | 83 (7)   | 70 (2)   | 66 (1)   |
| moving_handheld-2 | 51 (26)   | 33 (12)  | 21 (7)       | 21 (7)       | 20 (5)   | 18 (4)   | 17 (3)   |
| moving_handheld   | 2 (0)     | 1 (0)    | 1 (0)        | 1 (0)        | 1 (0)    | 1 (0)    | 1 (0)    |
| steady-2          | 156 (46)  | 118 (17) | 101 (12)     | 99 (9)       | 99 (9)   | 91 (9)   | 85 (2)   |
| steady            | 13 (2)    | 9 (2)    | 8 (2)        | 8 (2)        | 8 (2)    | 8 (2)    | 7 (1)    |

Per-class, at full and at half rate:

| clip              | N=1, 1 s                                                                  | N=3, 2 s (default)                                         | N=3, 2 s at half rate                           | N=5, 2 s                                       | N=5, 2 s at half rate                           |
| ----------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------- | ----------------------------------------------- |
| moving_car        | 113 car, 80 person, 11 bus, 10 truck, 4 motorcycle, 2 bicycle, 1 airplane | 50 car, 12 person, 6 truck, 4 bus, 2 motorcycle, 1 bicycle | 42 car, 4 truck, 4 bus, 2 person, 1 motorcycle  | 39 car, 4 truck, 4 bus, 3 person, 1 motorcycle | 32 car, 3 truck, 3 bus, 1 person                |
| moving_drone      | 199 car, 128 person, 1 bird, 1 truck                                      | 76 car, 58 person                                          | 66 car, 41 person                               | 59 car, 40 person                              | 52 car, 33 person                               |
| moving_drone-2    | 102 person, 90 car, 16 truck, 3 bus, 2 boat, 2 sheep, …                   | 43 car, 36 person, 2 bus, 2 truck                          | 41 car, 30 person, 1 bus                        | 37 car, 28 person, 1 bus                       | 33 car, 23 person, 1 bus                        |
| moving_handheld-2 | 32 car, 21 person, 3 truck, 1 bus                                         | 13 car, 6 person, 1 bus, 1 truck                           | 11 car, 5 person, 1 truck                       | 11 car, 5 person, 1 truck                      | 8 car, 3 person, 1 truck                        |
| moving_handheld   | 2 person                                                                  | 1 person                                                   | 1 person                                        | 1 person                                       | 1 person                                        |
| steady-2          | 116 car, 34 person, 8 motorcycle, 7 truck, 1 bus                          | 78 car, 17 person, 2 motorcycle, 1 bus, 1 truck            | 70 car, 12 person, 3 motorcycle, 1 bus, 1 truck | 71 car, 12 person, 1 bus, 1 motorcycle         | 65 car, 10 person, 1 truck, 1 bus, 1 motorcycle |
| steady            | 5 person, 3 dog, 2 horse, 2 bicycle, 1 cow                                | 4 person, 2 dog, 1 horse, 1 cow                            | 4 person, 2 dog, 1 horse                        | 4 person, 2 dog, 1 horse                       | 3 person, 2 dog, 1 horse                        |

Reading:

- **N = 1** counts every flicker: 1.3–2.7× the N = 3 totals, with phantom classes (airplane, boat, sheep, bicycle, bird). **N = 2** still adds 10–50%.
- **N = 3 → 5** keeps lowering totals, but now real, briefly visible objects disappear too (moving_car: the far pedestrians are real; at N = 5 and half rate only 1 remains). N counts frames, not time, so on a slower device each step of N costs more: N = 5 at 15 fps needs 0.33 s of uninterrupted detection.
- **Chosen: N = 3** (unchanged from the provisional value). Users who analyze steady footage with large objects can raise it.
- **Lost buffer:** 2 s lowers suspected re-counts against 1 s on every clip (moving_drone 38 → 15, moving_drone-2 13 → 7, steady-2 12 → 9); 3 s adds almost nothing. **Chosen: 2 s** (was 1 s). The cost: an object that leaves and a different one that appears within 2 s at the predicted position share a track (one count instead of two); not observed in the screenshots.

### Internal constants (not settings; N = 3, lost buffer 2 s; total objects counted)

| variant                                         | moving_car | moving_drone | moving_drone-2 | moving_handheld-2 | steady-2 | steady |
| ----------------------------------------------- | ---------- | ------------ | -------------- | ----------------- | -------- | ------ |
| before buffered IoU (penalty 0.2, dup. suppr.)  | 93         | 162          | 92             | 29                | 103      | 8      |
| class penalty 0 (class ignored when matching)   | 88         | 162          | 91             | 28                | 107      | 9      |
| class penalty 0.5                               | 93         | 163          | 92             | 31                | 105      | 10     |
| strict per-class matching                       | 93         | 163          | 92             | 32                | 110      | 11     |
| no cross-class duplicate suppression            | 91         | 162          | 92             | 32                | 116      | 9      |
| no low-score second stage                       | 92         | 164          | 94             | 28                | 107      | 8      |
| **+ buffered IoU 0.5 for lost tracks (chosen)** | **75**     | **134**      | **83**         | **21**            | **99**   | **8**  |
| + buffered IoU 0.3 tracked / 0.5 lost           | 77         | 127          | 84             | 22                | 96       | 8      |
| + buffered IoU 1.0 for lost tracks              | 67         | 123          | 83             | 18                | 95       | 8      |

- **Cross-class matching with penalty 0.2** (user decision) beats strict per-class matching on every clip (steady 8 vs 11: dog/horse/cow flicker; steady-2 110 → 103).
- **Duplicate suppression** removes car + truck boxes that class-aware NMS keeps on the same vehicle (steady-2: 10 trucks → 1).
- **Buffered IoU for lost tracks** (enlarge both boxes by 50% per side before IoU when re-associating a lost track; C-BIoU, Yang et al. 2023) is the largest single improvement on moving-camera clips (−15 to −28%) and changes fixed-camera clips by ≤ 4%. 1.0 cuts more but risks merging neighbours in dense scenes; not chosen.

## 4. Caveats

- One playthrough per clip and backend; totals vary by up to ~10% between playthroughs on busy clips (see section 1).
- "Expected" counts are estimates from frame grids, not a labeled ground truth.
- Rewinding, seeking or replaying counts objects again (user decision); press **Reset counts** before replaying. The clip runs play each clip once from the start; `npm run e2e:counts` checks that a seek keeps the totals and clears the tracks.
