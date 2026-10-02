# Clip evaluation

Generated 2026-10-02T06:25:24.950Z by `npm run eval -- --check --out docs/v2/results/phase1`.
Node v24.16.0, darwin/arm64. Sample rate 12 fps; analysis resolution fit within 960x540.
"Implausible": >20 blobs. Motion = normal-path motion-mask coverage of the frame. ms/frame = AnalysisEngine.analyzeFrame (detection + exposure), excluding decode/downscale. Precision/recall: hand-labeled keyframes in scripts/eval/labels/.

| clip | mode | profile | frames | blobs mean | blobs p95 | blobs max | >5 blobs | >10 blobs | >20 blobs | >50 blobs | first >20 | motion mean | motion p95 | motion >5% | motion >10% | motion >25% | comp applied | ms/frame mean | ms/frame p95 | track ms mean | tracks started | tracks confirmed | precision | recall | TP / FP | movers hit |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| moving_car.mp4 | moving-car | moving-car | 235 | 39.7 | 89.3 | 111 | 99.6% | 99.6% | 87.2% | 21.3% | 0.17s | 4.8% | 10.1% | 35.7% | 5.5% | 0.0% | 76.2% | 26.6 | 35.5 | 0.34 | 663 | 228 | 0.64 | 0.94 | 151 / 85 | 17/18 |
| moving_drone-2.mp4 | moving-drone | moving-drone | 458 | 27.7 | 59.0 | 74 | 98.3% | 91.7% | 59.8% | 9.8% | 2.00s | 2.4% | 8.2% | 14.6% | 1.7% | 0.0% | 90.6% | 24.3 | 33.2 | 0.25 | 1314 | 481 | 0.07 | 0.71 | 8 / 105 | 5/7 |
| moving_drone.mp4 | moving-drone | moving-drone | 249 | 3.5 | 9.0 | 12 | 22.1% | 2.4% | 0.0% | 0.0% | never | 0.5% | 0.3% | 0.4% | 0.4% | 0.4% | 99.6% | 22.2 | 24.8 | 0.05 | 175 | 61 | 0.25 | 0.25 | 4 / 12 | 4/16 |
| moving_handheld-2.mp4 | moving-handheld | moving-handheld | 107 | 2.8 | 7.0 | 11 | 19.6% | 0.9% | 0.0% | 0.0% | never | 0.2% | 0.5% | 0.0% | 0.0% | 0.0% | 100.0% | 9.8 | 11.5 | 0.03 | 45 | 13 | 0.92 | 1.00 | 11 / 1 | 6/6 |
| moving_handheld.mp4 | moving-handheld | moving-handheld | 170 | 19.7 | 36.5 | 47 | 89.4% | 80.6% | 48.8% | 0.0% | 2.08s | 2.0% | 6.5% | 7.1% | 1.8% | 0.0% | 65.9% | 15.8 | 22.9 | 0.14 | 340 | 129 | 0.17 | 1.00 | 24 / 120 | 6/6 |
| steady-2.mp4 | steady | steady | 188 | 14.2 | 21.7 | 26 | 99.5% | 83.5% | 8.5% | 0.0% | 0.17s | 5.2% | 8.7% | 48.9% | 1.6% | 0.0% | 0.0% | 13.3 | 18.9 | 0.10 | 295 | 126 | – | – | – | – |
| steady.mp4 | steady | steady | 218 | 2.5 | 9.0 | 12 | 17.4% | 1.8% | 0.0% | 0.0% | never | 1.3% | 3.6% | 1.8% | 0.5% | 0.5% | 0.0% | 7.0 | 15.0 | 0.03 | 172 | 40 | – | – | – | – |

## Threshold checks

Rules and thresholds: scripts/eval/thresholds.ts (approved 2026-10-02, see docs/v2/baseline.md).

### moving_car.mp4 [moving-car] — gate: FAIL

| check | value | target |  |
| --- | --- | --- | --- |
| frames >20 blobs | 87.2% | ≤ 5.0% | ✗ |
| motion mean | 4.8% | ≤ 5.0% | ok |
| motion p95 | 10.1% | ≤ 10.0% | ✗ |
| blobs mean | 39.68 | ≤ 10.00 | ✗ |
| keyframe precision | 0.64 | ≥ 0.60 | ok |
| keyframe recall (≥ V1) | 0.94 | ≥ 0.72 | ok |
| ms/frame p95 | 35.5ms | ≤ 83.3ms | ok |
| ms/frame mean (≤ V1 +10%) | 26.6ms | ≤ 54.6ms | ok |

