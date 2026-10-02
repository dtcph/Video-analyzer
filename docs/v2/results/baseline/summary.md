# Clip evaluation

Generated 2026-10-02T06:02:07.768Z by `npm run eval -- --out docs/v2/results/baseline`.
Node v24.16.0, darwin/arm64. Sample rate 12 fps; analysis resolution fit within 960x540.
"Implausible": >20 blobs. Motion = normal-path motion-mask coverage of the frame. ms/frame = AnalysisEngine.analyzeFrame (detection + exposure), excluding decode/downscale. Precision/recall: hand-labeled keyframes in scripts/eval/labels/.

| clip | mode | profile | frames | blobs mean | blobs p95 | blobs max | >5 blobs | >10 blobs | >20 blobs | >50 blobs | first >20 | motion mean | motion p95 | motion >5% | motion >10% | motion >25% | comp applied | ms/frame mean | ms/frame p95 | track ms mean | tracks started | tracks confirmed | precision | recall | TP / FP | movers hit |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| moving_car.mp4 | moving-car | v1-default | 235 | 36.4 | 63.3 | 71 | 97.4% | 93.2% | 77.0% | 23.8% | 0.17s | 19.9% | 29.7% | 100.0% | 94.0% | 22.1% | 63.0% | 49.6 | 70.0 | 0.33 | 1497 | 416 | 0.32 | 0.72 | 69 / 145 | 13/18 |
| moving_car.mp4 | moving-car | v1-motion-field | 235 | 37.3 | 63.0 | 74 | 97.4% | 93.2% | 83.8% | 23.8% | 0.17s | 20.2% | 29.9% | 100.0% | 89.8% | 29.4% | 38.7% | 61.2 | 85.0 | 0.30 | 1354 | 401 | 0.34 | 0.89 | 66 / 127 | 16/18 |
| moving_car.mp4 | moving-car | v1-comp-off | 235 | 40.5 | 65.0 | 74 | 99.6% | 94.9% | 81.3% | 37.4% | 0.17s | 22.7% | 30.8% | 100.0% | 97.9% | 33.2% | 0.0% | 56.2 | 73.9 | 0.30 | 1300 | 403 | 0.31 | 0.78 | 62 / 141 | 14/18 |
| moving_drone-2.mp4 | moving-drone | v1-default | 458 | 27.5 | 63.0 | 76 | 96.3% | 86.5% | 56.1% | 14.0% | 3.00s | 5.4% | 12.9% | 37.1% | 12.9% | 0.0% | 46.9% | 22.3 | 36.6 | 0.27 | 1560 | 523 | 0.02 | 0.43 | 3 / 130 | 3/7 |
| moving_drone-2.mp4 | moving-drone | v1-motion-field | 458 | 29.2 | 60.0 | 83 | 98.3% | 91.7% | 63.3% | 13.1% | 2.92s | 4.7% | 12.5% | 27.7% | 10.7% | 0.0% | 90.6% | 28.1 | 43.8 | 0.29 | 1386 | 501 | 0.05 | 0.57 | 6 / 125 | 4/7 |
| moving_drone-2.mp4 | moving-drone | v1-comp-off | 458 | 35.1 | 68.0 | 80 | 98.3% | 93.9% | 78.6% | 24.9% | 1.33s | 5.3% | 13.2% | 36.7% | 13.1% | 0.0% | 0.0% | 20.3 | 36.0 | 0.31 | 1220 | 512 | 0.03 | 0.71 | 6 / 179 | 5/7 |
| moving_drone.mp4 | moving-drone | v1-default | 249 | 5.5 | 14.0 | 21 | 42.2% | 11.6% | 0.8% | 0.0% | 18.25s | 2.9% | 5.0% | 5.2% | 0.4% | 0.4% | 99.6% | 15.6 | 22.1 | 0.05 | 409 | 87 | 0.13 | 0.19 | 3 / 21 | 3/16 |
| moving_drone.mp4 | moving-drone | v1-motion-field | 249 | 4.7 | 12.6 | 21 | 30.1% | 10.8% | 0.4% | 0.0% | 20.58s | 1.7% | 3.3% | 0.4% | 0.4% | 0.4% | 99.6% | 22.6 | 27.4 | 0.06 | 227 | 71 | 0.25 | 0.25 | 4 / 12 | 4/16 |
| moving_drone.mp4 | moving-drone | v1-comp-off | 249 | 14.3 | 30.6 | 42 | 94.4% | 61.8% | 18.9% | 0.0% | 3.50s | 5.2% | 9.0% | 43.4% | 1.2% | 0.4% | 0.0% | 19.6 | 28.6 | 0.14 | 654 | 182 | 0.08 | 0.19 | 3 / 34 | 3/16 |
| moving_handheld-2.mp4 | moving-handheld | v1-default | 107 | 3.6 | 7.0 | 13 | 20.6% | 1.9% | 0.0% | 0.0% | never | 1.4% | 3.2% | 0.0% | 0.0% | 0.0% | 100.0% | 12.5 | 18.2 | 0.03 | 82 | 21 | 0.79 | 1.00 | 11 / 3 | 6/6 |
| moving_handheld-2.mp4 | moving-handheld | v1-motion-field | 107 | 3.5 | 7.7 | 11 | 18.7% | 0.9% | 0.0% | 0.0% | never | 0.7% | 1.9% | 0.0% | 0.0% | 0.0% | 100.0% | 22.3 | 27.5 | 0.05 | 70 | 20 | 0.83 | 0.83 | 10 / 2 | 5/6 |
| moving_handheld-2.mp4 | moving-handheld | v1-comp-off | 107 | 39.4 | 53.0 | 56 | 95.3% | 94.4% | 91.6% | 12.1% | 0.33s | 13.9% | 17.9% | 95.3% | 90.7% | 0.0% | 0.0% | 37.6 | 48.6 | 0.25 | 392 | 143 | 0.06 | 1.00 | 16 / 234 | 6/6 |
| moving_handheld.mp4 | moving-handheld | v1-default | 170 | 30.8 | 52.5 | 61 | 82.9% | 75.9% | 74.1% | 8.8% | 0.17s | 14.4% | 19.6% | 90.0% | 79.4% | 0.0% | 62.9% | 38.7 | 51.4 | 0.22 | 555 | 189 | 0.11 | 1.00 | 23 / 186 | 6/6 |
| moving_handheld.mp4 | moving-handheld | v1-motion-field | 170 | 32.6 | 55.0 | 71 | 82.4% | 75.9% | 74.7% | 12.4% | 0.17s | 14.3% | 20.0% | 87.6% | 78.8% | 0.0% | 29.4% | 51.2 | 65.9 | 0.19 | 499 | 189 | 0.10 | 1.00 | 24 / 216 | 6/6 |
| moving_handheld.mp4 | moving-handheld | v1-comp-off | 170 | 33.4 | 55.0 | 71 | 90.0% | 80.0% | 75.3% | 11.8% | 0.17s | 15.1% | 20.0% | 92.9% | 83.5% | 0.0% | 0.0% | 38.3 | 50.9 | 0.20 | 517 | 196 | 0.10 | 1.00 | 24 / 217 | 6/6 |
| steady-2.mp4 | steady | v1-default | 188 | 14.2 | 21.7 | 26 | 99.5% | 83.5% | 8.5% | 0.0% | 0.17s | 5.2% | 8.7% | 48.9% | 1.6% | 0.0% | 100.0% | 16.2 | 21.9 | 0.10 | 293 | 126 | – | – | – | – |
| steady-2.mp4 | steady | v1-motion-field | 188 | 14.0 | 21.0 | 25 | 98.4% | 76.6% | 6.4% | 0.0% | 0.17s | 5.2% | 8.7% | 47.3% | 1.6% | 0.0% | 100.0% | 25.4 | 31.3 | 0.13 | 300 | 129 | – | – | – | – |
| steady-2.mp4 | steady | v1-comp-off | 188 | 14.2 | 21.7 | 26 | 99.5% | 83.5% | 8.5% | 0.0% | 0.17s | 5.2% | 8.7% | 48.9% | 1.6% | 0.0% | 0.0% | 13.4 | 19.2 | 0.09 | 295 | 126 | – | – | – | – |
| steady.mp4 | steady | v1-default | 218 | 2.5 | 9.0 | 12 | 17.4% | 1.8% | 0.0% | 0.0% | never | 1.3% | 3.6% | 1.8% | 0.5% | 0.5% | 99.5% | 9.9 | 17.6 | 0.03 | 172 | 40 | – | – | – | – |
| steady.mp4 | steady | v1-motion-field | 218 | 2.4 | 9.0 | 12 | 17.4% | 1.4% | 0.0% | 0.0% | never | 1.3% | 3.6% | 1.8% | 0.5% | 0.5% | 99.5% | 27.8 | 34.7 | 0.03 | 177 | 39 | – | – | – | – |
| steady.mp4 | steady | v1-comp-off | 218 | 2.5 | 9.0 | 12 | 17.4% | 1.8% | 0.0% | 0.0% | never | 1.3% | 3.6% | 1.8% | 0.5% | 0.5% | 0.0% | 7.1 | 14.4 | 0.03 | 172 | 40 | – | – | – | – |

