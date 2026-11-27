"""FER+ stage evaluation: python3 -I eval/scripts/fer_eval.py eval/.out/ferplus-<label>.json"""
import json, sys
E = ["angry", "contempt", "disgusted", "afraid", "happy", "neutral", "sad", "surprised"]
rows = json.load(open(sys.argv[1]))["rows"]
cls = ["angry", "disgusted", "afraid", "happy", "neutral", "sad", "surprised"]
am = lambda p: E[max(range(len(p)), key=lambda i: p[i])]
def acc(pred):
    out = {}
    for c in cls:
        rs = [r for r in rows if r["label"] == c]; out[c] = (sum(pred(r) == c for r in rs), len(rs))
    return out
legacy = acc(lambda r: r["legacy"])
chain = acc(lambda r: am(r["chain"]) if r["chain"] else None)
whole = acc(lambda r: am(r["whole"]))
found_l = sum(r["legacy"] is not None for r in rows); found_c = sum(r["chain"] is not None for r in rows)
print("| Klasse | alte Regel | neue Kette (Landmarks + Ausrichtung) | Klassifikator auf ganzem Bild |"); print("|---|---|---|---|")
for c in cls: print(f"| {c} | {legacy[c][0]}/{legacy[c][1]} | {chain[c][0]}/{chain[c][1]} | {whole[c][0]}/{whole[c][1]} |")
tot = lambda a: sum(v[0] for v in a.values())
print(f"| gesamt | {tot(legacy)}/420 ({tot(legacy)/4.2:.1f} %) | {tot(chain)}/420 ({tot(chain)/4.2:.1f} %) | {tot(whole)}/420 ({tot(whole)/4.2:.1f} %) |")
print(f"Gesicht gefunden: alte Regel {found_l}/420, neue Kette {found_c}/420")
# legacy output distribution on angry faces and confusion of the new chain
from collections import Counter
for c in ("angry", "sad", "neutral"):
    print(f"alte Regel auf {c}:", dict(Counter(str(r['legacy']) for r in rows if r['label'] == c).most_common()))
print("Konfusion ganzes Bild (Zeile = wahr):")
for c in cls: print(" ", c.ljust(9), dict(Counter(am(r["whole"]) for r in rows if r["label"] == c).most_common()))
# MIN_PROB sweep on the app chain (faces found by the landmarker): accuracy of the shown results vs coverage
found = [r for r in rows if r["chain"]]
for t in (0, 0.4, 0.5, 0.6, 0.7):
    kept = [r for r in found if max(r["chain"][:8]) >= t]; ok = sum(am(r["chain"]) == r["label"] for r in kept)
    print(f"MIN_PROB {t} (Kette): angezeigt {len(kept)}/{len(found)} gefundene Gesichter, davon richtig {ok/max(1,len(kept))*100:.1f} % | richtig gesamt {ok}/420")