### moving_drone-2.mp4 [moving-drone] — gate: FAIL

| check | value | target |  |
| --- | --- | --- | --- |
| frames >20 blobs | 59.8% | ≤ 5.0% | ✗ |
| motion mean | 2.4% | ≤ 5.0% | ok |
| motion p95 | 8.2% | ≤ 10.0% | ok |
| blobs mean | 27.67 | ≤ 10.00 | ✗ |
| keyframe precision | 0.07 | ≥ 0.60 | ✗ |
| keyframe recall (≥ V1) | 0.71 | ≥ 0.43 | ok |
| ms/frame p95 | 33.2ms | ≤ 83.3ms | ok |
| ms/frame mean (≤ V1 +10%) | 24.3ms | ≤ 24.6ms | ok |

### moving_drone.mp4 [moving-drone] — gate: FAIL

| check | value | target |  |
| --- | --- | --- | --- |
| frames >20 blobs | 0.0% | ≤ 5.0% | ok |
| motion mean | 0.5% | ≤ 5.0% | ok |
| motion p95 | 0.3% | ≤ 10.0% | ok |
| blobs mean | 3.52 | ≤ 10.00 | ok |
| keyframe precision | 0.25 | ≥ 0.60 | ✗ |
| keyframe recall (≥ V1) | 0.25 | ≥ 0.19 | ok |
| ms/frame p95 | 24.8ms | ≤ 83.3ms | ok |
| ms/frame mean (≤ V1 +10%) | 22.2ms | ≤ 17.1ms | ✗ |

### moving_handheld-2.mp4 [moving-handheld] — handheld-no-regression: PASS

| check | value | target |  |
| --- | --- | --- | --- |
| frames >20 blobs | 0.0% | ≤ 0.0% | ok |
| blobs mean | 2.78 | ≤ 4.00 | ok |
| ms/frame p95 | 11.5ms | ≤ 83.3ms | ok |
| ms/frame mean (≤ V1 +10%) | 9.8ms | ≤ 13.8ms | ok |

### moving_handheld.mp4 [moving-handheld] — stretch: below stretch target (not gating)

| check | value | target |  |
| --- | --- | --- | --- |
| frames >20 blobs | 48.8% | ≤ 5.0% | ✗ |
| motion mean | 2.0% | ≤ 5.0% | ok |
| motion p95 | 6.5% | ≤ 10.0% | ok |
| blobs mean | 19.66 | ≤ 10.00 | ✗ |
| keyframe precision | 0.17 | ≥ 0.60 | ✗ |
| keyframe recall (≥ V1) | 1.00 | ≥ 1.00 | ok |
| ms/frame p95 | 22.9ms | ≤ 83.3ms | ok |
| ms/frame mean (≤ V1 +10%) | 15.8ms | ≤ 42.6ms | ok |

### steady-2.mp4 [steady] — steady: PASS

| check | value | target |  |
| --- | --- | --- | --- |
| identical to v1-comp-off | yes | yes, or within tolerance | ok |
| ms/frame p95 | 18.9ms | ≤ 83.3ms | ok |
| ms/frame mean (≤ V1 +10%) | 13.3ms | ≤ 17.9ms | ok |

### steady.mp4 [steady] — steady: PASS

| check | value | target |  |
| --- | --- | --- | --- |
| identical to v1-comp-off | yes | yes, or within tolerance | ok |
| ms/frame p95 | 15.0ms | ≤ 83.3ms | ok |
| ms/frame mean (≤ V1 +10%) | 7.0ms | ≤ 10.9ms | ok |


## Rejection reasons (total candidates rejected over the clip)

- moving_car.mp4 [moving-car]: insufficient-persistence 23267, parallax-background 88, incoherent-direction 9015, edge-like 31
- moving_drone-2.mp4 [moving-drone]: insufficient-persistence 30148, incoherent-direction 10284, edge-like 292, parallax-background 1719
- moving_drone.mp4 [moving-drone]: insufficient-persistence 7124, incoherent-direction 1834, edge-like 12
- moving_handheld-2.mp4 [moving-handheld]: insufficient-persistence 1144, incoherent-direction 319
- moving_handheld.mp4 [moving-handheld]: insufficient-persistence 18129, incoherent-direction 5226, edge-like 13, parallax-background 33
- steady-2.mp4 [steady]: insufficient-persistence 2750, incoherent-direction 1248
- steady.mp4 [steady]: insufficient-persistence 1177, edge-like 10, incoherent-direction 559
