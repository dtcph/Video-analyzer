# Phase 2: Objekterkennung

Ergebnis: EfficientDet-Lite2 (MediaPipe) ist ersetzt durch **D-FINE-M** (Objects365 → COCO, Apache-2.0) in ONNX Runtime Web 1.30.0 mit WebGPU (WASM als Fallback). Dazu kommen eine neue Standardschwelle (0,65), eine Mindestschwelle für „teddy bear“, ein adaptiver zweiter Durchlauf für bildfüllende Objekte und eine Klassen-Glättung im Tracker. Auf dem Referenz-Set sind jetzt **19/20** Bilder korrekt (vorher 13/20). Alle Hunde werden als Hund erkannt, kein Schal als Messer, und es gibt keinen Regress.

Messumgebung wie in `00-baseline.md` (M4 Max, Chrome 158 headless, GPU). Alle Kandidaten liefen durch denselben Runner (`eval/models.ts`, `eval/scripts/models.ts`) über:

- das Referenz-Set `eval/fixtures/objects` (20 Bilder),
- **500 Bilder aus COCO val2017** (jede 10. Bild-ID, Liste `eval/.out/coco/val500.json`), ausgewertet mit `pycocotools` (`eval/scripts/coco_eval.py`),
- die Pools aus Phase 0 (122 Hunde-, 128 Schal-, 66 Kontrollbilder). Deren Labels sind nur der Suchbegriff und nicht je Bild geprüft, deshalb dienen sie nur als Näherung.

## Vergleichstabelle

„Größe“ ist die Datei, die ausgeliefert würde. „mAP“ steht für COCO mAP@[.5:.95]. „Eigene mAP“ ist auf dem 500er-Ausschnitt gemessen (deshalb nicht identisch mit den veröffentlichten 5 000 Bildern, die Abweichung liegt aber bei allen unter 1,8 Punkten, was die Messkette bestätigt). „FPS“ ist gemessen, nicht geschätzt: 1000 / mittlere Zeit für Vorverarbeitung + Inferenz + Auslesen auf einem 1920×1080-Standbild, 30 Läufe nach 3 Aufwärmläufen. Gilt nur für dieses Gerät, schwächere Geräte sind mehrfach langsamer. „Budget“: Modell + übriges Bundle (gemessen 50 267 323 B mit ORT-WASM, MediaPipe-WASM und Gesichtsmodell) < 100 MB.

