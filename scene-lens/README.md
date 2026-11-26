# Scene Lens

Browser-App (Chrome): Foto, Video oder Kamera → Objekterkennung mit Boxen, Zählung, Treemap-Popup, Szenen-Vorschlag mit Vergleich zu typischen Werten.

- Erkennung: Google MediaPipe Object Detector (`@mediapipe/tasks-vision`) mit EfficientDet-Lite2 (80 COCO-Klassen, Apache-2.0), GPU mit CPU-Fallback.
- Start: `npm install && npm run dev` · Build: `npm run build`
- Szenen-Richtwerte: `src/scenes.ts` (handgeschätzt, nicht gemessen).
