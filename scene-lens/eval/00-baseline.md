# Baseline

Stand: Branch `feature/scene-lens-revision`, abgezweigt von `feature/scene-lens` @ `5aff8fa` (27.11.2026). Gegenstand ist die App **Scene Lens** im Ordner `scene-lens/`. Nur sie enthält Objekt- und Gesichts-/Emotionserkennung. Der Object Counter im Repo-Root ist ein eigenes Projekt und wird nicht verändert.

Messumgebung für alle Zahlen: MacBook mit Apple M4 Max (64 GB), macOS (Darwin 25.6), Google Chrome 158.0.8127.37 headless mit GPU (`--use-angle=metal --enable-unsafe-webgpu`), Node 24.16, Server lokal (localhost, ohne Netzwerkdrosselung). Rohdaten liegen in `eval/.out/*-baseline.json` (nicht eingecheckt) und sind mit den Skripten in `eval/scripts/` reproduzierbar.

## Stack (gefunden, nicht vermutet)

| Bereich | Befund | Quelle im Code |
|---|---|---|
| Sprache | TypeScript, `strict`, ES2022, kein JSX | `scene-lens/tsconfig.json` |
| TypeScript | `~5.6.3` | `scene-lens/package.json` |
| Framework | keins, Vanilla-DOM (`document.getElementById`, `innerHTML`) | `src/main.ts` |
| Build-Tooling | Vite `^6.0.0` (installiert: 6.4.6), `tsc --noEmit && vite build`, Ausgabe `dist/` | `package.json`, Build-Log |
| Postinstall | `scripts/copy-wasm.mjs` kopiert `node_modules/@mediapipe/tasks-vision/wasm` → `public/wasm` (git-ignoriert) | `scripts/copy-wasm.mjs`, `.gitignore` |
| ML-Bibliothek | `@mediapipe/tasks-vision` **0.10.21** (exakt gepinnt) | `package.json` |
| Routing | kein Router. Eine HTML-Seite (`index.html`) mit zwei Bildschirmen (`#home`, `#analysis`), umgeschaltet über das `hidden`-Attribut (`go()` in `main.ts`), dazu ein Modal (`#tm`) | `index.html`, `src/main.ts` |
| Seiten/Unterseiten | 1. Start (`#home`: Hero + „Warum“-Abschnitt), 2. Analyse (`#analysis`: Kopfzeile, Bühne + Seitenleiste, Ergebnisse), 3. Treemap-Modal (`#tm`), 4. Sprachumschalter `.lang` (fixiert, auf allen Bildschirmen) | `index.html` |
| CSS-Ansatz | eine eigene Datei `src/style.css` (85 Zeilen), kein Framework, keine Utilities. 6 Custom Properties (nur Farben), dazu Inline-Styles in `main.ts` (2 Stellen) und `treemapModal.ts` (Zell-Positionen) | `src/style.css` |
| i18n | eigene Lösung (`src/i18n.ts`, `src/strings.ts`), Koreanisch (Standard) + Englisch | `src/i18n.ts` |
| Deployment | `vercel.json` existiert nur im Repo-Root und gehört zum Object Counter. Scene Lens hat keine eigene Vercel-Konfiguration. Die Live-URL `video-analyzer-sable.vercel.app` liefert den Object Counter aus (`<title>Object Counter</title>`, `/models/efficientdet_lite2.tflite` → HTTP 404, geprüft per `curl`) | `../vercel.json` |
| Tests/Lint | Scene Lens hat weder Tests noch Linter noch Prettier | `package.json` |

## Objekterkennung: Modell, Lib, Schwellen, Größe

