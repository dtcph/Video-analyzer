"""Scores eval runs against eval/fixtures/manifest.json and prints Markdown tables.

  python3 -I eval/scripts/score.py objects <run.json> [<before.json>]
  python3 -I eval/scripts/score.py emotions <run.json> [<before.json>]

Objects rule (per image): expected "X" passes when X is detected and no confusable class (WRONG[X]) is;
expected "no K" passes when K is not detected. Evaluated at the app default (0.40) and at the slider minimum (0.20),
using the raw list (all detections >= 0.05) of the run.
Emotions rule: an image is a hit when the expected class is the emotion of one of the detected persons.
"""
import json, sys

M = json.load(open("eval/fixtures/manifest.json"))
WRONG = {"dog": {"giraffe", "teddy bear", "bear", "horse", "cow", "sheep", "cat", "zebra", "elephant"}}


def dets(row, thr):
    return [(d[0], d[1]) for d in row["raw"] if d[1] >= thr]


def judge(exp, ds):
    names = {n for n, _ in ds}
    if exp.startswith("no "):
        return exp[3:] not in names
    return exp in names and not (names & WRONG.get(exp, set()))


def fmt(ds, limit=4):
    return ", ".join(f"{n} {s:.2f}" for n, s in sorted(ds, key=lambda x: -x[1])[:limit]) or "–"


def objects(run, before):
    rows = {r["file"].split("fixtures/")[1]: r for r in run["rows"]}
    prev = {r["file"].split("fixtures/")[1]: r for r in before["rows"]} if before else {}
    head = "| Bild | Erwartet | " + ("Vorher @0.40 | Vorher @0.20 | " if before else "") + "Ist @0.40 | Ist @0.20 | OK @0.40 | OK @0.20 |"
    print(head); print("|" + "---|" * (head.count("|") - 1))
    ok = {0.4: 0, 0.2: 0}
    for k, meta in M["objects"].items():
        r = rows[k]; exp = meta["expected"]
        cells = [k.split("/")[-1].replace(".jpg", ""), exp]
        if before:
            cells += [fmt(dets(prev[k], 0.4)), fmt(dets(prev[k], 0.2))]
        res = {t: judge(exp, dets(r, t)) for t in (0.4, 0.2)}
        for t in res: ok[t] += res[t]
        cells += [fmt(dets(r, 0.4)), fmt(dets(r, 0.2)), "ja" if res[0.4] else "**nein**", "ja" if res[0.2] else "**nein**"]
        print("| " + " | ".join(cells) + " |")
    n = len(M["objects"])
    print(f"\nKorrekt: {ok[0.4]}/{n} bei 0.40, {ok[0.2]}/{n} bei 0.20")


def emo_hit(row, exp):
    return any(p["emotion"] == exp for p in row["chain"])


def emotions(run, before):
    rows = {r["file"].split("fixtures/")[1]: r for r in run["rows"]}
    prev = {r["file"].split("fixtures/")[1]: r for r in before["rows"]} if before else {}
    head = "| Bild | Erwartet | " + ("Vorher | " if before else "") + "Ist | Treffer |"
    print(head); print("|" + "---|" * (head.count("|") - 1))
    per = {}
    for k, meta in M["emotions"].items():
        r = rows[k]; exp = meta["expected"]
        show = lambda rr: ", ".join(str(p["emotion"] or "kein Gesicht") for p in rr["chain"][:3]) or "keine Person"
        hit = emo_hit(r, exp)
        per.setdefault(exp, [0, 0, 0]); per[exp][0] += hit; per[exp][1] += 1
        if before: per[exp][2] += emo_hit(prev[k], exp)
        cells = [k.split("/")[-1].replace(".jpg", ""), exp] + ([show(prev[k])] if before else []) + [show(r), "ja" if hit else "nein"]
        print("| " + " | ".join(cells) + " |")
    print("\n| Klasse | " + ("Vorher | " if before else "") + "Ist |"); print("|---|---|" + ("---|" if before else ""))
    for c, (h, n, hb) in per.items():
        print(f"| {c} | " + (f"{hb}/{n} |" if before else "") + f" {h}/{n} |")
    tot = sum(v[0] for v in per.values()); n = sum(v[1] for v in per.values())
    print(f"\nGesamt: {tot}/{n}" + (f" (vorher {sum(v[2] for v in per.values())}/{n})" if before else ""))


kind, path = sys.argv[1], sys.argv[2]
run = json.load(open(path)); before = json.load(open(sys.argv[3])) if len(sys.argv) > 3 else None
{"objects": objects, "emotions": emotions}[kind](run, before)
