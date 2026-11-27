"""Offline simulation of the adaptive second pass: when the normal pass has a box (score >= 0.3) covering at least
`area` of the frame, the frame is re-run with a gray border and that result replaces the first one.
  python3 -I eval/scripts/adaptive.py <normal.json> <border.json> <out.json> <area>
Also prints how many frames per set would need the second pass."""
import json, sys
a, b, out, area = sys.argv[1], sys.argv[2], sys.argv[3], float(sys.argv[4])
A, B = json.load(open(a)), json.load(open(b))
counts = {}
for s, rows in A["sets"].items():
    bmap = {r["file"]: r for r in B["sets"][s]}; n = 0
    for r in rows:
        big = any(d[1] >= 0.3 and d[4] * d[5] >= area * r["w"] * r["h"] for d in r["raw"])
        if big: r["raw"] = bmap[r["file"]]["raw"]; n += 1
    counts[s] = f"{n}/{len(rows)}"
A["name"] = f"adaptive{area}"
json.dump(A, open(out, "w")); print(A["name"], "second pass:", counts)
