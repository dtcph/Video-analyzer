"""Accuracy proxy for the exported ONNX variants (Phase 1, docs/benchmarks.md).

For each frame (test-img/*.jpg plus FRAMES_PER_CLIP evenly spaced frames per
clip in test-vid/), the reference is Ultralytics' own PyTorch prediction of the
same model at 640 px (conf 0.25, iou 0.7). Each ONNX variant runs on CPU
onnxruntime with numpy pre/postprocessing that mirrors the browser pipeline
(letterbox, pad 114, class-aware NMS; rect letterbox for dynamic-shape files). Detections match when the class agrees and
IoU >= 0.5. This measures agreement with the reference model, not COCO mAP.

Run from the repository root inside the export venv:
    python scripts/bench/compare_variants.py [--models .cache/models-bench]
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np
import onnxruntime as ort
from ultralytics import YOLO

CONF = 0.25
IOU = 0.7
MATCH_IOU = 0.5
FRAMES_PER_CLIP = 6


def load_frames() -> list[tuple[str, np.ndarray]]:
    frames = [(path.name, cv2.imread(str(path))) for path in sorted(Path("test-img").glob("*.jpg"))]
    for clip in sorted(Path("test-vid").glob("*.mp4")):
        capture = cv2.VideoCapture(str(clip))
        count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
        for i in range(FRAMES_PER_CLIP):
            index = int((i + 0.5) * count / FRAMES_PER_CLIP)
            capture.set(cv2.CAP_PROP_POS_FRAMES, index)
            ok, frame = capture.read()
            if ok:
                frames.append((f"{clip.stem}#{index}", frame))
        capture.release()
    return frames


def letterbox(bgr: np.ndarray, size: int, rect: bool) -> tuple[np.ndarray, float, float, float]:
    """Square, or rect (short side padded to a multiple of 32) like src/inference/preprocess.ts."""
    height, width = bgr.shape[:2]
    scale = min(size / width, size / height)
    new_w, new_h = round(width * scale), round(height * scale)
    in_w = -(-new_w // 32) * 32 if rect else size
    in_h = -(-new_h // 32) * 32 if rect else size
    pad_x, pad_y = (in_w - new_w) / 2, (in_h - new_h) / 2
    canvas = np.full((in_h, in_w, 3), 114, dtype=np.uint8)
    left, top = int(round(pad_x - 0.1)), int(round(pad_y - 0.1))
    canvas[top : top + new_h, left : left + new_w] = cv2.resize(bgr, (new_w, new_h), interpolation=cv2.INTER_LINEAR)
    tensor = canvas[:, :, ::-1].transpose(2, 0, 1)[None].astype(np.float32) / 255.0
    return np.ascontiguousarray(tensor), scale, left, top


def iou_matrix(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    if len(a) == 0 or len(b) == 0:
        return np.zeros((len(a), len(b)))
    x1 = np.maximum(a[:, None, 0], b[None, :, 0])
    y1 = np.maximum(a[:, None, 1], b[None, :, 1])
    x2 = np.minimum(a[:, None, 2], b[None, :, 2])
    y2 = np.minimum(a[:, None, 3], b[None, :, 3])
    inter = np.clip(x2 - x1, 0, None) * np.clip(y2 - y1, 0, None)
    area_a = (a[:, 2] - a[:, 0]) * (a[:, 3] - a[:, 1])
    area_b = (b[:, 2] - b[:, 0]) * (b[:, 3] - b[:, 1])
    return inter / (area_a[:, None] + area_b[None, :] - inter + 1e-9)


def nms(boxes: np.ndarray, scores: np.ndarray, classes: np.ndarray) -> np.ndarray:
    keep: list[int] = []
    for cls in np.unique(classes):
        idx = np.where(classes == cls)[0]
        idx = idx[np.argsort(-scores[idx])]
        while len(idx):
            keep.append(idx[0])
            if len(idx) == 1:
                break
            overlaps = iou_matrix(boxes[idx[:1]], boxes[idx[1:]])[0]
            idx = idx[1:][overlaps <= IOU]
    return np.array(keep, dtype=int)


def run_onnx(session: ort.InferenceSession, bgr: np.ndarray, size: int, in_model_nms: bool, rect: bool) -> np.ndarray:
    """Returns detections as [x1, y1, x2, y2, score, class] in source pixels."""
    tensor, scale, left, top = letterbox(bgr, size, rect)
    output = session.run(None, {session.get_inputs()[0].name: tensor})[0][0]
    if in_model_nms:
        dets = output[output[:, 4] >= CONF].copy()
    else:
        preds = output.T  # [N, 84]
        scores = preds[:, 4:].max(1)
        classes = preds[:, 4:].argmax(1)
        mask = scores >= CONF
        cx, cy, w, h = preds[mask, :4].T
        boxes = np.stack([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2], 1)
        keep = nms(boxes, scores[mask], classes[mask])
        dets = np.concatenate([boxes[keep], scores[mask][keep, None], classes[mask][keep, None]], 1)
    dets[:, [0, 2]] = (dets[:, [0, 2]] - left) / scale
    dets[:, [1, 3]] = (dets[:, [1, 3]] - top) / scale
    return dets


def match(reference: np.ndarray, candidate: np.ndarray) -> int:
    """Greedy one-to-one matches (same class, IoU >= MATCH_IOU), highest IoU first."""
    if len(reference) == 0 or len(candidate) == 0:
        return 0
    ious = iou_matrix(reference[:, :4], candidate[:, :4])
    ious[reference[:, None, 5] != candidate[None, :, 5]] = 0
    matched = 0
    while True:
        r, c = np.unravel_index(np.argmax(ious), ious.shape)
        if ious[r, c] < MATCH_IOU:
            return matched
        matched += 1
        ious[r, :] = 0
        ious[:, c] = 0


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--models", type=Path, default=Path(".cache/models-bench"))
    parser.add_argument("--weights-dir", type=Path, default=Path(".cache/weights"))
    parser.add_argument("--json", type=Path, default=Path(".cache/compare_variants.json"))
    args = parser.parse_args()

    frames = load_frames()
    manifest = json.loads((args.models / "manifest.json").read_text())
    references: dict[str, list[np.ndarray]] = {}
    for model in sorted({entry["model"] for entry in manifest["files"].values()}):
        yolo = YOLO(str(args.weights_dir / f"{model}.pt"))
        references[model] = []
        for _, frame in frames:
            result = yolo.predict(frame, imgsz=640, conf=CONF, iou=IOU, verbose=False)[0].boxes
            references[model].append(
                np.concatenate([result.xyxy.numpy(), result.conf.numpy()[:, None], result.cls.numpy()[:, None]], 1)
            )

    rows = []
    for name, info in manifest["files"].items():
        session = ort.InferenceSession(str(args.models / name), providers=["CPUExecutionProvider"])
        ref_total = cand_total = matched = 0
        for (_, frame), reference in zip(frames, references[info["model"]]):
            dets = run_onnx(session, frame, info["inputSize"], info["variant"] == "nms", info["variant"].startswith("dyn"))
            ref_total += len(reference)
            cand_total += len(dets)
            matched += match(reference, dets)
        row = {
            "file": name,
            "letterbox": "rect" if info["variant"].startswith("dyn") else "square",
            "reference": f"{info['model']} PyTorch 640",
            "referenceDetections": ref_total,
            "detections": cand_total,
            "precision": round(matched / max(cand_total, 1), 3),
            "recall": round(matched / max(ref_total, 1), 3),
        }
        rows.append(row)
        print(json.dumps(row))

    # How much the n model misses compared with the s model, both PyTorch 640.
    if "yolov8n" in references and "yolov8s" in references:
        matched = sum(match(s, n) for n, s in zip(references["yolov8n"], references["yolov8s"]))
        total_s = sum(len(s) for s in references["yolov8s"])
        total_n = sum(len(n) for n in references["yolov8n"])
        print(json.dumps({"yolov8n_vs_yolov8s": {"s": total_s, "n": total_n, "recall_of_n": round(matched / total_s, 3)}}))

    per_still = {
        name: {model: [int(c) for c in refs[i][:, 5]] for model, refs in references.items()}
        for i, (name, _) in enumerate(frames)
        if name.endswith(".jpg")
    }
    args.json.parent.mkdir(parents=True, exist_ok=True)
    args.json.write_text(json.dumps({"frames": len(frames), "rows": rows, "stillClasses": per_still}, indent=2))


if __name__ == "__main__":
    main()
