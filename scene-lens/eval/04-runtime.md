# Phase 4: Runtime-Optimierung

Messmethoden wie in `00-baseline.md`: `eval/scripts/perf.ts` (Production-Build über `vite preview`, frisches Chrome-Profil, Median aus 5 Läufen, Wiedergabe 8 s), `eval/scripts/run.ts fps` (Inferenz auf 120 Frames von `moving_car.mp4`, 1080p) und die Init-Zeiten aus dem Harness. Gleiches Gerät (M4 Max, Chrome 158 headless, GPU).

Zwei Kennzahlen sind neu, weil sich die Architektur geändert hat:

- **Analysen/s:** Seit Phase 2 laufen Anzeige-Schleife (60 Hz) und Analyse getrennt. Die alte Kennzahl „App-Schleife“ zählt deshalb keine Analysen mehr. Gezählt wird jetzt jedes Neuzeichnen des Overlays (über `clearRect` am Overlay-Canvas). In Phase 0 lief eine Analyse pro Anzeige-Frame, also bis zu 46/s, auch doppelt auf demselben Videoframe (Video: 30 FPS).
- **Erstes Ergebnis:** Zeit vom Foto-Upload (1 s nach DOMContentLoaded) bis zur Zähltabelle (`eval/scripts/ttfr.ts`, Median aus 5 kalten Läufen), auf dem Ausgangsstand und auf allen Varianten gemessen.

Beim Messen fiel ein Fehler aus Phase 3 auf und wurde behoben (Commit `64c8981`, kein Optimierungsschritt). Mit eingeschalteten Gesichtern blockierte die Seite während der Videowiedergabe. Ursache: Die Analyse-Sperre wurde schon nach der Objekterkennung freigegeben, und überlappende ONNX-Läufe blockierten die Laufzeit. Der Funktionstest prüft diesen Fall jetzt.

## Maßnahmen (je einzeln gemessen)

Stand vor Phase 4 (`perf-p4-start`): Bundle 106 112 618 B, TTI kalt 1 448 ms, Modell bereit kalt 1 461 ms / warm 553 ms, Inferenz 34,0 ms (1080p), Detektor-Init 767 ms. Wiedergabe ohne Gesichter: Renderer-CPU 56 %, GPU-Prozess 56 %, Renderer-RSS 1 126 MB.

