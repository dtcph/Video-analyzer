# Abschlussbericht: Überarbeitung Scene Lens

Branch `feature/scene-lens-revision` (lokal, nicht gepusht), 9 Commits ab `feature/scene-lens` @ `5aff8fa`. Jede Phase ist ein eigener Commit und lässt sich einzeln mit `git revert` zurücknehmen. Messumgebung für alle Zahlen: MacBook mit Apple M4 Max, Chrome 158 headless mit GPU, localhost. Einzelheiten und Rohdaten-Pfade stehen in `00-baseline.md`, `02-objektmodell.md`, `03-emotionen.md` und `04-runtime.md`. Grid-Vertrag: `../docs/grid.md`.

## 1. Vorgefundener Stack und Ist-Zustand

- **App:** Scene Lens (`scene-lens/`), Vanilla-TypeScript 5.6 ohne Framework, Vite 6.4, eine HTML-Seite mit zwei Bildschirmen (Start, Analyse) und einem Treemap-Modal, Sprachumschalter ko/en. Eine einzige CSS-Datei ohne Grid-System: 15 Schriftgrößen, 29 Abstandswerte, unterschiedliche Ränder je Bildschirm (8vw bzw. 48 px), keine Kopfzeile auf der Startseite, horizontales Scrollen bei 375 px.
- **Objekterkennung:** MediaPipe Tasks Vision 0.10.21, EfficientDet-Lite2 (fp32 TFLite, 23,1 MB, Eingabe 448×448, 80 COCO-Klassen), GPU-Delegate, Schwelle 0,40, NMS klassenübergreifend bei IoU ≈ 0,3 (MediaPipe-Standard, gemessen).
- **Gesicht/Emotion:** MediaPipe Face Landmarker (3,8 MB). „Emotion“ war eine handgeschriebene Regel über 52 Blendshapes, die 6 Klassen ausgab (froh, neutral, überrascht, traurig, wütend, nachdenklich). Kein Emotionsmodell.
- **Deployment:** Die Live-URL `video-analyzer-sable.vercel.app` liefert den Object Counter aus dem Repo-Root aus, nicht Scene Lens. Scene Lens hatte keine Vercel-Konfiguration.
- **Reproduzierte Fehler:** Hund → Giraffe (0,884 / 0,675 / 0,612) und Schal → Messer (0,224, also nur unterhalb der Standardschwelle sichtbar). Dazu Schal → Giraffe (0,73) und Hund → Teddybär (0,75).

## 2. Änderungen pro Phase

**Phase 0 (Bestandsaufnahme):**

- Mess-Harness (`eval.html`, `eval/harness.ts`), das die echten App-Module im Browser ausführt.
- Referenz-Set von Wikimedia Commons (20 Objekt- und 23 Emotionsbilder, freie Lizenzen, `eval/fixtures/manifest.json`), gefunden über 316 Pool-Bilder und 2 181 Video-/Webcam-ähnliche Varianten.
- Laufzeitmessung (`perf.ts`).

**Phase 1 (Layout):**

- Ein Token-Block in `src/style.css` als einzige Quelle: 12/8/4 Spalten, Gutter 24/24/16, Ränder 48/32/16, 8-px-Abstandsskala, 8 feste Schriftstufen auf 8-px-Grundlinie. Verschachtelte Bereiche nutzen `subgrid`.
- Eine gemeinsame, sticky Kopfzeile für alle Bildschirme (64 px, Telefon 96 px), Sprachumschalter integriert.
- Kein horizontales Scrollen mehr. Funktion und Inhalte sind unverändert (Funktionstest).

**Phase 2 (Objekterkennung):**

- 12 Kandidaten verglichen (EfficientDet-Lite2/4, YOLOv8n/s/m, YOLO11s/m, D-FINE-S/M, RF-DETR-S u. a.), mit veröffentlichten Werten und eigener COCO-mAP auf 500 val2017-Bildern.
- Gewählt: **D-FINE-M (Objects365 → COCO, Apache-2.0)** als Weight-only-fp16 (39,8 MB) in ONNX Runtime Web 1.30 über WebGPU.
- Gemessene Maßnahmen: Standardschwelle 0,65, „teddy bear“ ≥ 0,8, adaptiver zweiter Durchlauf mit 25 % Rand bei bildfüllenden Objekten, Klassen-Abstimmung im Tracker. Verworfen (gemessen): Duplikat-NMS, Letterbox, Schwellen für tie/giraffe/frisbee.

