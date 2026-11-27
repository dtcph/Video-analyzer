"""COCO metrics for candidate runs on the 500-image val2017 subset (every 10th image id, eval/.out/coco/val500.json).

  python -I eval/scripts/coco_eval.py <cand-json> [<cand-json> ...]     (needs pycocotools + numpy)

Prints per candidate: mAP@[.5:.95], AP50 (pycocotools COCOeval on the subset, all detections >= 0.05, top 100),
AP for dog/person, and precision / recall at IoU 0.5 for score thresholds 0.3..0.7 (greedy matching, same class),
plus the dog-, scarf- and control-pool proxies (labels = search query, not verified per image).
"""
import json, sys, io, contextlib
import numpy as np
from pycocotools.coco import COCO
from pycocotools.cocoeval import COCOeval

with contextlib.redirect_stdout(io.StringIO()):
    gt = COCO("eval/.out/coco/annotations/instances_val2017.json")
ids = json.load(open("eval/.out/coco/val500.json"))
name2cat = {c["name"]: c["id"] for c in gt.loadCats(gt.getCatIds())}
WRONG_DOG = {"giraffe", "teddy bear", "bear", "horse", "cow", "sheep", "cat", "zebra", "elephant"}
SCARF_FALSE = {"giraffe", "knife", "tie", "teddy bear", "zebra"}
QUERY = {"cat": "cat", "car": "car", "bicycle": "bicycle", "cup": "cup", "laptop": "laptop", "person": "person",
         "horse": "horse", "giraffe": "giraffe", "kitchen": "knife", "bus": "bus"}
manifest = json.load(open("eval/pool/manifest.json"))


def iou(a, b):
    w = min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0]); h = min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1])
    return 0 if w <= 0 or h <= 0 else w * h / (a[2] * a[3] + b[2] * b[3] - w * h)


def evaluate(path):
    d = json.load(open(path)); rows = d["sets"]["coco"]
    res = []
    for r in rows:
        iid = int(r["file"].split("/")[-1][:12])
        for n, s, x, y, w, h in r["raw"]:
            if n in name2cat: res.append({"image_id": iid, "category_id": name2cat[n], "bbox": [x, y, w, h], "score": s})
    with contextlib.redirect_stdout(io.StringIO()):
        dt = gt.loadRes(res) if res else None
        E = COCOeval(gt, dt, "bbox"); E.params.imgIds = ids; E.evaluate(); E.accumulate(); E.summarize()
    out = {"name": d["name"], "mAP": E.stats[0], "AP50": E.stats[1], "speed": d.get("speed"), "load": d.get("load", {}).get("ms")}
    for cls in ("dog", "person"):
        k = list(E.params.catIds).index(name2cat[cls]); p = E.eval["precision"][:, :, k, 0, 2]
        out[f"AP_{cls}"] = float(np.mean(p[p > -1])) if (p > -1).any() else float("nan")
    # precision / recall at thresholds (IoU 0.5, same class, greedy by score)
    pr = {}
    for t in (0.3, 0.4, 0.5, 0.55, 0.6, 0.65, 0.7, 0.8):
        tp = fp = 0; ngt = 0
        for r in rows:
            iid = int(r["file"].split("/")[-1][:12])
            g = [(a["category_id"], a["bbox"]) for a in gt.loadAnns(gt.getAnnIds(imgIds=iid, iscrowd=False))]
            ngt += len(g); used = set()
            for n, s, x, y, w, h in sorted(r["raw"], key=lambda z: -z[1]):
                if s < t or n not in name2cat: continue
                best, bi = 0.5, -1
                for j, (c, b) in enumerate(g):
                    if j in used or c != name2cat[n]: continue
                    v = iou((x, y, w, h), b)
                    if v >= best: best, bi = v, j
                if bi >= 0: used.add(bi); tp += 1
                else: fp += 1
        pr[t] = (tp / max(1, tp + fp), tp / max(1, ngt))
    out["pr"] = pr
    # pools
    def share(setname, pred, t):
        rs = d["sets"].get(setname, []); return sum(1 for r in rs if pred(r, t)) / max(1, len(rs)), len(rs)
    names = lambda r, t: {n for n, s, *_ in r["raw"] if s >= t}
    out["pool"] = {}
    for t in (0.4, 0.5, 0.6, 0.65, 0.7):
        out["pool"][t] = {
            "dog_found": share("dog", lambda r, t: "dog" in names(r, t), t)[0],
            "dog_confused": share("dog", lambda r, t: bool(names(r, t) & WRONG_DOG), t)[0],
            "scarf_false": share("scarf", lambda r, t: bool(names(r, t) & SCARF_FALSE), t)[0],
            "control_hit": share("control", lambda r, t: QUERY[manifest[r["file"].split("pool/")[1]]["query"].split()[0]] in names(r, t), t)[0],
        }
    return out


for p in sys.argv[1:]:
    o = evaluate(p)
    sp = o["speed"] or {}
    print(f"{o['name']:<14} mAP {o['mAP']*100:5.1f}  AP50 {o['AP50']*100:5.1f}  AP_dog {o['AP_dog']*100:5.1f}  AP_person {o['AP_person']*100:5.1f}  "
          f"1080p {sp.get('meanMs','?')} ms  load {o['load'] and round(o['load'])} ms")
    print("    P/R@thr " + "  ".join(f"{t}: {p*100:.0f}/{r*100:.0f}" for t, (p, r) in o["pr"].items()))
    print("    pools  " + "  ".join(f"@{t}: dog {v['dog_found']*100:.0f}% confused {v['dog_confused']*100:.0f}% | scarf-false {v['scarf_false']*100:.0f}% | control {v['control_hit']*100:.0f}%" for t, v in o["pool"].items()))