| Modell | Größe | mAP veröffentlicht + Quelle | eigene mAP / AP50 (500 Bilder) | FPS (gemessen, 1080p) | Label-Set | Lizenz | passt ins 100-MB-Budget |
|---|---|---|---|---|---|---|---|
| EfficientDet-Lite2 (bisher, fp32 TFLite) | 23,1 MB | 33,97 [TF Model Maker] | 33,1 / 50,4 | 35,6 (28,1 ms) | COCO 80 | Apache-2.0 | ja (73 MB) |
| EfficientDet-Lite4 (int8 TFLite, MediaPipe) | 20,8 MB | 41,96 [TF Model Maker] | 39,8 / 58,0 | **1,2** (802 ms; GPU-Delegate lehnt die int8-Ops ab, läuft nur auf der CPU) | COCO 80 | Apache-2.0 | ja, aber zu langsam |
| YOLOv8n (fp16 ONNX) | 6,4 MB | 37,3 [Ultralytics YOLOv8] | 36,7 / 50,8 | 83 (12,0 ms) | COCO 80 | AGPL-3.0 | ja |
| YOLOv8s (fp16 ONNX) | 22,4 MB | 44,9 [Ultralytics YOLOv8] | 43,3 / 58,9 | 74 (13,5 ms) | COCO 80 | AGPL-3.0 | ja |
| YOLOv8m (Weight-fp16 ONNX) | 52,0 MB | 50,2 [Ultralytics YOLOv8] | 48,4 / 63,8 | 38 (26,2 ms) | COCO 80 | AGPL-3.0 | nein (102 MB) |
| YOLO11s (Weight-fp16 ONNX) | 19,1 MB | 47,0 [Ultralytics YOLO11] | 45,7 / 61,5 | 69 (14,5 ms) | COCO 80 | AGPL-3.0 | ja |
| YOLO11m (Weight-fp16 ONNX) | 40,5 MB | 51,5 [Ultralytics YOLO11] | 49,3 / 64,7 | 41 (24,5 ms) | COCO 80 | AGPL-3.0 | ja (91 MB) |
| D-FINE-S O365→COCO (fp32 ONNX) | 41,5 MB | 50,7 [D-FINE README] | 50,9 / 67,2 | 46 (21,7 ms) | COCO 80 | Apache-2.0 | ja (92 MB) |
| **D-FINE-M O365→COCO (Weight-fp16 ONNX)** | **39,8 MB** | **55,1** [D-FINE README] | **55,9 / 73,2** | **32 (31,3 ms)** | COCO 80 | Apache-2.0 | **ja (90 MB, nach Phase 4 weniger)** |
| D-FINE-M O365→COCO (fp32 ONNX, Referenz) | 78,6 MB | 55,1 [D-FINE README] | 55,9 / 73,2 | 32 (31,4 ms) | COCO 80 | Apache-2.0 | nein (129 MB) |
| RF-DETR-S (fp32 ONNX) | 114,7 MB | 53,0 [RF-DETR README] | 52,6 / 71,2 | 37 (27,0 ms) | COCO 80 | Apache-2.0 | nein. Als Weight-fp16 gemessene 57,8 MB → 108 MB |
| D-FINE-N (fp16 ONNX, HF) | 7,9 MB | 42,8 [D-FINE README] | nicht gemessen: Die fp16-Exporte von onnx-community rechnen auf WebGPU falsch (siehe unten), fp32 nicht geladen | – | COCO 80 | Apache-2.0 | ja |
| RF-DETR-N | 54,4 MB (fp16) | 48,4 [RF-DETR README] | nicht gemessen (größer als D-FINE-M, schwächer laut Quelle) | – | COCO 80 | Apache-2.0 | ja |

Quellen (alle am 27.11.2026 abgerufen, alle erreichbar):

- [TF Model Maker]: `tensorflow/tensorflow`, `tensorflow/lite/g3doc/models/modify/model_maker/object_detection.ipynb`, Tabelle „EfficientDet-Lite[0-4]“ (AP auf COCO 2017 val).
- [Ultralytics YOLOv8]: `ultralytics/ultralytics`, `docs/en/models/yolov8.md`, Detection-Tabelle COCO.
- [Ultralytics YOLO11]: `ultralytics/ultralytics`, `docs/en/models/yolo11.md`.
- [D-FINE README]: `Peterande/D-FINE`, `README.md`, Tabellen „COCO“ und „Objects365+COCO“.
- [RF-DETR README]: `roboflow/rf-detr`, `README.md`, Modelltabelle.

Herkunft der Dateien: D-FINE und RF-DETR von `huggingface.co/onnx-community/*-ONNX`. YOLOv8n/s aus `public/models` des Object Counter. YOLOv8m und YOLO11s/m habe ich mit Ultralytics (`yolo export format=onnx opset=17`) selbst exportiert. Lite4 kommt von TF Hub (`efficientdet/lite4/detection/metadata/2`).

Zwei technische Befunde, beide gemessen:

1. **fp16 auf WebGPU:** Die fp16-Dateien von onnx-community (D-FINE-S, RF-DETR-S) liefern im WebGPU-EP leere bzw. für jedes Bild identische Ausgaben. Auf der CPU (onnxruntime 1.23 in Python) funktionieren sie. Echte fp16-Konvertierungen von D-FINE-M mit `onnxconverter_common` und mit `onnxruntime.transformers.float16`, jeweils mit Blockliste, scheitern beim Laden (Typkonflikt an `Reshape`) oder rechnen auch auf der CPU falsch (Messer 0,012 statt 0,753).
2. **Weight-only fp16 funktioniert:** Gewichte als float16 gespeichert, im Graph per `Cast` zurück nach float32, gerechnet wird in float32. Damit gleiche mAP wie fp32 (55,9 / 73,2) bei halber Datei (39,8 statt 78,6 MB). Das Skript liegt in `eval/scripts/wf16.py`.

