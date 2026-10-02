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

Copyright (C) 2026 Paul

This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, version 3. It is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See [LICENSE](LICENSE) for the full text.

Source code: https://github.com/dtcph/Video-analyzer

Object detection uses **[Ultralytics YOLOv8](https://github.com/ultralytics/ultralytics)**, whose code and pretrained weights are licensed under AGPL-3.0. The model is pretrained on the [COCO dataset](https://cocodataset.org/) (annotations CC BY 4.0). The source of this website, including how the model files are produced ([scripts/export-model.md](scripts/export-model.md)), is published in this repository.
