"""Downloads a candidate image pool from Wikimedia Commons (free licenses only) with source + license.

Usage: python3 -I eval/scripts/fetch_pool.py <out_dir> <queries.json>
queries.json: {"<category>": ["search query", ...], ...}
Writes <out_dir>/<category>/<n>.jpg and <out_dir>/manifest.json. Images are scaled to 1024 px width by Commons.
"""
import json, os, re, sys, time, urllib.parse, urllib.request

UA = "scene-lens-eval/0.1 (image test set script)"
API = "https://commons.wikimedia.org/w/api.php"
FREE = re.compile(r"^(CC0|CC BY(-SA)? [0-9.]+|Public domain|No restrictions|PDM)", re.I)


def get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def search(q: str, limit: int) -> list[dict]:
    params = {
        "action": "query", "format": "json", "generator": "search", "gsrnamespace": "6", "gsrlimit": str(limit),
        "gsrsearch": f"{q} filetype:bitmap", "prop": "imageinfo", "iiprop": "url|size|mime|extmetadata",
        "iiurlwidth": "960", "iiextmetadatafilter": "LicenseShortName|Artist",
    }
    d = json.loads(get(f"{API}?{urllib.parse.urlencode(params)}"))
    pages = sorted(d.get("query", {}).get("pages", {}).values(), key=lambda p: p.get("index", 0))
    return pages


def main() -> None:
    out, qfile = sys.argv[1], sys.argv[2]
    per = int(sys.argv[3]) if len(sys.argv) > 3 else 8
    queries = json.load(open(qfile))
    manifest_path = os.path.join(out, "manifest.json")
    manifest = json.load(open(manifest_path)) if os.path.exists(manifest_path) else {}
    seen = {m["title"] for m in manifest.values()}
    for cat, qs in queries.items():
        os.makedirs(os.path.join(out, cat), exist_ok=True)
        n = sum(1 for k in manifest if k.startswith(cat + "/"))
        for q in qs:
            for p in search(q, per):
                ii = p["imageinfo"][0]
                lic = re.sub("<[^>]+>", "", ii["extmetadata"].get("LicenseShortName", {}).get("value", ""))
                if p["title"] in seen or not FREE.match(lic) or ii.get("mime") not in ("image/jpeg", "image/png"):
                    continue
                artist = re.sub("<[^>]+>", "", ii["extmetadata"].get("Artist", {}).get("value", "")).strip()
                n += 1
                name = f"{cat}/{n:03d}.jpg"
                try:
                    data = get(ii.get("thumburl") or ii["url"])
                except Exception as e:  # noqa: BLE001
                    print("skip", p["title"], e)
                    continue
                with open(os.path.join(out, name), "wb") as f:
                    f.write(data)
                seen.add(p["title"])
                manifest[name] = {"title": p["title"], "query": q, "license": lic, "artist": artist[:200],
                                  "page": ii.get("descriptionurl"), "width": ii.get("width"), "height": ii.get("height")}
                time.sleep(1.0)
            print(cat, q, "->", n)
            json.dump(manifest, open(manifest_path, "w"), indent=1, ensure_ascii=False)


main()
