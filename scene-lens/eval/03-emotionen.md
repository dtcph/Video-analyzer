# Phase 3: Gesichts- und Emotionserkennung

Ergebnis: Die handgeschriebene Blendshape-Regel ist ersetzt durch ein trainiertes Ausdrucksmodell, **HSEmotion EfficientNet-B0 `enet_b0_8_va_mtl`** (AffectNet, 8 Klassen, Apache-2.0, 16,0 MB). Dazu kommen eine robustere Gesichtssuche, die Ausrichtung an der Augenlinie, ein enger Gesichtsausschnitt, gemittelte Wahrscheinlichkeiten und die Kategorie „Unklar“.

| Testset | vorher | nachher |
|---|---|---|
| Referenzbilder (23) | 6/23 | **17/23** |
| FER+ (420 Gesichter, 60 je Klasse) | 20,0 % (alte Regel) | **63,3 %** |

„Frustriert“ gibt kein verfügbares Modell aus. Das ist unten ausdrücklich festgestellt, mit einem Lösungsvorschlag.

Testdaten:

1. `eval/fixtures/emotions/`: 23 Fotos von Wikimedia Commons, Soll-Label durch meine Sichtung (Annahme), durch die **ganze App-Kette** (Objektdetektor → Person → Gesicht → Ausdruck). Auswertung `python3 -I eval/scripts/score.py emotions`.
2. **FER+** (Barsoum et al., FER2013 mit 10 Annotatoren neu gelabelt; Hugging Face `deanngkl/ferplus-7cls`, Train-Split, auf dem keines der beiden Verfahren trainiert ist): 60 zufällige Gesichter je Klasse (Seed 0), insgesamt 420. Die Bilder sind 48×48 Graustufen, also schlechter als echte Kamerabilder. Damit wird **nur die Gesichts-/Ausdrucksstufe** gemessen (`node eval/scripts/run.ts ferplus …`, `python3 -I eval/scripts/fer_eval.py`). Die Bilder sind nicht eingecheckt (Lizenz des Datensatzes ungeklärt).

## Kettenanalyse pro Stufe