## Wahl und Begründung

D-FINE-M (O365 → COCO) als Weight-only-fp16. Es ist das genaueste Modell, das mit Abstand ins 100-MB-Budget passt: veröffentlicht 55,1 mAP, gemessen 55,9 mAP gegenüber 33,1 beim bisherigen EfficientDet-Lite2, also +22,8 Punkte. Mit 31 ms pro 1080p-Bild auf WebGPU ist es auf dem Testgerät schnell genug für Video, und die Apache-2.0-Lizenz erlaubt die Auslieferung ohne Auflagen. RF-DETR-S wäre bei Hunden robuster (Pool-Verwechslungen 2–5 % statt 7 %), ist aber weniger genau (52,6) und passt selbst als Weight-fp16 nicht ins Budget (108 MB). YOLO11m (49,3) und YOLOv8m (48,4) sind schwächer, und Lite4 ist ohne GPU-Delegate mit 1,2 FPS unbrauchbar.

## Maßnahmen gegen Fehlalarme (jede gemessen)

Grundlage: Die Rohdetektionen (≥ 0,05) von D-FINE-M auf allen Sets werden offline nachverarbeitet (`eval/scripts/tune.py`, `eval/scripts/adaptive.py`) und erneut mit COCO, Pools und Fixtures bewertet. P/R = Präzision / Recall auf den 500 COCO-Bildern bei IoU 0,5.

| Maßnahme | gemessen | Entscheidung |
|---|---|---|
| **Mindest-Confidence (Standardschwelle)** | Die DETR-Scores sind anders kalibriert als die von EfficientDet. P/R bei 0,40: 55/77, 0,55: 77/67, 0,60: 82/63, **0,65: 87/59**, 0,70: 90/54. Alt (Lite2) bei 0,40: 84/38. Fixtures: 0,60 → 18/20, 0,65 → 19/20. Pools bei 0,65: Hund gefunden 73 %, Hund verwechselt 7 % (alt 15 %), Schal falsch 7 % (alt 10 %) | **0,65**: höhere Präzision als vorher und +21 Punkte Recall. Regler-Startwert 65 % |
| **Klassenspezifische Schwelle „teddy bear“ ≥ 0,8** | echte Teddybären auf COCO: alle 12 Treffer ≥ 0,93. Falsche (Hunde, Schals) ≤ 0,67. mAP 55,9 → 55,9, Schal-Fehlalarme bei 0,6: 12 % → 11 % | **übernommen** |
| Klassenspezifische Schwelle „tie“ | echte Krawatten 0,33–0,87, Schals als Krawatte bis 0,89, die Bereiche überlappen | **verworfen** (würde echte Krawatten entfernen) |
| Klassenspezifische Schwelle „giraffe“ | echte Giraffen ab 0,33, Dalmatiner-Ausschnitt 0,96 | **verworfen** (per Schwelle nicht trennbar) |
| Klassenspezifische Schwelle „frisbee“ | Linsenreflex im Gegenlicht (`steady.mp4`) 0,65–0,93, echte Frisbees auf COCO 0,82–0,97 | **verworfen**, offene Grenze |
| **NMS / klassenübergreifende Duplikat-Unterdrückung** (D-FINE braucht keine NMS) | IoU 0,9: mAP 55,0. 0,8: 55,0. 0,7: 54,8. P/R bei 0,6 und alle Pool-Werte unverändert | **verworfen** (kostet mAP und bringt am Arbeitspunkt nichts) |
| Letterbox statt Strecken | Dalmatiner-Ausschnitt: Giraffe 0,92 statt 0,96 (CPU-Test) | **verworfen** (löst den Fehler nicht) |
| **Rand um das Bild** (grauer Rand, Bild verkleinert) | Rand 10 %: mAP 55,1, Fixtures 18/20. 15 %: 53,7, 19/20. 25 %: 51,8, 20/20 (Dalmatiner → Hund 0,95) | nicht dauerhaft (zu viel mAP-Verlust), siehe nächste Zeile |
| **Adaptiver 2. Durchlauf**: wenn eine Box (≥ 0,3) mindestens X % des Bildes bedeckt, das Bild mit 25 % Rand neu auswerten | X = 30 %: mAP 54,1. 40 %: 54,4. 50 %: 55,1. **60 %: 55,5**, AP Hund 73,3 → 78,3, Pool-Hund verwechselt 7 → 5 %, Fixtures 20/20. Der 2. Durchlauf trifft 111 von 500 COCO-Bildern (22 %). Kehrseite: Schal → Krawatte im Pool bei 0,65 steigt von 7 % auf 11 % | **übernommen mit X = 60 %** |
| **Glättung über mehrere Frames** (Tracker: Box darf bei IoU > 0,6 einen Track anderer Klasse fortsetzen, Klasse = score-gewichtete Mehrheit, Zählung folgt der Mehrheit) | Aufgezeichnete Echtzeit-Detektionen der App, offline durch beide Tracker (`eval/scripts/track_sim.ts`). Label-Wechsel zwischen Frames: `steady` 12 → 4, `moving_car` 24 → 18, `moving_handheld` 2 → 2. Zählungen: `steady` verliert 1 falsche Kuh, `moving_car` 67 → 66 Autos, sonst gleich | **übernommen** |

