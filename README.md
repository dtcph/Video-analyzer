# Object Counter

**Try it: https://video-analyzer-sable.vercel.app/** (Chrome or another Chromium-based browser, on a desktop computer).

Every second, our eyes take in far more than we notice. Cars pass, people cross the street, a dog walks by, and almost none of it reaches conscious thought. The information keeps streaming in, nonstop, and we filter it without thinking about it.

**Object Counter makes that stream visible.** It watches a video, an image or your webcam the way a machine does: it marks every person, vehicle and animal it recognizes, follows them from frame to frame, and keeps count. What we perceive in passing becomes data you can see: boxes, labels and a running tally of everything that went by.

It is a study project in data visualization, and it runs entirely in your browser. Nothing is uploaded; there is no server.

## What it does

- **Input:** upload an image or a video (MP4, WebM), or start your webcam.
- **Detection:** a YOLOv8 model recognizes 80 kinds of everyday objects (people, cars, buses, bicycles, dogs, cups, phones, ...) and draws a labeled box around each one.
- **Counting:**
  - **Total:** how many different objects appeared over the whole video or webcam session, per kind. Each object is followed across frames and counted once.
  - **Current frame:** pause to see what is visible in that single moment.
- **Choose what to count:** class groups (People, Animals, Transportation, Kitchen & food, ...), a confidence threshold, and Reset counts.
- **Two video modes:**
  - **Realtime** analyzes while the video plays.
  - **Pre-analysis** first goes through every frame, faster than realtime, then plays back with the complete totals shown from the start.

## How it works

The model runs on your own device, on the graphics card when the browser supports WebGPU and otherwise on the processor (WebAssembly). On a GPU the more accurate YOLOv8s model is used by default, on the processor the faster YOLOv8n; the Model setting can choose either. A tracker links the detections of consecutive frames into objects, so that a car crossing the screen is counted as one car, not once per frame.

The first visit downloads up to about 50 MB (model and runtime); after that the model loads from the browser's cache in well under a second.

Supported browsers: Chrome or another Chromium-based browser on a desktop computer. Tested on a fast Mac only; slower computers analyze fewer frames per second (the app adapts and never lags behind the video).

## Limitations

The counts are a machine's perception, with a machine's blind spots:

- Very small or distant objects (pedestrians far away, cars seen from a drone) are often missed.
- Busy scenes with a moving camera are over-counted: an object hidden behind another one and seen again, or shown with two boxes, can be counted twice.
- Something that leaves the picture and comes back, or a cut to a new shot, is counted again.
- The model sometimes confuses similar things (a dog as a horse, a book as a phone), especially the faster model.

## Run locally

Requires Node.js ≥ 22.12 and Chrome or Chromium.

```bash
npm install
npm run dev       # development server
npm run build     # static site in dist/
npm run preview   # serve the build locally
npm run test      # unit tests
```

The site needs two HTTP headers for multi-threaded WebAssembly (`Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`); the development and preview servers send them, and a static host must send them too. Without them the processor path runs single-threaded, about 6× slower.

## Deploy

`npm run build` produces a static site in `dist/` (about 82 MB, mostly the models and the runtime). On **Vercel**: import the repository, keep the "Vite" preset (build `npm run build`, output `dist`), and deploy; [`vercel.json`](vercel.json) sets the two headers above and long-term caching for the hashed assets. Other static hosts work if they can send the headers (Netlify and Cloudflare Pages use a `_headers` file). Checks after deploying: [docs/release-checklist.md](docs/release-checklist.md).

## License and model credit

Copyright (C) 2026 Paul

This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, version 3. It is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See [LICENSE](LICENSE) for the full text.

Live site: https://video-analyzer-sable.vercel.app/

Source code: https://github.com/dtcph/Video-analyzer

Object detection uses **[Ultralytics YOLOv8](https://github.com/ultralytics/ultralytics)**, whose code and pretrained weights are licensed under AGPL-3.0. The model is pretrained on the [COCO dataset](https://cocodataset.org/) (annotations CC BY 4.0). The source of this website, including how the model files are produced ([scripts/export-model.md](scripts/export-model.md)), is published in this repository; the site's footer links to the exact commit it was built from.

Bundled third-party software: ONNX Runtime Web (MIT) and Mediabunny (MPL-2.0). Their license texts are in [public/THIRD_PARTY_NOTICES.txt](public/THIRD_PARTY_NOTICES.txt), served with the site.
