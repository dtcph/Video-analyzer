# Object Counter

Count objects in images, videos and a live webcam feed, entirely in your browser. Object Counter runs YOLOv8 on your device, draws boxes and labels over the media, and shows per-class counts. Nothing is uploaded: there is no backend.

> **Status: early development.** The project is being rebuilt in phases. Detection is not wired up yet.

## Run locally

Requires Node.js ≥ 22.12 and Chrome or Chromium.

```bash
npm install
npm run dev       # development server (sends COOP/COEP headers)
npm run build     # static site in dist/
npm run preview   # serve the build locally
npm run test      # unit tests
npm run lint
```

## License and model credit

This project is free software under the **GNU Affero General Public License v3.0**; see [LICENSE](LICENSE).

Object detection uses **[Ultralytics YOLOv8](https://github.com/ultralytics/ultralytics)**, whose code and pretrained weights are licensed under AGPL-3.0. The model is COCO-pretrained. The source of this website, including how the model files are produced, is published in this repository.