| Maßnahme | Metrik vorher | nachher | Genauigkeitseffekt | übernommen |
|---|---|---|---|---|
| A. Nur die SIMD-Variante der MediaPipe-WASM ausliefern (`scripts/copy-wasm.mjs`). Chrome lädt ohnehin nur sie | Bundle 106 112 618 B | 96 459 843 B (−9 652 775 B) | keiner (gleicher Code wird geladen). Funktionstest bestanden | **ja** |
| B. Quantisierung Emotionsmodell: Weight-only fp16 (`eval/scripts/wf16.py`) | Modell 16 049 834 B | 8 104 452 B | FER+ 266/420 → 266/420, Fixtures 17/23 → 17/23 | **ja** |
| B2. Quantisierung Objektmodell: echtes fp16 (Konverter von onnxconverter / ORT) | 39,8 MB Weight-fp16 | – | rechnet falsch (Messer 0,012 statt 0,753, siehe 02-objektmodell.md) | nein |
| C. ONNX-Runtime-Build: JSPI statt asyncify (`onnxruntime-web/jspi`) | WASM 26 781 914 B, Inferenz 34,0 ms, Init 767 ms | WASM 16 758 545 B, Inferenz 35,5 ms (innerhalb ±15 % Laufschwankung), Init 623 ms | Fixtures 19/20 → 19/20. Bedingung: JSPI, also Chrome ≥ 137. Andere Browser starten die Erkennung nicht mehr (vorher langsamer WASM-Rückfall). App ist ausdrücklich für Desktop-Chrome | **ja** |
| D. Lazy Loading Objektdetektor (lädt beim Wählen einer Quelle bzw. sobald Zeiger/Fokus die Auswahlknöpfe erreicht). Das Gesichts-/Emotionsmodell lädt schon seit jeher erst beim Einschalten | TTI kalt 1 249 ms, Übertragung beim Start 51 981 KB, Long Tasks 2 (465 ms). Erstes Ergebnis 353 ms | TTI kalt 36 ms, Übertragung 58 KB, Long Tasks 0. Erstes Ergebnis 1 411 ms (schlechtester Fall ohne Zeigerbewegung, wie gemessen) | keiner (Modell und Pipeline gleich) | **ja** |
| E. Web Worker für die Inferenz | Hauptthread bei Wiedergabe 33 % belegt (davon Script 9 %), 0 Long Tasks. Pro Frame: Vorverarbeitung 4,1 ms (Hauptthread), Inferenz 29,1 ms (GPU, asynchron), Nachverarbeitung 0,04 ms | nicht umgesetzt | – | **nein**: höchstens 4 ms/Frame wären verschiebbar, es gibt keine blockierenden Long Tasks. Der Aufwand (OffscreenCanvas, MediaPipe im Worker, Bildtransfer) steht in keinem Verhältnis |
| F. Backend: WebGPU vs. WASM (Detektor, 1080p-Standbild) | WebGPU 31,3 ms | WASM 1 264,8 ms (1 Thread, keine Cross-Origin-Isolation) | gleich | WebGPU bleibt, WASM nur als Rückfall |
| F2. Feste Eingabedimensionen (`freeDimensionOverrides`), A/B je 3 Läufe abwechselnd | Inferenz 35,1 / 35,4 / 35,2 ms, Init 636 / 637 / 682 ms | 33,3 / 33,4 / 33,5 ms, Init 594 / 599 / 633 ms | Fixtures 19/20 → 19/20, Emotionen 17/23 → 17/23 | **ja** |
| F3. WebGPU Graph Capture (`enableGraphCapture`) | – | Session-Fehler: „External buffer must be provided for input/output“ (verlangt GPU-Puffer als Ein- und Ausgabe) | – | nein (würde eigenen GPU-Puffer-Umbau erfordern, nicht gemessen) |
| G. Caching der Modell-Dateien | kalt: 51 981 KB übertragen, Modell bereit 1 258 ms | warm (HTTP-Cache): 2 KB, Modell bereit 489 ms (Variante A–C, eager) | keiner | **ja**, über `Cache-Control`-Header für `/models/*` und `/wasm/*` in `vercel.json` (Phase 5). Lokal mit `vite preview` gemessen (Revalidierung per ETag) |
| H. Drosselung der Inferenzrate auf 10 Analysen/s (A/B je 1 Lauf) | 26,4 Analysen/s, Hauptthread 36 %, Renderer-CPU 44 %, GPU-Prozess 45 % | 9,4 Analysen/s, Hauptthread 18 %, CPU 23 %, GPU-Prozess 21 % | **Zählungen ändern sich spürbar** (aufgezeichnete Detektionen, Tracker offline): `moving_car` 66 → 54 Autos, 12 → 2 Personen, `steady` 4 → 3 Personen, `moving_handheld` 10 → 3 „Frisbees“. Bei 15/s: 66 → 65 Autos, 12 → 8 Personen. Ob das besser oder schlechter ist, lässt sich ohne Wahrheit je Objekt nicht belegen | **nein** (Regel: verwerfen bei spürbarem Genauigkeitseffekt) |
| (Alternative) D-FINE-S statt D-FINE-M | Inferenz 31,3 ms, 55,9 mAP | 21,7 ms, 50,9 mAP (Messung Phase 2) | −5,0 mAP, Fixtures 19 → 16/20 (ohne adaptiven Pass) | **nein** (verschlechtert die Genauigkeit) |

## Alle Metriken aus Phase 0, erneut gemessen

Endstand `perf-p4-final`, `fps-p4-final`, `ttfr-p4-final`, Harness-Init aus `emotions-p4-final`.

