"""Applies post-processing variants offline to a candidate run (raw detections >= 0.05) and writes a new run file.

  python3 -I eval/scripts/tune.py <cand.json> <out.json> [--dedupe 0.8] [--classmin "teddy bear=0.8,tie=0.9"]

--dedupe: class-agnostic greedy suppression (a box is dropped when it overlaps a stronger kept box with IoU >= x)
--classmin: per-class minimum score
The output has the same shape, so coco_eval.py and score.py run on it unchanged.
"""
import json, sys

args = sys.argv[3:]
opt = lambda k, d=None: args[args.index(k) + 1] if k in args else d
dedupe = float(opt("--dedupe", 0))
classmin = {kv.split("=")[0]: float(kv.split("=")[1]) for kv in opt("--classmin", "").split(",") if kv}


def iou(a, b):
    w = min(a[2] + a[4], b[2] + b[4]) - max(a[2], b[2]); h = min(a[3] + a[5], b[3] + b[5]) - max(a[3], b[3])
    return 0 if w <= 0 or h <= 0 else w * h / (a[4] * a[5] + b[4] * b[5] - w * h)


def apply(raw):
    ds = [d for d in sorted(raw, key=lambda z: -z[1]) if d[1] >= classmin.get(d[0], 0)]
    if not dedupe: return ds
    kept = []
    for d in ds:
        if all(iou(k, d) < dedupe for k in kept): kept.append(d)
    return kept


d = json.load(open(sys.argv[1]))
for rows in d["sets"].values():
    for r in rows: r["raw"] = apply(r["raw"])
d["name"] = d["name"] + (f"+dd{dedupe}" if dedupe else "") + ("+cm" if classmin else "")
json.dump(d, open(sys.argv[2], "w"))