| Stufe | Vorgefunden (vorher) | Befund (gemessen) | Nachher |
|---|---|---|---|
| 1. Gesichtsdetektion | Face Landmarker (BlazeFace 128 px + Mesh 256 px), `numFaces 1`, Mindest-Confidence 0,3, auf einem Ausschnitt der Personenbox | Fixtures: bei 3/23 Bildern kein Gesicht (frustrated-016, sad-019, surprised-008). Auf dem **ganzen** Bild findet derselbe Landmarker bei sad-019 und surprised-008 ein Gesicht, der Ausschnitt ist also schuld. FER+ (auf 224 px hochskaliert): Gesicht in 367/420 | gleicher Landmarker. Ohne Gesicht im Kopfbereich wird die ganze Box versucht, erst mit schwarzem Rand über die Bildkante hinaus, dann auf das Bild beschnitten. Fixtures: 1 von 23 größten Personen ohne Gesicht (disgusted-020: Mann im Profil; das angewiderte Gesicht der Frau wird gelesen). FER+: 389/420 |
| 2. Crop / Alignment | bei `h > 1,4·w` die oberen 40 % der Box, sonst die ganze Box, +10 % Rand, kurze Seite auf ≥ 224 px. Keine Ausrichtung (für Blendshapes nicht nötig) | Die 40-%-Regel schneidet bei Nahaufnahmen (Box ≈ ganzes Bild) das Gesicht ab. Ohne Rand findet der Detektor ein bildfüllendes Gesicht manchmal nicht (afraid-011), mit Rand manchmal nicht (sad-019) | Drehung an der Linie der äußeren Augenwinkel (Mesh-Punkte 33/263), quadratischer Ausschnitt = Ausdehnung der Landmarks × 1,2, auf 224×224. Gemessen auf FER+ (mit `vgaf`-Modell): Ausrichtung an 59,5 %, aus 58,1 %. Rand 0 % / 10 % / 20 %: 62,4 / 59,5 / 55,7 % (FER+), 14 / 15 / 15 von 23 (Fixtures). Gewählt: 10 %, weil die App mit echten Fotos arbeitet und FER+ schon eng beschnitten ist |
| 3. Vorverarbeitung | intern in MediaPipe (RGB, eigene Normierung) | kein Fehler feststellbar | RGB, /255, ImageNet-Normierung (Mittel 0,485/0,456/0,406, Std 0,229/0,224/0,225), 224 px. Exakt wie `hsemotion_onnx/facial_emotions.py` 0.3.1 (Quellcode gelesen) |
| 4. Emotionsmodell | **keins**: Regel über 52 Blendshapes, Schwellen von Hand | FER+ gesamt 20,0 % (Zufall bei 7 Klassen: 14,3 %) | HSEmotion B0 `va_mtl`. Verglichen (FER+ / Fixtures): `enet_b0_8_best_vgaf` 59,5 % / 15, **`enet_b0_8_va_mtl` 63,3 % / 16 (nach Stufe-1-Fix 17)**, `enet_b2_8` (30,8 MB, 260 px) 61,9 % / 11. Veröffentlicht (README HSEmotion, AffectNet-8): 61,32 / 61,93 / 63,03 % |
| 5. Schwellen | feste Regelschwellen in fester Reihenfolge (froh zuerst), Mehrheit der letzten 5 Labels | siehe Ursachenbefund | Mittel der Wahrscheinlichkeiten der letzten 5 Ergebnisse je Person. Unter 0,4 lautet das Ergebnis „Unklar“. FER+-Kette: 0 → 389/389 angezeigt, davon 68,4 % richtig. **0,4 → 374/389, 69,8 % richtig**. 0,5 → 331, 71,6 %. 0,6 → 281, 76,2 %. Fixtures bei 0 und 0,4 gleich |
| 6. UI-Anzeige | 6 Klassen + „kein Gesicht“: froh, neutral, nachdenklich, überrascht, traurig, wütend | „nachdenklich“ hat keine Entsprechung in einem Datensatz und schluckt auf FER+ 16/60 wütende, 30/60 traurige und 24/60 neutrale Gesichter | 8 Modellklassen + „Unklar“ + „kein Gesicht“ (ko/en). „Nachdenklich“ entfällt. Hinweistext sagt jetzt, dass nur der sichtbare Ausdruck geschätzt wird und oft falsch ist |
| Index → Label | Blendshapes per Name (`categoryName`), kein Index | korrekt | Reihenfolge laut `hsemotion_onnx` 0.3.1 (`idx_to_class`, 8 Klassen): Anger, Contempt, Disgust, Fear, Happiness, Neutral, Sadness, Surprise. Plausibilitätsprüfung: 49/60 frohe Gesichter → froh, 55/60 ängstliche → ängstlich. Eine falsche Zuordnung würde ganze Klassen verschieben |

## Klassen-Abdeckungstabelle

„Trefferquote“ = Fixtures (ganze App-Kette) | FER+ (nur Gesichtsstufe, ohne „Unklar“-Schwelle, damit beide Seiten gleich behandelt werden).

| Klasse | im Modell (vorher → nachher) | in UI (vorher → nachher) | Trefferquote vorher | Trefferquote nachher |
|---|---|---|---|---|
| wütend | Regel → ja (Anger) | ja → ja | 0/2 \| 0/60 | **2/2 \| 40/60** |
| frustriert | nein → **nein** | nein → nein | 0/3 \| – (nicht in FER+) | 0/3 \| – |
| traurig | Regel → ja (Sadness) | ja → ja | 0/4 \| 3/60 | **3/4 \| 35/60** |
| überrascht | Regel → ja (Surprise) | ja → ja | 1/3 \| 23/60 | **3/3 \| 27/60** |
| angewidert | nein → ja (Disgust) | nein → ja | 0/2 \| 0/60 | **2/2 \| 37/60** |
| ängstlich | nein → ja (Fear) | nein → ja | 0/3 \| 0/60 | **2/3 \| 55/60** |
| froh | Regel → ja (Happiness) | ja → ja | 3/3 \| 40/60 | 3/3 \| 49/60 |
| neutral | Regel → ja (Neutral) | ja → ja | 2/3 \| 18/60 | 2/3 \| 23/60 |
| (Verachtung) | nein → ja (Contempt) | nein → ja | nicht gefordert, nicht getestet | – |
| (nachdenklich) | Regel → entfällt | ja → nein | nicht in Testdaten | – |
| **gesamt** | | | **6/23 \| 84/420 (20,0 %)** | **17/23 \| 266/420 (63,3 %)** |