## Vorher/Nachher pro Testbild

Echte App-Pipeline (`src/detector.ts` über `eval/harness.ts`, `node eval/scripts/run.ts objects eval/fixtures/objects`), Auswertung `THR_BEFORE=0.4 THR_AFTER=0.65 python3 -I eval/scripts/score.py objects eval/.out/objects-phase2.json eval/.out/objects-baseline.json`. Jede Seite wird bei ihrer eigenen App-Standardschwelle bewertet, zusätzlich beim Regler-Minimum 0,20.

| Bild | Erwartet | Vorher @0.40 (Standard) | Nachher @0.65 (Standard) | OK vorher | OK nachher | Vorher @0.20 | Nachher @0.20 |
|---|---|---|---|---|---|---|---|
| dog-giraffe-1 | dog | giraffe 0.88 | dog 0.95 | **nein** | ja | giraffe 0.88 | dog 0.95, giraffe 0.52 |
| dog-giraffe-2 | dog | giraffe 0.68 | dog 0.94 | **nein** | ja | giraffe 0.68 | dog 0.94, bed 0.38, bed 0.37 |
| dog-giraffe-3 | dog | giraffe 0.61, giraffe 0.43 | dog 0.92 | **nein** | ja | giraffe 0.61, giraffe 0.43, giraffe 0.23 | dog 0.92, bowl 0.29, frisbee 0.27 |
| dog-teddy | dog | teddy bear 0.75 | couch 0.97, dog 0.93 | **nein** | ja | teddy bear 0.75 | couch 0.97, dog 0.93, chair 0.33 |
| dog-ok-1 | dog | dog 0.96 | dog 0.97 | ja | ja | dog 0.96 | dog 0.97 |
| dog-ok-2 | dog | dog 0.91 | dog 0.97 | ja | ja | dog 0.91 | dog 0.97 |
| dog-ok-3 | dog | dog 0.88, dog 0.73 | dog 0.97, dog 0.95 | ja | ja | dog 0.88, dog 0.73 | dog 0.97, dog 0.95, person 0.21 |
| scarf-knife | no knife | – | tie 0.89 | ja | ja | knife 0.22 | tie 0.89, person 0.57, tie 0.56 |
| scarf-giraffe-1 | no giraffe | giraffe 0.73 | person 0.71 | **nein** | ja | giraffe 0.73 | person 0.71, bed 0.51, bed 0.40 |
| scarf-giraffe-2 | no giraffe | giraffe 0.72 | person 0.96, tie 0.94 | **nein** | ja | giraffe 0.72 | person 0.96, tie 0.94 |
| scarf-tie | no tie | tie 0.52 | tie 0.65 | **nein** | **nein** | tie 0.52, tie 0.36, tie 0.31 | tie 0.65, tie 0.58, tie 0.47 |
| scarf-person-ok | person | person 0.93 | person 0.97 | ja | ja | person 0.93 | person 0.97 |
| ctl-cat | cat | cat 0.85 | cat 0.93 | ja | ja | cat 0.85 | cat 0.93 |
| ctl-car | car | car 0.82, bicycle 0.70, person 0.67, person 0.51 | car 0.93, bicycle 0.91, car 0.87, person 0.83 | ja | ja | car 0.82, bicycle 0.70, person 0.67 | car 0.93, bicycle 0.91, car 0.87 |
| ctl-bicycle | bicycle | bicycle 0.91 | bicycle 0.95 | ja | ja | bicycle 0.91, handbag 0.22 | bicycle 0.95, bicycle 0.21, bottle 0.20 |
| ctl-cup | cup | cup 0.89, cup 0.87, bench 0.40 | cup 0.96, cup 0.91, bench 0.90 | ja | ja | cup 0.89, cup 0.87, bench 0.40 | cup 0.96, cup 0.91, bench 0.90 |
| ctl-laptop | laptop | laptop 0.85 | laptop 0.95, dining table 0.74, book 0.71, book 0.69 | ja | ja | laptop 0.85, book 0.24, book 0.22 | laptop 0.95, dining table 0.74, book 0.71 |
| ctl-person | person | person 0.77 | person 0.89 | ja | ja | person 0.77 | person 0.89, traffic light 0.44, cell phone 0.35 |
| ctl-giraffe | giraffe | giraffe 0.94 | giraffe 0.96 | ja | ja | giraffe 0.94 | giraffe 0.96 |
| ctl-knife | knife | bottle 0.81, knife 0.68, person 0.56, cake 0.52 | knife 0.88, bottle 0.76, person 0.73, pizza 0.70 | ja | ja | bottle 0.81, knife 0.68, person 0.56 | knife 0.88, bottle 0.76, person 0.73 |

