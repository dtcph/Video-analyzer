# Object Counter

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

The model runs on your own device, on the graphics card when the browser supports WebGPU and otherwise on the processor (WebAssembly). On a GPU the more accurate YOLOv8s model is used by default, on the processor the faster YOLOv8n. A tracker links the detections of consecutive frames into objects, so that a car crossing the screen is counted as one car, not once per frame.

Supported browsers: Chrome or another Chromium-based browser on a desktop computer.

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

The site needs two HTTP headers for multi-threaded WebAssembly (`Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`); the development and preview servers send them, and a static host must send them too.

## License and model credit

Copyright (C) 2026 Paul

This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, version 3. It is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See [LICENSE](LICENSE) for the full text.

Source code: https://github.com/dtcph/Video-analyzer

Object detection uses **[Ultralytics YOLOv8](https://github.com/ultralytics/ultralytics)**, whose code and pretrained weights are licensed under AGPL-3.0. The model is pretrained on the [COCO dataset](https://cocodataset.org/) (annotations CC BY 4.0). The source of this website, including how the model files are produced ([scripts/export-model.md](scripts/export-model.md)), is published in this repository.
