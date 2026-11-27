# Scene Lens

Browser-App (Chrome): Foto, Video oder Kamera → Objekterkennung mit Boxen, Zählung, Treemap-Popup, Szenen-Vorschlag mit Vergleich zu typischen Werten.

- Erkennung: D-FINE-M (Objects365 → COCO, 80 Klassen, Apache-2.0) in ONNX Runtime Web 1.30 (WebGPU, WASM-Fallback). Auswahl und Messungen: `eval/02-objektmodell.md`.
- Start: `npm install && npm run dev` · Build: `npm run build`
- Szenen-Richtwerte: `src/scenes.ts` (handgeschätzt, nicht gemessen).

## Gesichter & Gesichtsausdruck (optional, Schalter unter dem Bild, standardmäßig aus)

Läuft nur, wenn Personen im Bild sind. Pro Person sucht der MediaPipe Face Landmarker das Gesicht (erst im Kopfbereich, sonst in der ganzen Box), richtet es an der Augenlinie aus und gibt einen engen Ausschnitt an HSEmotion EfficientNet-B0 (AffectNet, Apache-2.0). Ausgegeben werden 8 Klassen: wütend, Verachtung, angewidert, ängstlich, froh, neutral, traurig, überrascht. Unter 40 % Wahrscheinlichkeit lautet das Ergebnis „Unklar“. „Frustriert“ gibt das Modell nicht aus. Ein Gesichtsausdruck ist kein Gefühl, und die Trefferquote liegt auf Testdaten bei etwa zwei Dritteln. Grenzen und Messungen stehen in `eval/03-emotionen.md`. Es findet keine Identifikation statt, und nichts wird gespeichert.

## Auswertung

`eval/` enthält Referenzbilder, Messskripte und die Phasenberichte (`00-baseline.md`, `02-objektmodell.md`, `03-emotionen.md`, `04-runtime.md`, `REPORT.md`). Layout-Vertrag: `docs/grid.md`.