| Eigenschaft | Wert | Beleg |
|---|---|---|
| Modell | EfficientDet-Lite2 (`public/models/efficientdet_lite2.tflite`) | `src/detector.ts` |
| Dateigröße | 23 096 891 B (22,0 MiB) | `stat` |
| Gewichte/Präzision | float32 (alle 685 Float-Tensoren `FLOAT32`, keine f16/int8-Tensoren), also **nicht quantisiert** | TFLite-Flatbuffer gelesen (Python-Paket `tflite`) |
| Eingabe | `[1, 448, 448, 3]` float32 | TFLite-Flatbuffer |
| Ausgabe | 37 629 Anker × 4 Box-Koordinaten und 37 629 × 90 Klassen-Scores. Keine NMS im Modell | TFLite-Flatbuffer |
| Label-Set | `labels.txt` im Modell: 90 Einträge inkl. `???`-Platzhaltern, also 80 COCO-Klassen. Koreanische Namen für alle 80 in `CLASS_KO` | Modell-Metadaten, `src/strings.ts` |
| Bibliothek | MediaPipe Tasks Vision `ObjectDetector` 0.10.21 | `src/detector.ts` |
| Backend | `delegate: "GPU"` (MediaPipe-GPU-Pfad, WebGL2), bei Fehler `"CPU"` (TFLite/XNNPACK in WASM). Gemessen: GPU aktiv | `loadDetector()`, Harness-Ausgabe `delegate: GPU` |
| WASM-Laufzeit | `vision_wasm_internal.wasm` 9 574 032 B + `vision_wasm_nosimd_internal.wasm` 9 448 638 B + 2 JS-Loader à ca. 204 KB. Beide WASM-Varianten werden deployt, Chrome lädt nur die SIMD-Variante (gemessener Transfer 29 877 KB) | `ls public/wasm`, Perf-Messung |
| Score-Schwelle | `scoreThreshold` 0,40 beim Start, Regler 0,20–0,90 (`#thr`, min 20, max 90) | `main.ts`, `index.html` |
| maxResults | 60 | `detector.ts` |
| NMS | wird von der App nicht gesetzt. MediaPipe-Standard `min_suppression_threshold = 0.3`, `multiclass_nms = false`, IoU, Algorithmus DEFAULT (Quelle: `mediapipe/tasks/cc/vision/object_detector/object_detector.h` und `components/processors/detection_postprocessing_graph.cc`, Tag v0.10.21). **Gemessen:** Unter 49 705 Detektionspaaren aus 2 444 Bilddurchläufen liegt kein Paar über IoU 0,39. Oberhalb von 0,3 gibt es nur 90 Paare, sonst bricht die Verteilung bei 0,3 ab, auch zwischen verschiedenen Klassen. Die NMS ist also klassenübergreifend bei ca. 0,3 | Quellcode, eigene Messung |
| Laufmodus | `IMAGE` für Fotos, `VIDEO` (`detectForVideo`) für Video/Kamera | `setMode()` |
| Nachverarbeitung | nur die oberste Kategorie je Box. Zählung: gieriger IoU-Tracker (IoU > 0,3, gleiche Klasse, zählt nach 3 Treffern, verwirft nach 45 verpassten Frames). Kein Glätten der Klassen | `src/tracker.ts` |

## Gesichts-/Emotionserkennung: Modell, Klassen, Mapping

| Eigenschaft | Wert | Beleg |
|---|---|---|
| Modell | MediaPipe Face Landmarker (`public/models/face_landmarker.task`, 3 758 596 B) | `src/faces.ts` |
| Inhalt des Bundles (ZIP) | `face_detector.tflite` 229 746 B, Eingabe 128×128. `face_landmarks_detector.tflite` 2 553 590 B, Eingabe 256×256, Ausgabe 1 434 = 478 Punkte × 3. `face_blendshapes.tflite` 955 312 B, Eingabe 146 Punkte × 2, Ausgabe 52 Blendshapes. Alle drei mit f16-Tensoren | `unzip -l`, TFLite-Flatbuffer |
| Optionen | `runningMode: "IMAGE"`, `numFaces: 1`, `outputFaceBlendshapes: true`, `minFaceDetectionConfidence: 0.3`, `minFacePresenceConfidence: 0.3`, GPU mit CPU-Fallback | `loadFaces()` |
| Emotionsmodell | **keins.** Die Emotion entsteht aus einer handgeschriebenen Regel `classify()` über die 52 Blendshapes (Kommentar im Code: „thresholds are hand-tuned estimates (not a trained emotion model)“) | `faces.ts` |
| Ausgegebene Klassen | 6 + 1: `happy`, `neutral`, `surprised`, `sad`, `angry`, `thoughtful`, dazu `null` = „kein Gesicht“ | Typ `Emotion` |
| Regel (Reihenfolge = Priorität) | 1. `smile > 0.45` → happy. 2. `jawOpen > 0.3 && (eyeWide > 0.25 \|\| browUp > 0.4)` oder `browUp > 0.6 && eyeWide > 0.3` → surprised. 3. `browDown > 0.45 && (frown > 0.1 \|\| press > 0.2)` → angry. 4. `frown > 0.25 \|\| browInnerUp > 0.45` → sad. 5. `smile < 0.15 &&` (Blick nach unten/seitlich, Pucker o. Ä.) → thoughtful. 6. sonst neutral | `classify()` |
| Kette | Objektdetektor → Boxen „person“ (≥ App-Schwelle) → Ausschnitt: bei `h > 1.4·w` die oberen 40 % der Box, sonst die ganze Box, plus 10 % Rand (Breite), hochskaliert auf ≥ 224 px kurze Seite → Face Landmarker → Blendshapes → `classify()` → Verlauf der letzten 5 Ergebnisse je Person (IoU-Zuordnung > 0,3) → Mehrheit → UI. Höchstens 12 Personen, alle 250 ms (bei Pause sofort) | `analyse()`, `refresh()`, `stable()` |
| Mapping auf die UI | `emo.<klasse>` in `strings.ts`: happy „Happy/웃음“, neutral „Neutral/무표정“, thoughtful „Thoughtful/생각에 잠김“, surprised „Surprised/놀람“, sad „Sad/슬픔“, angry „Angry/화남“, null „No visible face/얼굴 안 보임“. Anzeige im Box-Label und in der Liste „People in detail“ | `strings.ts`, `renderFaces()` |
| Abdeckung der 8 geforderten Klassen | wütend → `angry` ✓, frustriert ✗, traurig → `sad` ✓, überrascht → `surprised` ✓, angewidert ✗, ängstlich ✗, froh → `happy` ✓, neutral → `neutral` ✓. Zusätzlich `thoughtful`, das nicht gefordert ist | Typ `Emotion`, `strings.ts` |

