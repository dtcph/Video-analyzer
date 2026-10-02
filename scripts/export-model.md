# Exporting the YOLOv8 ONNX models

The app ships the ONNX files in `public/models/`. They are generated from Ultralytics' official COCO-pretrained YOLOv8 weights by [`export_models.py`](export_models.py) and can be rebuilt byte-for-byte.

## Requirements

- Python 3.13 (3.10+ should work)
- About 2 GB of disk for PyTorch
- Network access to download the weights

## Steps

From the repository root:

```bash
python3 -m venv .venv-export
.venv-export/bin/pip install -r scripts/requirements-export.txt

# Files the app ships → public/models/ (+ manifest.json with SHA-256 per file)
.venv-export/bin/python scripts/export_models.py --set release

# Optional: every Phase 1 benchmark candidate → .cache/models-bench/ (gitignored)
.venv-export/bin/python scripts/export_models.py --set benchmark
```

`.venv-export/` and `.cache/` are gitignored. Downloaded weights are cached in `.cache/weights/`.

## Where the weights come from

Ultralytics downloads `yolov8n.pt` and `yolov8s.pt` from its own GitHub release: `https://github.com/ultralytics/assets/releases/download/v8.4.0/`. The script records their SHA-256 in `manifest.json`.

| file         | SHA-256                                                            |
| ------------ | ------------------------------------------------------------------ |
| `yolov8n.pt` | `f59b3d833e2ff32e194b5bb8e08d211dc7c5bdf144b90d2c8412c47ccfc83b36` |
| `yolov8s.pt` | `1f47a78bf100391c2a140b7ac73a1caae18c32779be7d310658112f7ac9aa78a` |

The weights and the exported files are licensed under **AGPL-3.0** by Ultralytics; see https://github.com/ultralytics/ultralytics.

## Shipped files

| file                        | contents                                              | used for                             |
| --------------------------- | ----------------------------------------------------- | ------------------------------------ |
| `yolov8n-640-dyn-fp16.onnx` | YOLOv8n, dynamic H/W, FP16 weights, FP32 input/output | default model, WebGPU and WASM       |
| `yolov8n-640-dyn.onnx`      | YOLOv8n, dynamic H/W, FP32                            | WebGPU adapters without `shader-f16` |
| `yolov8s-640-dyn-fp16.onnx` | YOLOv8s, dynamic H/W, FP16                            | "Accurate" model                     |

**Input:** `images` `[1, 3, H, W]` float32, RGB in 0..1. H and W are multiples of 32. The app letterboxes to 640 on the long side and pads the short side to the next multiple of 32, e.g. 640×384 for 16:9.

**Output:** `output0` `[1, 84, N]`:

- rows 0–3 are cx, cy, w, h in input pixels;
- rows 4–83 are the 80 COCO class scores.

NMS runs in JavaScript (`src/inference/postprocess.ts`).

## Reproducibility

Every file has its SHA-256 in `public/models/manifest.json`. With the pinned versions in `requirements-export.txt`, three independent exports on macOS (Apple M4 Max, CPU export) produced identical bytes.

Two non-deterministic parts are removed after export:

- the `date` metadata field;
- the optional `value_info` shape annotations, which onnxslim fills differently from run to run.

**Not verified:** other operating systems or CPU architectures. PyTorch tracing could differ there; the exported graph should still be numerically equivalent.

## Notes on the conversion

- **FP16** uses `onnxconverter_common.float16.convert_float_to_float16(keep_io_types=True)` after clearing `value_info`. The graph's own `Cast` nodes, from the anchor grid of dynamic exports, are excluded from conversion. Without these two steps onnxruntime refuses to load the result.
- **Ultralytics' native `half=True`** export was tried. It produces float16 _inputs_, which would need a Float16Array conversion in JS, so it is not used.