Vorher/Nachher je Referenzbild (`score.py emotions eval/.out/emotions-phase3.json eval/.out/emotions-baseline.json`):

| Bild | Erwartet | Vorher | Nachher | Treffer nachher |
|---|---|---|---|---|
| angry-011 | wütend | happy | angry | ja |
| angry-024 | wütend | sad | angry | ja |
| frustrated-012 | frustriert | sad | sad | nein (Klasse fehlt) |
| frustrated-016 | frustriert | kein Gesicht | sad | nein (Klasse fehlt) |
| frustrated-020 | frustriert | neutral, thoughtful, kein Gesicht | sad, happy, neutral | nein (Klasse fehlt) |
| sad-017 | traurig | thoughtful | uncertain | nein |
| sad-019 | traurig | kein Gesicht | sad | ja |
| sad-029 | traurig | happy | sad | ja |
| sad-033 | traurig | neutral, kein Gesicht | sad, kein Gesicht | ja |
| surprised-008 | überrascht | kein Gesicht | surprised | ja |
| surprised-036 | überrascht | happy | surprised, kein Gesicht | ja |
| surprised-038 | überrascht | surprised | surprised | ja |
| disgusted-003 | angewidert | thoughtful | disgusted | ja |
| disgusted-020 | angewidert | kein Gesicht, neutral | happy, disgusted | ja |
| afraid-011 | ängstlich | thoughtful | afraid | ja |
| afraid-012 | ängstlich | surprised | afraid | ja |
| afraid-017 | ängstlich | sad | surprised | nein |
| happy-003 / 006 / 011 | froh | happy ×3 | happy ×3 | ja ×3 |
| neutral-013 | neutral | neutral | neutral | ja |
| neutral-017 | neutral | thoughtful | neutral | ja |
| neutral-032 | neutral | neutral | happy | nein |

## „Frustriert“: ausdrücklich keine Modellklasse

Kein verfügbares Ausdrucksmodell gibt „frustriert“ aus: weder HSEmotion (AffectNet, 8 Klassen) noch FER/FER+ (7–8 Klassen) noch die übrigen gängigen Datensätze, die auf den Basisemotionen nach Ekman beruhen. Die alte App hatte die Klasse auch nicht. Deshalb gibt es keinen gelabelten Datensatz, an dem sich eine solche Klasse prüfen ließe. Ich habe sie **nicht** heimlich auf eine andere Klasse gemappt. Die drei „frustriert“-Bilder erscheinen ehrlich als traurig, froh oder neutral (0/3).

Vorschlag, falls „frustriert“ gebraucht wird:

1. Statt einer Kategorie die Ausgaben **Valenz und Arousal** des gewählten `va_mtl`-Modells (zwei Zusatzausgaben, die die App derzeit verwirft) als „negativ / angespannt“-Anzeige zeigen und klar so benennen.
2. Für eine echte Klasse eigene Daten mit Labels sammeln und das Modell nachtrainieren (Fine-Tuning).

Beides ist nicht umgesetzt. Valenz und Arousal sind auf keinem meiner Testsets gegen Labels geprüft.

## Ursachenbefund: Warum wütend/frustriert kaum erkannt wurden

Geprüft auf FER+ (60 wütende Gesichter, davon 49 mit Blendshapes) und auf den Fixtures:

| Geprüfte Ursache | Befund | Anteil |
|---|---|---|
| **Zu hohe Schwellen** | Die Regel verlangt `browDown > 0,45` und (`frown > 0,1` oder `press > 0,2`). Bei wütenden FER+-Gesichtern ist `browDown` im Median **0,081**. Nur 7/49 liegen über 0,45, und nur 6/49 erfüllen die Mund-Bedingung. Ergebnis: **0/60** wütend | Hauptursache |
| **Klassen-Bias / Reihenfolge** | „froh“ wird zuerst geprüft (`smile > 0,45`). Gefletschte Zähne zählen als Lächeln: 10/49 wütende FER+-Gesichter liegen über 0,45 und werden „froh“. Fixture angry-011: `mouthSmileRight` 0,555 → happy. Außerdem schluckt „nachdenklich“ 16/60 wütende Gesichter | Mitursache |
| **Falscher/zu enger Crop** | 3/23 Fixtures ohne Gesicht im Ausschnitt, 2 davon auf dem ganzen Bild lesbar (Kopfbereich = obere 40 % schneidet Nahaufnahmen ab). Bei den wütenden Fixtures nicht ursächlich (beide hatten ein Gesicht) | Nebenursache |
| Fehlendes Alignment | Für Blendshapes nicht nötig (der Landmarker richtet intern aus). Für das neue Modell gemessen: +1,4 Punkte | nicht ursächlich (vorher) |
| Falsche Normalisierung | Vorher MediaPipe-intern. Nachher gegen den Quellcode von hsemotion_onnx geprüft | kein Fehler |
| Fehlerhaftes Index→Label-Mapping | Vorher namensbasiert, nachher geprüft (siehe Tabelle oben) | kein Fehler |
| „frustriert“ | existiert in keinem Modell, auch nicht in der alten App | strukturell (siehe oben) |