## Layout-Ist-Zustand: Liste aller Seiten + jeweils verwendete Grids/Ausrichtungen

Ein gemeinsames Grid-System gibt es nicht. Custom Properties existieren nur für Farben (`--bg --fg --muted --line --soft --accent`). Gezählt (`grep` in `style.css`): **15 verschiedene feste Schriftgrößen** (12, 13, 14, 15, 16, 19, 20, 22, 24, 26, 28, 40 px plus 3 `clamp()`-Ausdrücke), **29 verschiedene Abstandswerte** (u. a. 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13, 14, 16, 18, 20, 24, 28, 32, 40, 48, 64, 72, 100, 120, 140, 150 px und 8vw) sowie 19 `display:grid/flex`-Deklarationen.

| Seite/Bildschirm | Grid/Ausrichtung | Außenrand | Kopfzeile |
|---|---|---|---|
| Start, Hero (`.hero`) | Flex-Spalte, vertikal zentriert, `min-height: 100vh`. `h1` `clamp(72px, 12vw, 168px)`, Lead `max-width: 640px`, Buttons Flex mit `gap: 12px`, Scroll-Hinweis absolut `bottom: 40px; left: 8vw` | `0 8vw` (102 px bei 1280) | **keine.** Nur der fixierte Sprachumschalter |
| Start, „Warum“ (`.about`) | `.steps` 4-spaltiges Grid `repeat(4, 1fr)`, `gap: 32px` (auch bei 375 px 4 Spalten), Fließtext `max-width: 860px` | `120px 8vw 140px` | keine |
| Analyse, Kopfzeile (`.bar`) | Flex, `gap: 24px`. `h1` 28 px, Status `margin-left: auto; margin-right: 150px` (Platz für den Sprachumschalter) | `20px 48px` | eigene Kopfzeile, nur hier |
| Analyse, Hauptbereich (`main.grid`) | 2 Spalten `minmax(0, 1fr) 380px`, `gap: 48px`. Seitenleiste mit `position: absolute; inset: 0` innen, `min-height: 520px`. Kein Umbruch für schmale Bildschirme | `8px 48px 0` | – |
| Analyse, Ergebnisse (`.results`) | `repeat(auto-fit, minmax(300px, 1fr))`, `gap: 48px`. Vergleichszeilen eigenes Grid `110px 1fr 70px` | `64px 48px 100px` | – |
| Treemap-Modal (`.panel`) | Flex-Spalte, `gap: 16px`, `80vw × 80vh`, Titel 40 px, Schließen-Knopf absolut `top: 18px; right: 20px` | `padding: 32px` | eigener Titel im Panel |
| Sprachumschalter (`.lang`) | `position: fixed; top: 14px; right: 24px` | – | liegt über beiden Bildschirmen und deckt rechts Teile der Analyse-Kopfzeile ab (deshalb das 150-px-Loch) |

