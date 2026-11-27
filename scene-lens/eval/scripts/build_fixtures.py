"""Copies the chosen pool images into eval/fixtures/ and writes eval/fixtures/manifest.json (expected label, source, license, transform)."""
import json, os, shutil
m = json.load(open("eval/pool/manifest.json"))
V = {"_C": "ffmpeg crop=iw*0.6:ih*0.6 (centre 60 %)", "_S": "ffmpeg scale=480:-2, JPEG q 12 (webcam-like)", "_B": "ffmpeg crop=iw:ih/2:0:ih/2 (lower half)", "_caf9": "ffmpeg scale=480:-2, JPEG q 8"}
OBJ = [  # (fixture name, source file, expected object, note)
 ("dog-giraffe-1", "pool-var/dog/057_C.jpg", "dog", "known error dog→giraffe"),
 ("dog-giraffe-2", "pool-var/dog/051_S.jpg", "dog", "known error dog→giraffe"),
 ("dog-giraffe-3", "pool-var/dog/060_S.jpg", "dog", "known error dog→giraffe"),
 ("dog-teddy", "pool/dog/046.jpg", "dog", "dog→teddy bear"),
 ("dog-ok-1", "pool/dog/002.jpg", "dog", "correct before"),
 ("dog-ok-2", "pool/dog/044.jpg", "dog", "correct before"),
 ("dog-ok-3", "pool/dog/010.jpg", "dog", "correct before, 2 dogs"),
 ("scarf-knife", "pool-var/scarf3/114_caf9.jpg", "no knife", "known error scarf→knife"),
 ("scarf-giraffe-1", "pool-var/scarf/023_B.jpg", "no giraffe", "scarf pattern→giraffe"),
 ("scarf-giraffe-2", "pool-var/scarf/017_B.jpg", "no giraffe", "scarf pattern→giraffe"),
 ("scarf-tie", "pool/scarf/029.jpg", "no tie", "scarves→tie"),
 ("scarf-person-ok", "pool/scarf/005.jpg", "person", "correct before"),
 ("ctl-cat", "pool/control/001.jpg", "cat", "control"),
 ("ctl-car", "pool/control/015.jpg", "car", "control"),
 ("ctl-bicycle", "pool/control/018.jpg", "bicycle", "control"),
 ("ctl-cup", "pool/control/030.jpg", "cup", "control"),
 ("ctl-laptop", "pool/control/040.jpg", "laptop", "control"),
 ("ctl-person", "pool/control/044.jpg", "person", "control"),
 ("ctl-giraffe", "pool/control/057.jpg", "giraffe", "control: a real giraffe must stay a giraffe"),
 ("ctl-knife", "pool/control/068.jpg", "knife", "control: a real knife must stay a knife"),
]
EMO = {"angry": ["011", "024"], "frustrated": ["012", "016", "020"], "sad": ["017", "019", "029", "033"],
       "surprised": ["008", "036", "038"], "disgusted": ["003", "020"], "afraid": ["011", "012", "017"],
       "happy": ["003", "006", "011"], "neutral": ["013", "017", "032"]}
out = {"objects": {}, "emotions": {}}
os.makedirs("eval/fixtures/objects", exist_ok=True)
for name, src, exp, note in OBJ:
    base = src.split("/", 1)[1]; cat, fn = base.split("/")[-2:]
    pool_key = f"{cat if cat != 'scarf3' else 'scarf'}/{fn.split('_')[0].replace('.jpg','')}.jpg"
    suffix = "_" + fn.split("_", 1)[1].replace(".jpg", "") if "_" in fn else ""
    shutil.copy(f"eval/{src}", f"eval/fixtures/objects/{name}.jpg")
    out["objects"][f"objects/{name}.jpg"] = {"expected": exp, "note": note, "transform": V.get(suffix, "none"), **m[pool_key]}
for cls, ids in EMO.items():
    os.makedirs(f"eval/fixtures/emotions/{cls}", exist_ok=True)
    for i in ids:
        shutil.copy(f"eval/pool/{cls}/{i}.jpg", f"eval/fixtures/emotions/{cls}/{cls}-{i}.jpg")
        out["emotions"][f"emotions/{cls}/{cls}-{i}.jpg"] = {"expected": cls, "label_by": "visual judgement (assumption)", **m[f"{cls}/{i}.jpg"]}
json.dump(out, open("eval/fixtures/manifest.json", "w"), indent=1, ensure_ascii=False)
print(len(out["objects"]), len(out["emotions"]))