Die Wurzel liegt darin, dass Blendshapes Mimik-Bewegungen messen, aber keine Emotionen, und dass die Schwellen geschätzt statt an Daten eingestellt waren. Die Blendshape-Werte für zusammengezogene Brauen sind auf echten wütenden Gesichtern viel kleiner als angenommen.

## Restgrenzen: Was Emotionserkennung aus Gesichtern leisten kann und was nicht

- **Ein Gesichtsausdruck ist kein Gefühl.** Das Modell schätzt, wie ein Gesicht *aussieht*, nicht, was ein Mensch *fühlt*. Menschen lächeln, wenn sie verlegen sind, und schauen neutral, wenn sie wütend sind. Die Fachliteratur (z. B. Barrett et al. 2019, „Emotional Expressions Reconsidered“, *Psychological Science in the Public Interest*) zeigt, dass Gesichtsausdrücke Emotionen nur schwach und kultur- wie kontextabhängig verraten. Die App sagt das jetzt im Hinweistext.
- **Gemessene Trefferquote rund zwei Drittel:** 63,3 % auf FER+ (7 Klassen), 17/23 auf den Referenzbildern. Ein Drittel der Ergebnisse ist also falsch.
- **Typische Verwechslungen** (FER+, Klassifikator auf ganzem Bild): überrascht → ängstlich 19/60, neutral → wütend 13/60, neutral → traurig 12/60, wütend → angewidert 14/60. Neutral ist mit 23/60 am schwächsten. Die App zeigt bei ruhigen Gesichtern also oft eine negative Emotion.
- **Gestellte statt echter Gefühle:** Viele Testbilder (auch FER+) zeigen gestellte, übertriebene Ausdrücke. Bei echter, subtiler Mimik in Alltagsvideos ist mit schlechteren Werten zu rechnen. Das ist nicht gemessen, weil keine gelabelten Alltagsvideos vorliegen.
- **Gesichtsgröße und Blickwinkel:** Der Gesichtsdetektor (BlazeFace, Nahbereich) findet kleine und weit entfernte sowie stark gedrehte Gesichter oft nicht („kein Gesicht“). Pro Bild werden höchstens 12 Personen ausgewertet.
- **Kleine Stichprobe und eigene Labels:** Die Referenzbilder sind wenige und von mir gelabelt. Das sagt etwas über Fortschritt aus, aber nicht über die allgemeine Genauigkeit. Die belastbarere Zahl ist FER+.
- **Kein Einsatz für Entscheidungen über Personen.** Wegen der obigen Grenzen taugt das Verfahren nur als grobe, spielerische Visualisierung, nicht für Bewertungen von Menschen (Bewerbung, Schule, Sicherheit).

## Code-Änderungen

- `src/faces.ts` neu geschrieben, mit Klassifikator, Ausrichtung, Fallback-Ausschnitten, Mittelung und „Unklar“.
- `src/ort.ts` ist eine gemeinsame ONNX-Laufzeit mit dem Objektdetektor.
- `src/main.ts` wartet jetzt auf die asynchrone Gesichtsstufe und zeigt die neue Klassenliste.
- `src/strings.ts` hat 4 neue Labels (angewidert, ängstlich, Verachtung, Unklar), „nachdenklich“ ist entfernt, und Hinweistexte sind angepasst.
- `public/models/enet_b0_8_va_mtl.onnx` ist neu. Die alte Regel steht unverändert in `eval/legacyRule.ts` zum Vergleich.