## Rejection reasons (total candidates rejected over the clip)

- moving_car.mp4 [v1-default]: insufficient-persistence 15675, incoherent-direction 6680, edge-like 249, parallax-background 17, large-unstable-region 27
- moving_car.mp4 [v1-motion-field]: insufficient-persistence 14936, parallax-background 12, edge-like 190, incoherent-direction 6706, large-unstable-region 25
- moving_car.mp4 [v1-comp-off]: insufficient-persistence 12353, incoherent-direction 6690, edge-like 155, large-unstable-region 34
- moving_drone-2.mp4 [v1-default]: insufficient-persistence 33815, incoherent-direction 11810, edge-like 469, parallax-background 162
- moving_drone-2.mp4 [v1-motion-field]: insufficient-persistence 27736, incoherent-direction 10866, edge-like 491, parallax-background 1914
- moving_drone-2.mp4 [v1-comp-off]: insufficient-persistence 28247, incoherent-direction 12105, edge-like 455
- moving_drone.mp4 [v1-default]: insufficient-persistence 14650, incoherent-direction 3520, edge-like 51
- moving_drone.mp4 [v1-motion-field]: insufficient-persistence 7045, incoherent-direction 1955, edge-like 12
- moving_drone.mp4 [v1-comp-off]: insufficient-persistence 20463, incoherent-direction 8612, edge-like 259
- moving_handheld-2.mp4 [v1-default]: insufficient-persistence 2694, incoherent-direction 398, edge-like 9
- moving_handheld-2.mp4 [v1-motion-field]: insufficient-persistence 1414, incoherent-direction 346, edge-like 1
- moving_handheld-2.mp4 [v1-comp-off]: insufficient-persistence 10132, incoherent-direction 5078, edge-like 32
- moving_handheld.mp4 [v1-default]: insufficient-persistence 18472, incoherent-direction 8244, edge-like 74, parallax-background 21, large-unstable-region 1
- moving_handheld.mp4 [v1-motion-field]: insufficient-persistence 16815, incoherent-direction 8479, edge-like 29
- moving_handheld.mp4 [v1-comp-off]: insufficient-persistence 19059, incoherent-direction 8813, edge-like 57, large-unstable-region 3
- steady-2.mp4 [v1-default]: insufficient-persistence 2718, incoherent-direction 1242
- steady-2.mp4 [v1-motion-field]: insufficient-persistence 2703, parallax-background 28, incoherent-direction 1243
- steady-2.mp4 [v1-comp-off]: insufficient-persistence 2750, incoherent-direction 1248
- steady.mp4 [v1-default]: insufficient-persistence 1177, edge-like 10, incoherent-direction 559
- steady.mp4 [v1-motion-field]: insufficient-persistence 1197, edge-like 12, incoherent-direction 560
- steady.mp4 [v1-comp-off]: insufficient-persistence 1177, edge-like 10, incoherent-direction 559