Folgen: Die linke Kante springt zwischen Start (8vw) und Analyse (48 px), außer bei 600 px Breite. Die Kopfzeilen sind uneinheitlich (Start ohne Kopfzeile, Analyse mit 20 px Innenabstand oben, Sprachumschalter bei 14 px). Bei 375 px laufen `.steps` (4 Spalten) und `main.grid` (380-px-Spalte) über.

## Messwerte (Tabelle: Metrik | Wert | Messmethode)

| Metrik | Wert | Messmethode |
|---|---|---|
| Deploy-Bundle gesamt (`dist/`) | 46 455 656 B (44,3 MiB) | `vite build`, Summe aller Dateien in `dist/` (`eval/scripts/perf.ts`) |
| davon Modelle | 26 855 487 B | dito, `dist/models/` |
| davon WASM-Laufzeit | 19 431 091 B (zwei WASM-Varianten + zwei Loader) | dito, `dist/wasm/` |
| davon JS / CSS / HTML | 156 880 B / 7 208 B / 4 990 B | dito |
| Modell Objekterkennung | 23 096 891 B | `stat` auf `public/models/efficientdet_lite2.tflite` |
| Modell Gesicht (Detektor + Landmarks + Blendshapes) | 3 758 596 B | `stat` auf `face_landmarker.task` |
| Übertragene Daten, kalter Start | 29 877 KB | Resource Timing (`transferSize`, Summe), Median aus 5 Läufen mit frischem Profil |
| First Contentful Paint | 32 ms | Paint Timing, Median 5 kalte Läufe |
| Time-to-interactive, kalt | 671 ms (Einzelwerte 679/671/666/657/720) | Ende der letzten Long Task vor einem 5-s-Fenster ohne Long Tasks, frühestens DOMContentLoaded (PerformanceObserver `longtask`), Production-Build über `vite preview`, frisches Profil, Median 5 |
| Time-to-interactive, warm | 255 ms | dito, Reload im selben Profil (HTTP-Cache gefüllt), Median 5 |
| Modell bereit (Statuszeile „ready“), kalt / warm | 671 ms / 255 ms | MutationObserver auf `#status`, Zeit ab Navigationsstart, Median 5 |
| Modell-Init Objektdetektor (nur `loadDetector`) | 292 ms (GPU) | `performance.now()` um `loadDetector(0.4)` im Eval-Harness (`eval/harness.ts`), Dev-Server, erster Aufruf nach Seitenstart |
| Modell-Init Face Landmarker | 55 ms | `performance.now()` um `loadFaces()` im Harness, nach geladenem Detektor (WASM schon geladen) |
| Inferenzzeit pro Frame | 25,3 ms Mittel, 26,4 ms p95 → 39,6 FPS | `detect()` auf 120 aufeinanderfolgenden Videoframes (1920×1080, `moving_car.mp4`), `VIDEO`-Modus, GPU, 5 Frames Aufwärmen (`run.ts fps`) |
| App-Schleife beim Abspielen, ohne Gesichter | 46,1 Hz bei 29,9 Video-FPS | 8-s-Fenster, Zähler für `requestAnimationFrame`/`requestVideoFrameCallback`. Die App ruft in jedem rAF `detect()` auf, also auch doppelt pro Videoframe (`perf.ts`) |
| App-Schleife mit Gesichtern | 43,9 Hz bei 30,0 Video-FPS (2560×1440, `moving_handheld.mp4`) | dito, Schalter „People & emotions“ an |
| CPU-Last Renderer / GPU-Prozess, ohne Gesichter | 52 % / 51 % eines Kerns | CDP `SystemInfo.getProcessInfo` (`cpuTime`-Differenz) über das 8-s-Fenster. Eine echte GPU-Auslastung liefert Chrome nicht, die CPU-Zeit des GPU-Prozesses dient als Näherung |
| CPU-Last Renderer / GPU-Prozess, mit Gesichtern | 53 % / 52 % | dito |
| Speicher JS-Heap (nach GC) ohne / mit Gesichtern | 4 MB / 5 MB | CDP `Performance.getMetrics` `JSHeapUsedSize` nach `HeapProfiler.collectGarbage` |
| Speicher Renderer-Prozess (RSS) ohne / mit Gesichtern | 652 MB / 733 MB | `ps -o rss` auf die PIDs aus `SystemInfo.getProcessInfo` |
| Speicher GPU-Prozess (RSS) ohne / mit Gesichtern | 187 MB / 222 MB | dito |