**Phase 3 (Emotion):**

- Kettenanalyse pro Stufe, Ursachenbefund und neue Kette: Gesichtssuche mit Rückfall, Ausrichtung an der Augenlinie, enger Ausschnitt, **HSEmotion EfficientNet-B0 `va_mtl`** (AffectNet, 8 Klassen, Apache-2.0), gemittelte Wahrscheinlichkeiten, „Unklar“ unter 0,4.
- UI: angewidert, ängstlich und Verachtung neu, „nachdenklich“ entfällt, ehrliche Hinweistexte.

**Phase 4 (Laufzeit):**

- Übernommen: nur SIMD-WASM von MediaPipe, Weight-fp16 des Emotionsmodells, ORT-JSPI-Build, feste Eingabedimensionen, Lazy Loading mit Vorladen bei Nutzerabsicht, Cache-Header.
- Verworfen (gemessen): Web Worker, Drosselung der Analyserate, Graph Capture, D-FINE-S.
- Dabei gefunden und behoben: eine Blockade der Seite bei Gesichtern + Video (überlappende ONNX-Läufe, Commit `64c8981`).

**Phase 5 (Vercel):**

- `scene-lens/vercel.json`: `npm ci` (kopiert die MediaPipe-WASM per Postinstall), `npm run build`, Ausgabe `dist`, Content-Type für `.onnx`, `.task`, `.wasm`, Cache-Header (gehashte `assets` 1 Jahr immutable, `models` und `wasm` 1 Tag + `stale-while-revalidate` 7 Tage).
- Lizenzhinweise in `public/THIRD_PARTY_NOTICES.txt`.

Größenaufstellung des Production-Builds (`dist/`, `npm run build` nach `rm -rf dist`, Exit-Code 0, 19 Module, 570 ms):

| Datei | Bytes |
|---|---|
| models/dfine_m_obj2coco.wf16.onnx | 39 792 151 |
| assets/ort-wasm-simd-threaded.jspi-*.wasm | 16 758 545 |
| wasm/vision_wasm_internal.wasm | 9 574 032 |
| models/enet_b0_8_va_mtl.wf16.onnx | 8 104 452 |
| models/face_landmarker.task | 3 758 596 |
| wasm/vision_wasm_internal.js | 204 284 |
| assets/index-*.js | 163 008 |
| assets/ort.jspi.bundle.min-*.js | 116 437 |
| assets/index-*.css | 11 907 |
| index.html | 5 137 |
| THIRD_PARTY_NOTICES.txt | 1 238 |
| **Gesamt (Modelle + Assets, alles Ausgelieferte)** | **78 489 787 B = 78,49 MB (74,85 MiB)** |

Auslieferung im Build geprüft (`vite preview`): alle 7 Modell- und Laufzeit-Dateien mit HTTP 200 und exakt der Dateigröße, `.wasm` als `application/wasm`. Im Production-Build analysiert die App Video ohne und mit Gesichtern (20,6 bzw. 18,7 Analysen/s, Einzellauf). **Das echte Deployment wurde nicht ausgeführt.** Was dafür fehlt, steht in Abschnitt 5.

## 3. Messwerttabelle vorher/nachher

