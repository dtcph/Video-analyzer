"""Export Ultralytics YOLOv8 (COCO-pretrained) to ONNX for the browser.

Usage (from the repository root, inside the venv described in scripts/export-model.md):

    python scripts/export_models.py --set release      # files the app ships, into public/models/
    python scripts/export_models.py --set benchmark    # every Phase 1 candidate, into .cache/models-bench/

Weights are downloaded by Ultralytics from its official GitHub release
(github.com/ultralytics/assets). Every source .pt and every output file is
recorded with its SHA-256 in <out>/manifest.json so a rebuild can be checked
against the published files.

Variants:
  fp32   plain export: input images[1,3,S,S] float32 0..1 RGB, output0[1,84,N]
         (cx, cy, w, h in input pixels, then 80 class scores), NMS done in JS.
  fp16   fp32 graph converted to float16 weights/compute, float32 inputs and outputs.
  int8   dynamic weight quantization (uint8 weights, activations quantized at runtime).
  nms    NMS inside the graph: output0[1,300,6] = x1, y1, x2, y2, score, class.
         Bakes in iou=0.7 and a 0.05 confidence floor (raise the threshold in JS).
  dyn    fp32 with dynamic batch/height/width: one file for every input size, and
         non-square ("rect") inputs such as 640x384 for 16:9 frames.
  dyn-fp16  dyn converted to float16 like fp16.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import tempfile
from pathlib import Path

import onnx
import ultralytics
from onnxconverter_common import float16
from onnxruntime.quantization import QuantType, quantize_dynamic
from ultralytics import YOLO

RELEASE = [
    # (model, export size, variant); see docs/decisions.md. Dynamic shapes serve every
    # input size and rect letterboxing; FP16 everywhere except the FP32 fallback for
    # WebGPU adapters without the shader-f16 feature.
    ("yolov8n", 640, "dyn-fp16"),
    ("yolov8n", 640, "dyn"),
    ("yolov8s", 640, "dyn-fp16"),
]

BENCHMARK = [
    ("yolov8n", 640, "fp32"),
    ("yolov8n", 640, "fp16"),
    ("yolov8n", 640, "int8"),
    ("yolov8n", 640, "nms"),
    ("yolov8n", 640, "dyn"),
    ("yolov8n", 640, "dyn-fp16"),
    ("yolov8n", 416, "fp32"),
    ("yolov8n", 416, "fp16"),
    ("yolov8n", 320, "fp32"),
    ("yolov8n", 320, "fp16"),
    ("yolov8s", 640, "fp32"),
    ("yolov8s", 640, "fp16"),
    ("yolov8s", 640, "int8"),
    ("yolov8s", 416, "fp16"),
    ("yolov8s", 640, "dyn-fp16"),
]

NMS_CONF_FLOOR = 0.05
NMS_IOU = 0.7


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def file_name(model: str, size: int, variant: str) -> str:
    return f"{model}-{size}.onnx" if variant == "fp32" else f"{model}-{size}-{variant}.onnx"


def export_base(weights: Path, size: int, workdir: Path, variant: str, **kwargs) -> Path:
    """Runs the Ultralytics exporter on a private copy of the weights in a fresh folder per output.

    Sharing a folder between exports changes onnxslim's shape annotations (value_info),
    which makes the bytes depend on export order.
    """
    folder = workdir / f"{weights.stem}-{size}-{variant}"
    folder.mkdir()
    copy = folder / weights.name
    shutil.copy(weights, copy)
    exported = YOLO(str(copy)).export(format="onnx", imgsz=size, simplify=True, opset=18, **kwargs)
    return Path(exported)


def build(model: str, size: int, variant: str, weights: Path, workdir: Path, target: Path) -> None:
    if variant == "nms":
        source = export_base(weights, size, workdir, variant, nms=True, conf=NMS_CONF_FLOOR, iou=NMS_IOU)
        shutil.copy(source, target)
    else:
        dynamic = variant.startswith("dyn")
        source = export_base(weights, size, workdir, variant, dynamic=dynamic)
        if variant in ("fp32", "dyn"):
            shutil.copy(source, target)
        elif variant in ("fp16", "dyn-fp16"):
            graph = onnx.load(str(source))
            # The exporter's shape annotations would keep stale float32 types next to the
            # inserted Casts, and onnxruntime then refuses the model (onnxconverter-common 1.16).
            graph.graph.ClearField("value_info")
            # The graph's own Casts belong to the (shape-derived) anchor grid of dynamic exports;
            # converting them breaks type inference, so they keep their float32 targets.
            casts = [node.name for node in graph.graph.node if node.op_type == "Cast"]
            converted = float16.convert_float_to_float16(graph, keep_io_types=True, node_block_list=casts)
            onnx.save(converted, str(target))
        elif variant == "int8":
            quantize_dynamic(str(source), str(target), weight_type=QuantType.QUInt8)
        else:
            raise ValueError(f"unknown variant {variant}")
    normalize(target)
    onnx.checker.check_model(str(target))


def normalize(path: Path) -> None:
    """Makes a rebuild byte-identical: drops the export timestamp from the metadata and the
    optional shape annotations (value_info), which onnxslim fills nondeterministically for
    dynamic-shape exports. onnxruntime infers shapes itself, so nothing is lost."""
    model = onnx.load(str(path))
    kept = [prop for prop in model.metadata_props if prop.key != "date"]
    del model.metadata_props[:]
    model.metadata_props.extend(kept)
    model.graph.ClearField("value_info")
    onnx.save(model, str(path))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--set", choices=["release", "benchmark"], default="release")
    parser.add_argument("--out", type=Path, default=None, help="output directory")
    parser.add_argument("--weights-dir", type=Path, default=Path(".cache/weights"))
    args = parser.parse_args()

    out: Path = args.out or (Path("public/models") if args.set == "release" else Path(".cache/models-bench"))
    out.mkdir(parents=True, exist_ok=True)
    args.weights_dir.mkdir(parents=True, exist_ok=True)
    plan = RELEASE if args.set == "release" else BENCHMARK

    manifest: dict = {
        "ultralytics": ultralytics.__version__,
        "onnx": onnx.__version__,
        "license": "AGPL-3.0 (Ultralytics YOLOv8 weights), https://github.com/ultralytics/ultralytics",
        "weights": {},
        "files": {},
    }

    with tempfile.TemporaryDirectory() as tmp:
        workdir = Path(tmp)
        for model in sorted({entry[0] for entry in plan}):
            weights = args.weights_dir / f"{model}.pt"
            if not weights.exists():
                # Ultralytics resolves a bare "<name>.pt" by downloading it from its GitHub release.
                YOLO(f"{model}.pt")
                shutil.move(f"{model}.pt", weights)
            manifest["weights"][f"{model}.pt"] = sha256(weights)

        for model, size, variant in plan:
            target = out / file_name(model, size, variant)
            build(model, size, variant, args.weights_dir / f"{model}.pt", workdir, target)
            manifest["files"][target.name] = {
                "model": model,
                "inputSize": size,
                "variant": variant,
                "bytes": target.stat().st_size,
                "sha256": sha256(target),
            }
            print(f"wrote {target} ({target.stat().st_size / 1e6:.1f} MB)")

    (out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()