## Reproduzierte Fehlklassifikationen (Tabelle: Bild | Erwartet | Ist | Confidence)

Referenz-Set: `eval/fixtures/` mit 20 Objektbildern und 23 Emotionsbildern, alle von Wikimedia Commons unter freier Lizenz (Quelle, Urheber, Lizenz und Bildbearbeitung je Datei in `eval/fixtures/manifest.json`). So wurde es gefunden: 316 Hunde-, Schal- und Kontrollbilder (122/128/66) über die Commons-API (`eval/scripts/fetch_pool.py`), dazu 2 181 Ausschnitt-, Skalierungs- und Kompressionsvarianten, die Video- und Webcam-Bilder nachahmen. Alles lief durch die unveränderte App-Pipeline (`eval/scripts/run.ts`, App-Module über `eval.html`). Das Soll-Label der Emotionsbilder habe ich durch eigene Sichtung festgelegt (Annahme, siehe REPORT).

Die Objekte habe ich bei der App-Standardschwelle 0,40 ausgewertet. Die Spalte „@0.20“ zeigt das Regler-Minimum.

| Bild | Erwartet | Ist | Confidence |
|---|---|---|---|
| `objects/dog-giraffe-1.jpg` (Dalmatiner, Mittelausschnitt) | dog | **giraffe** | 0,884 |
| `objects/dog-giraffe-2.jpg` (Dogge, 480 px, JPEG q12) | dog | **giraffe** | 0,675 |
| `objects/dog-giraffe-3.jpg` (Dalmatiner, 480 px, JPEG q12) | dog | **giraffe** (2 Boxen) | 0,612 / 0,427 |
| `objects/dog-teddy.jpg` (weißer Hund auf Sofa) | dog | teddy bear | 0,753 |
| `objects/scarf-knife.jpg` (Seidenschals mit Metallringen, 480 px) | kein Messer | **knife** (nur unter 0,40, sichtbar ab Reglerstellung ≤ 22 %) | 0,224 |
| `objects/scarf-giraffe-1.jpg` (gemusterter Schal, untere Hälfte) | keine Giraffe | giraffe | 0,733 |
| `objects/scarf-giraffe-2.jpg` (gemusterter Schal, untere Hälfte) | keine Giraffe | giraffe | 0,722 |
| `objects/scarf-tie.jpg` (Schals im Laden) | keine Krawatte | tie | 0,523 |
| `objects/dog-ok-1/2/3`, `scarf-person-ok`, 8 × `ctl-*` | jeweilige Klasse | korrekt | siehe Tabelle unten |

Hund → Giraffe ist dreifach über der Standardschwelle reproduziert. Schal → Messer ist mit 0,224 reproduziert, aber **nur unterhalb der Standardschwelle**: Unter 1 524 Durchläufen mit Schalbildern und -varianten erreichte „knife“ höchstens 0,224. Mit der Standardschwelle 0,40 zeigt die App diesen Fehler nicht, erst bei einer Reglerstellung von 20–22 %. Schals werden dagegen häufig und deutlich als Giraffe (0,73) oder Krawatte (0,52) erkannt.

Vollständige Baseline des Objekt-Sets (`python3 -I eval/scripts/score.py objects eval/.out/objects-baseline.json`):