| Metrik | Vorher (Phase 0) | Nachher | Messmethode |
|---|---|---|---|
| Objekte: Referenz-Set korrekt (bei App-Standardschwelle) | 13/20 (Schwelle 0,40) | **19/20** (Schwelle 0,65) | `run.ts objects` + `score.py` |
| Objekte: Hund als Hund | 3/7 | **7/7** | dito |
| Objekte: Schal als Messer (bei 0,20) | ja (0,224) | **nein** | dito |
| Objekte: COCO mAP@[.5:.95] / AP50 (500 val2017-Bilder) | 33,1 / 50,4 | **55,9 / 73,2** (Modell ohne App-Nachverarbeitung; mit adaptivem Pass 55,5) | `models.ts` + `coco_eval.py` (pycocotools) |
| Objekte: Präzision / Recall am App-Arbeitspunkt (COCO, IoU 0,5) | 84 / 38 % | **87 / 59 %** | dito |
| Emotionen: Referenz-Set | 6/23 | **17/23** | `run.ts emotions` + `score.py` |
| Emotionen: FER+ (420 Gesichter, 7 Klassen) | 20,0 % | **63,3 %** | `run.ts ferplus` + `fer_eval.py` |
| Emotionen: wütend (Fixtures \| FER+) | 0/2 \| 0/60 | **2/2 \| 40/60** | dito |
| Ladezeit: Time-to-interactive kalt / warm | 671 / 255 ms | **32 / 32 ms** | `perf.ts` (Long-Task-Methode, Median 5) |
| Ladezeit: Übertragung beim Start | 29 877 KB | **58 KB** | `perf.ts` (Resource Timing) |
| Ladezeit: erstes Ergebnis nach Foto (1 s nach Start) | 195 ms | 1 375 ms (schlechtester Fall, ohne Vorladen durch Zeigerbewegung) | `ttfr.ts` (Median 5) |
| Init Objektdetektor | 292 ms | 599 ms | Harness `initObjects` |
| Init Gesicht (+ Emotion) | 55 ms | 152 ms | Harness `initFaces` |
| FPS: Inferenz pro 1080p-Frame | 25,3 ms (39,6 FPS) | 33,6 ms (29,8 FPS) | `run.ts fps` (120 Frames) |
| FPS: Analysen/s beim Abspielen ohne / mit Gesichtern | 46,1 / 43,9 (inkl. Doppelanalysen eines Videoframes) | 26,0 / 20,7 | `perf.ts` (8-s-Fenster) |
| CPU Renderer / GPU-Prozess beim Abspielen | 52 / 51 % | **43 / 44 %** | CDP `SystemInfo.getProcessInfo` |
| Speicher Renderer / GPU-Prozess (RSS) | 652 / 187 MB | 857 / 235 MB | `ps` auf CDP-PIDs |
| Gesamtgröße (alles Ausgelieferte) | 46 455 656 B | 78 489 787 B | Summe `dist/` |

## 4. Getroffene Annahmen

1. **Projekt:** Mit „Erkennungs-Webseite mit Gesichts-/Emotionserkennung“ ist Scene Lens gemeint (einzige App mit Emotionen). Der Object Counter im Repo-Root und dessen Live-URL bleiben unverändert.
2. **Ablage:** `./eval/` und `./docs/` liegen in `scene-lens/` (die App ist ein eigenes npm-Projekt; `docs/` im Repo-Root gehört zum Object Counter).
3. **Commits:** Dein Auftrag verlangt kleine Commits auf eigenem Branch. Die `CLAUDE.md` des Repos sagt „Never make git commits“. Ich bin dem ausdrücklichen Auftrag gefolgt, aber nur lokal, ohne Push.
4. **Testbilder:** Die gemeldeten Fehler stammen vermutlich aus Video oder Kamera. Ausschnitte, Herunterskalierung und JPEG-Kompression von Commons-Fotos stehen dafür. Die Soll-Labels der Emotionsbilder habe ich selbst durch Sichtung festgelegt. Die Pool-Labels entsprechen nur dem Suchbegriff.
5. **Schal → Messer** gilt als reproduziert, obwohl der Fehler nur unterhalb der Standardschwelle (bei 20–22 %) auftrat. Ein stärkerer Fall war in 1 524 Durchläufen nicht zu finden.
6. **FER+** (Train-Split) taugt als unabhängiger Test, weil HSEmotion laut README auf AffectNet trainiert ist und die alte Regel gar nicht trainiert war. Der Datensatz ist nur 48×48 Graustufen.
7. **COCO-Ausschnitt:** jede 10. Bild-ID von val2017 (500 Bilder) als repräsentative Stichprobe. Die eigene mAP weicht bei allen Kandidaten um höchstens 1,8 Punkte von den veröffentlichten Werten ab.
8. **Budget:** „Modelle + Assets“ = alles, was ausgeliefert wird (`dist/`).
9. **Zielplattform:** Desktop-Chrome (so im Erklärtext der App). Daher ist JSPI vertretbar (Chrome ≥ 137).
10. **Vergleichbarkeit:** Vorher/Nachher wird jeweils bei der App-Standardschwelle verglichen (0,40 alt, 0,65 neu), weil die Scores der beiden Modelle unterschiedlich kalibriert sind.
11. **Messgerät:** Alle Laufzeitzahlen stammen von einem einzigen High-End-Gerät, headless. Schwächere Geräte sind mehrfach langsamer. Einzelläufe schwanken um bis zu ±15 %.
12. **Cache-Dauer:** Für ungehashte Modelldateien 1 Tag + 7 Tage `stale-while-revalidate`. Das ist ein Kompromiss zwischen Wiederbesuch-Ladezeit und dem Risiko veralteter Modelle nach einem Austausch unter gleichem Namen.