| Metrik | Phase 0 | Phase 4 | Bewertung |
|---|---|---|---|
| Deploy-Bundle gesamt | 46 455 656 B | 78 489 787 B | **schlechter** (+32,0 MB, liegt im Budget < 100 MB) |
| davon Modelle | 26 855 487 B | 51 655 199 B | **schlechter** (D-FINE-M 39,8 MB + HSEmotion 8,1 MB + Face 3,8 MB) |
| davon WASM-Laufzeiten | 19 431 091 B | 26 538 099 B (MediaPipe 9 778 316 + ORT 16 759 783) | **schlechter** |
| JS / CSS / HTML | 156 880 / 7 208 / 4 990 B | 279 445 / 11 907 / 5 137 B | schlechter (+128 KB, ORT-Bundle) |
| Übertragung beim Start (kalt) | 29 877 KB | 58 KB | **besser** |
| First Contentful Paint | 32 ms | 32 ms | gleich |
| Time-to-interactive kalt / warm | 671 / 255 ms | 32 / 32 ms | **besser** |
| Modell bereit kalt | 671 ms (beim Start) | lädt erst bei Bedarf. Erstes Ergebnis nach Foto-Upload 1 375 ms (Phase 0: 195 ms) | **schlechter** beim ersten Ergebnis (+1,18 s) |
| Modell-Init Objektdetektor | 292 ms | 599 ms | **schlechter** (größeres Modell, WebGPU-Shader) |
| Modell-Init Gesicht (+ Emotion) | 55 ms | 152 ms | **schlechter** (zusätzliches Emotionsmodell) |
| Inferenzzeit pro Frame (1080p) | 25,3 ms (39,6 FPS) | 33,6 ms (29,8 FPS) | **schlechter** (+33 %) |
| Analysen/s ohne / mit Gesichtern | 46,1 / 43,9 (inkl. Doppelanalysen desselben Videoframes, Video 30 FPS) | 26,0 / 20,7 | **schlechter** |
| CPU Renderer / GPU-Prozess ohne Gesichter | 52 / 51 % | 43 / 44 % | **besser** |
| CPU Renderer / GPU-Prozess mit Gesichtern | 53 / 52 % | 41 / 42 % | **besser** |
| JS-Heap ohne / mit Gesichtern | 4 / 5 MB | 4 / 6 MB | gleich / schlechter (+1 MB) |
| Renderer-RSS ohne / mit Gesichtern | 652 / 733 MB | 857 / 978 MB | **schlechter** |
| GPU-Prozess-RSS ohne / mit Gesichtern | 187 / 222 MB | 235 / 286 MB | **schlechter** |

Genauigkeit nach Phase 4, gleiche Tests: Objekte 19/20 (Phase 2: 19/20), Emotionen 17/23 (Phase 3: 17/23), FER+ 266/420 (Phase 3: 266/420). Die Ergebnisse aus Phase 2 und 3 gelten also unverändert.

## Done-Kriterium: teilweise nicht erfüllt

„Alle Metriken gleich gut oder besser als Phase 0“ ist **nicht erfüllt** für Bundle-Größe, Modell-Init, Inferenzzeit, Analysen/s, Zeit bis zum ersten Ergebnis und Speicher.

Der Grund ist ein Zielkonflikt in den Vorgaben. Phase 2 verlangt das genaueste Modell, das ins Budget passt (+22,8 mAP gegenüber Phase 0), und Phase 3 ein stärkeres Emotionsmodell. Phase 4 verbietet ausdrücklich jede Optimierung, die diese Genauigkeit spürbar verschlechtert. Die einzigen gemessenen Wege zurück auf die Phase-0-Geschwindigkeit verschlechtern die Genauigkeit und sind deshalb verworfen: D-FINE-S (−5 mAP) und die Drosselung (veränderte Zählungen).

Besser als Phase 0 sind Startzeit (TTI 671 → 32 ms), Startübertragung (29,9 MB → 58 KB) und CPU-Last (−9 bis −12 Prozentpunkte). Diese Entscheidung muss der Auftraggeber treffen: Genauigkeit (jetziger Stand) oder Phase-0-Geschwindigkeit (z. B. D-FINE-S).