| Bild | Erwartet | Ist @0.40 | Ist @0.20 | OK @0.40 | OK @0.20 |
|---|---|---|---|---|---|
| dog-giraffe-1 | dog | giraffe 0.88 | giraffe 0.88 | **nein** | **nein** |
| dog-giraffe-2 | dog | giraffe 0.68 | giraffe 0.68 | **nein** | **nein** |
| dog-giraffe-3 | dog | giraffe 0.61, giraffe 0.43 | giraffe 0.61, giraffe 0.43, giraffe 0.23 | **nein** | **nein** |
| dog-teddy | dog | teddy bear 0.75 | teddy bear 0.75 | **nein** | **nein** |
| dog-ok-1 | dog | dog 0.96 | dog 0.96 | ja | ja |
| dog-ok-2 | dog | dog 0.91 | dog 0.91 | ja | ja |
| dog-ok-3 | dog | dog 0.88, dog 0.73 | dog 0.88, dog 0.73 | ja | ja |
| scarf-knife | no knife | – | knife 0.22 | ja | **nein** |
| scarf-giraffe-1 | no giraffe | giraffe 0.73 | giraffe 0.73 | **nein** | **nein** |
| scarf-giraffe-2 | no giraffe | giraffe 0.72 | giraffe 0.72 | **nein** | **nein** |
| scarf-tie | no tie | tie 0.52 | tie 0.52, tie 0.36, tie 0.31, kite 0.30 | **nein** | **nein** |
| scarf-person-ok | person | person 0.93 | person 0.93 | ja | ja |
| ctl-cat | cat | cat 0.85 | cat 0.85 | ja | ja |
| ctl-car | car | car 0.82, bicycle 0.70, person 0.67, person 0.51 | car 0.82, bicycle 0.70, person 0.67, person 0.51 | ja | ja |
| ctl-bicycle | bicycle | bicycle 0.91 | bicycle 0.91, handbag 0.22 | ja | ja |
| ctl-cup | cup | cup 0.89, cup 0.87, bench 0.40 | cup 0.89, cup 0.87, bench 0.40, chair 0.29 | ja | ja |
| ctl-laptop | laptop | laptop 0.85 | laptop 0.85, book 0.24, book 0.22, book 0.21 | ja | ja |
| ctl-person | person | person 0.77 | person 0.77 | ja | ja |
| ctl-giraffe | giraffe | giraffe 0.94 | giraffe 0.94 | ja | ja |
| ctl-knife | knife | bottle 0.81, knife 0.68, person 0.56, cake 0.52 | bottle 0.81, knife 0.68, person 0.56, cake 0.52 | ja | ja |

Korrekt: **13/20 bei 0,40, 12/20 bei 0,20.**

Emotions-Baseline (App-Kette Detektor → Person → Face Landmarker → Regel; `score.py emotions`). Bei mehreren Personen ist ein Bild ein Treffer, wenn eine davon die erwartete Klasse hat. Die Regel liefert keine Confidence, deshalb steht in der Spalte die Detektor-Confidence der Person.

| Bild | Erwartet | Ist | Confidence (Person) |
|---|---|---|---|
| angry-011 | wütend | happy | 0,94 |
| angry-024 | wütend | sad | 0,91 |
| frustrated-012 | frustriert | sad | 0,83 |
| frustrated-016 | frustriert | kein Gesicht | 0,89 |
| frustrated-020 | frustriert | neutral / thoughtful | 0,88 / 0,88 |
| sad-017 | traurig | thoughtful | 0,92 |
| sad-019 | traurig | kein Gesicht (Ausschnitt). Auf dem ganzen Bild liefert die Regel „sad“ | 0,92 |
| sad-029 | traurig | happy | 0,88 |
| sad-033 | traurig | neutral | 0,91 |
| surprised-008 | überrascht | kein Gesicht (Ausschnitt). Auf dem ganzen Bild „surprised“ | 0,81 |
| surprised-036 | überrascht | happy | 0,91 |
| surprised-038 | überrascht | surprised ✓ | 0,89 |
| disgusted-003 | angewidert | thoughtful (Klasse fehlt) | 0,86 |
| disgusted-020 | angewidert | kein Gesicht / neutral (Klasse fehlt) | 0,93 / 0,88 |
| afraid-011 | ängstlich | thoughtful (Klasse fehlt) | 0,66 |
| afraid-012 | ängstlich | surprised (Klasse fehlt) | 0,87 |
| afraid-017 | ängstlich | sad (Klasse fehlt) | 0,94 |
| happy-003 / 006 / 011 | froh | happy ✓ ✓ ✓ | 0,92 / 0,94 / 0,83 |
| neutral-013 | neutral | neutral ✓ | 0,93 |
| neutral-017 | neutral | thoughtful | 0,91 |
| neutral-032 | neutral | neutral ✓ | 0,93 |

Trefferquote je Klasse: wütend 0/2, frustriert 0/3, traurig 0/4, überrascht 1/3, angewidert 0/2, ängstlich 0/3, froh 3/3, neutral 2/3. **Gesamt 6/23.**
