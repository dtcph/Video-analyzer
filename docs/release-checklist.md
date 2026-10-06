# Release checklist

## 1. Before committing

Run the gate and the browser flows on the production build:

```bash
npx tsc --noEmit && npm run lint && npm run test && npx prettier --check .
npm run build                      # must end with "built in …", dist/ ≈ 82 MB (Vercel Hobby limit: 100 MB)
npm run e2e -- --build && npm run e2e:video -- --build && npm run e2e:counts -- --build
npm run e2e:webcam -- --build && npm run e2e:pre -- --build
```

**Must be in the commit:**

| path                                           | why                                                                  |
| ---------------------------------------------- | -------------------------------------------------------------------- |
| `LICENSE`                                      | AGPL-3.0 text (the models and this code)                             |
| `README.md`                                    | AGPL notice, Ultralytics and COCO credit, deployment notes           |
| `public/models/*.onnx`, `manifest.json`        | the three models and their SHA-256 (decisions.md §9), 41.4 MB        |
| `public/THIRD_PARTY_NOTICES.txt`               | onnxruntime-web (MIT), mediabunny (MPL-2.0); served next to the site |
| `public/ONNXRUNTIME_THIRD_PARTY_NOTICES.txt`   | ONNX Runtime's own notices for its WebAssembly runtime               |
| `vercel.json`                                  | COOP/COEP headers (multi-threaded WASM) and caching of hashed assets |
| `src/`, `tests/`, `scripts/`, `docs/`, configs | source; `scripts/export-model.md` documents how the models were made |

**Must not be in the commit** (all gitignored; check with `git status --ignored --short`):

- `old/`: the archived project; never commit or delete it (the user deletes it).
- `test-vid/`, `test-img/`: local media, redistribution rights unknown.
- `dist/`, `node_modules/`, `.cache/` (e2e reports, recordings), `.venv-export/`.

Quick check: `git status --short` lists only intended files; `git ls-files | grep -E '^(old|test-vid|test-img|dist|\.cache)/'` prints nothing.

## 2. Deploy on Vercel (user)

1. Vercel → Add New → Project → import `github.com/dtcph/Video-analyzer`.
2. Framework preset **Vite** (build `npm run build`, output `dist`), Node 22 or newer.
3. Production branch: the branch to publish (currently `V3`; or merge into `main` first).
4. Deploy. `vercel.json` adds the headers; nothing else to configure. The footer's source link uses `VERCEL_GIT_COMMIT_SHA`, which Vercel provides by default.

## 3. Check the deployment

Replace `URL` with the deployment's address (`https://….vercel.app`).

```bash
curl -sI URL/ | grep -iE 'cross-origin-(opener|embedder)-policy'
# expect: same-origin and require-corp

curl -s URL/ | grep -o 'assets/[^"]*\.js' | head -1          # a hashed asset path, then:
curl -sI URL/assets/<that file> | grep -i cache-control
# expect: public, max-age=31536000, immutable

curl -sI -H 'Accept-Encoding: br, gzip' URL/models/yolov8s-640-dyn-fp16.onnx | grep -iE 'content-(length|encoding)'
curl -sI URL/THIRD_PARTY_NOTICES.txt | head -1             # expect 200
```

To check whether the WebGPU runtime (26.8 MB uncompressed) is served compressed, find its name in `dist/assets/` (`ort-wasm-simd-threaded.asyncify-*.wasm`), then:

```bash
curl -sI -H 'Accept-Encoding: br, gzip' URL/assets/<that file> | grep -iE 'content-(length|encoding)'
```

In Chrome:

- **Settings → Debug:** "Cross-origin isolated: true"; Backend WebGPU, model YOLOv8s.
- **Footer:** "source code (abc1234)" opens the deployed commit on GitHub; "Third-party notices" opens the notices file.
- **End to end:** an image, a video in Realtime and in Pre-analysis, and the webcam all show boxes and counts.

Send the URL back to have the headers and flows verified (docs/HANDOFF.md).
