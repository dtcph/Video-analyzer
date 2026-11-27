# Scene Lens

Browser-App (Chrome): Foto, Video oder Kamera → Objekterkennung mit Boxen, Zählung, Treemap-Popup, Szenen-Vorschlag mit Vergleich zu typischen Werten.

- Erkennung: Google MediaPipe Object Detector (`@mediapipe/tasks-vision`) mit EfficientDet-Lite2 (80 COCO-Klassen, Apache-2.0), GPU mit CPU-Fallback.
- Start: `npm install && npm run dev` · Build: `npm run build`
- Szenen-Richtwerte: `src/scenes.ts` (handgeschätzt, nicht gemessen).

## Gesichter & Stimmung (optional, Schalter unter dem Bild, standardmäßig aus)

Läuft nur, wenn Personen im Bild sind. Pro Person wird der Kopfbereich mit dem MediaPipe Face Landmarker (Blendshapes) analysiert; daraus schätzt eine Regelsammlung (`src/faces.ts`) Lachend / Neutral / Nachdenklich / Überrascht / Traurig / Verärgert. Ohne lesbares Gesicht bleibt die Person "Gesicht nicht erkennbar". Keine Identifikation, nichts wird gespeichert. Die Schwellen sind handgeschätzt, "Nachdenklich" ist besonders unsicher.