## 5. Offene Punkte und bekannte Grenzen

**Deployment nicht ausgeführt.** Es fehlen:

1. Zugang zu deinem Vercel-Konto (Vercel-CLI ist nicht installiert, es gibt keinen Token).
2. Deine Entscheidung, den Branch zu GitHub zu pushen.
3. Ein Vercel-Projekt mit Root Directory `scene-lens`. Das bestehende Projekt baut den Repo-Root, also den Object Counter.

Die Header aus `vercel.json` sind daher nicht live geprüft, nur als gültiges JSON (gegen das Vercel-Schema nicht validiert).

**Phase-4-Kriterium „alle Metriken gleich gut oder besser“ nicht erfüllt** für Größe, Init, Inferenzzeit, Analysen/s, erstes Ergebnis und Speicher. Das ist ein Zielkonflikt mit den Genauigkeitsvorgaben aus Phase 2/3. Alle gemessenen Wege zurück zur alten Geschwindigkeit kosten Genauigkeit (z. B. D-FINE-S: 21,7 ms, −5 mAP). Das musst du entscheiden.

**Weitere Grenzen der Objekterkennung:**

- Schals werden als „Krawatte“ erkannt (COCO kennt keinen Schal, `scarf-tie` bleibt falsch).
- Ein Linsenreflex im Gegenlicht wird zur „Frisbee“ (0,65–0,93).
- `steady.mp4` wird zu 4 Personen und 4 Hunden gezählt (Wahrheit 2 + 2).
- Auf `ctl-cup` gibt es einen Fehlalarm „bench 0.90“.
- Das neue Modell meldet mehr Nebenobjekte (Tisch, Buch).

**Emotionen:**

- Ein Ausdruck ist kein Gefühl.
- Die Trefferquote liegt bei etwa zwei Dritteln. Typische Verwechslungen: überrascht ↔ ängstlich, neutral → wütend/traurig.
- „Frustriert“ gibt es in keinem Modell. Der Vorschlag (Valenz/Arousal anzeigen oder nachtrainieren) ist nicht umgesetzt.
- Kleine oder abgewandte Gesichter werden nicht gefunden. Höchstens 12 Personen pro Bild.
- Nicht für Entscheidungen über Personen geeignet.

**Technik:**

- Nur Chrome ≥ 137 (JSPI). Firefox und Safari laden die Erkennung nicht.
- Die fp16-Exporte von D-FINE und RF-DETR rechnen auf WebGPU falsch, deshalb wird Weight-only-fp16 genutzt.
- Das erste Ergebnis kommt bis zu 1,2 s später als vorher (Lazy Loading).

**Reproduzierbarkeit:**

- Wiedergabe- und Tracker-Messungen nutzen die lokalen Clips aus `test-vid/`, die laut Repo-Regel nicht eingecheckt werden.
- COCO-, FER+- und Kandidaten-Dateien liegen nur lokal in `eval/.out/` (git-ignoriert). Die Skripte laden sie erneut.

**Nicht geprüft:** echte Kamera (Webcam-Fluss nur über Videos simuliert), schwächere Geräte, Mobilbrowser.