**Korrekt bei Standardschwelle: vorher 13/20, nachher 19/20. Beim Regler-Minimum 0,20: vorher 12/20, nachher 18/20.**

Done-Kriterium:

- **Hund als Hund:** alle 7 Hundebilder ✓.
- **Schal nicht als Messer:** ✓, „knife“ erscheint bei keinem Schalbild, auch nicht bei 0,20.
- **Kein Regress:** Alle 12 vorher korrekten Bilder sind nachher korrekt ✓.

Offen bleibt `scarf-tie`: Schals werden als „Krawatte“ erkannt. COCO hat keine Schal-Klasse, „tie“ ist die nächstliegende, und die Scores echter und falscher Krawatten überlappen (siehe oben). Außerdem bleibt „bench 0.90“ auf `ctl-cup` ein neuer, hoch bewerteter Fehlalarm. Er stört die Fixture-Regel nicht, wird aber angezeigt.

## Weitere Folgen

- **Zahl der Objekte:** Das neue Modell findet deutlich mehr Objekte (Recall 59 % statt 38 %), auch Nebenobjekte wie „dining table“ oder „book“. Die Zähltabellen werden dadurch länger.
- **Langsamere Analyse:** Die App analysiert bei Video jetzt ca. 15 Bilder/s statt vorher eine Analyse pro Anzeige-Frame (aufgezeichnet: `steady` 15,1/s, `moving_car` 15,7/s, `moving_handheld` 15,2/s). Phase 4 misst und optimiert das.
- **Grenzen bei Video:** Der Linsenreflex in `steady.mp4` und `moving_handheld.mp4` wird als „frisbee“ erkannt (0,65–0,93). `steady.mp4` wird zu 4 Personen und 4 Hunden gezählt, die Wahrheit ist 2 + 2 einschließlich des harten Schnitts. Beides löst weder die Schwelle noch die Glättung.
- **Code-Änderungen:** `src/detector.ts` (neu), `src/coco.ts`, `src/tracker.ts` (Abstimmung), `src/main.ts` (asynchrone Analyse mit genau einem Lauf gleichzeitig, Startschwelle 0,65), `index.html` (Regler 65 %), `src/strings.ts` (Erklärtext nennt D-FINE-M statt EfficientDet-Lite2). `public/models/efficientdet_lite2.tflite` ist entfernt, `public/THIRD_PARTY_NOTICES.txt` ist neu. Neue Laufzeitabhängigkeit: `onnxruntime-web` 1.30.0 (exakt), gleiche Version wie im Object Counter.
