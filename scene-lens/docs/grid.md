# Grid-Vertrag (Scene Lens)

Ein Grid für alle Bildschirme (Start, Analyse, Treemap-Modal). Die einzige Quelle ist der Token-Block am Anfang von `src/style.css` (`:root` und die beiden Breakpoint-Überschreibungen). Komponenten verwenden ausschließlich `var(--…)` und Spaltenspannen. Feste px-Werte für Abstände, Schriftgrößen oder Spalten kommen außerhalb dieses Blocks nicht vor. Prüfbefehl siehe unten.

## Entscheidung

Swiss Style heißt hier: ein modulares Spaltenraster mit festen Rändern, eine linke Satzkante für alle Bildschirme, ein 8-px-Grundlinienraster und wenige feste Schriftstufen statt fließender `clamp()`-Größen. Die Spaltenzahlen 12 / 8 / 4 teilen sich ohne Rest durch 4. Dadurch funktionieren die zwei Grundmodule der App, Bühne + Seitenleiste (8 + 4) und die Ergebnisblöcke (je 4), an allen Breiten ohne Sonderfälle.

## Spalten, Gutter, Ränder

| Breite | Spalten `--cols` | Gutter `--gutter` | Außenrand `--margin` | Kopfzeile `--header-h` |
|---|---|---|---|---|
| ≥ 1024 px (Desktop) | 12 | 24 px | 48 px | 64 px (1 Zeile) |
| 600–1023 px (Tablet) | 8 | 24 px | 32 px | 64 px (1 Zeile) |
| < 600 px (Telefon) | 4 | 16 px | 16 px | 96 px (2 Zeilen à 48) |

Das Raster ist die Klasse `.grid`: `grid-template-columns: repeat(var(--cols), minmax(0, 1fr)); column-gap: var(--gutter); padding-inline: var(--margin)`. Verschachtelte Bereiche (`.steps`, Ergebnisblöcke, Vergleichszeilen) übernehmen die Spalten per `subgrid` und definieren keine eigenen. Die Breakpoints 600 und 1024 sind die einzigen Media-Query-Werte (`max-width: 1023px`, `max-width: 599px`). Custom Properties sind in Media Queries nicht erlaubt, deshalb stehen die Zahlen dort direkt.

## Abstandsskala (Grundeinheit `--u` = 8 px)

| Token | Wert | Einheiten |
|---|---|---|
| `--s-half` | 4 px | ½ (nur innerhalb von Bedienelementen) |
| `--s-1` | 8 px | 1 |
| `--s-2` | 16 px | 2 |
| `--s-3` | 24 px | 3 |
| `--s-4` | 32 px | 4 |
| `--s-6` | 48 px | 6 |
| `--s-8` | 64 px | 8 |
| `--s-12` | 96 px | 12 |
| `--s-16` | 128 px | 16 |

Dazu Linien `--hair` 1 px und `--rule` 2 px, Radien `--radius` 16 px, `--radius-s` 8 px, `--pill`, Bedienhöhen `--control-h` 40 px (5u) und `--control-h-l` 56 px (7u). Vorher gab es 29 verschiedene Abstandswerte.

## Typografie-Skala (feste Stufen, Zeilenhöhe immer ein Vielfaches von 8 px)

| Stufe | Desktop | Tablet | Telefon | Verwendung |
|---|---|---|---|---|
| `xs` | 12/16 | 12/16 | 12/16 | Notizen, Tabellenköpfe, Status, Sprachumschalter, Schrittnummern |
| `s` | 14/24 | 14/24 | 14/24 | Bedienelemente, Hinweise, Vergleichszeilen |
| `m` | 16/24 | 16/24 | 16/24 | Fließtext (Body) |
| `l` | 20/32 | 20/32 | 20/32 | Lead, Markenname, h3, Treemap-Zellen |
| `xl` | 28/40 | 28/40 | 20/32 | h2, Kernaussage, Szenenvorschlag |
| `2xl` | 40/48 | 40/48 | 28/40 | Modal-Titel |
| `3xl` | 64/64 | 40/48 | 40/48 | Abschnittstitel „Warum“ |
| `display` | 160/144 | 96/96 | 64/64 | Hero-Titel |

Vorher gab es 15 feste Größen und 3 `clamp()`-Ausdrücke.

## Baseline-Rhythmus

Alle Zeilenhöhen, vertikalen Innen- und Außenabstände sowie Bedienhöhen sind Vielfache von 8 px. Wo eine 1-px-Linie dazukommt, wird sie abgezogen (z. B. Zählliste `padding-block: var(--s-1) calc(var(--s-1) - var(--hair))`, Sprachumschalter `calc(var(--s-half) - var(--hair))`). So bleibt die Gesamthöhe auf dem Raster.

## Platzierung je Bildschirm (Spalten Desktop / Tablet / Telefon)

| Bereich | Desktop (12) | Tablet (8) | Telefon (4) |
|---|---|---|---|
| Kopfzeile: Marke | 1–3 | 1–2 | Zeile 1: 1–2 |
| Kopfzeile: Zurück | 4–5 | 3 | Zeile 2: 1 |
| Kopfzeile: Status (rechtsbündig) | 6–10 | 4–6 | Zeile 2: 2–4 |
| Kopfzeile: Sprache (rechtsbündig) | 11–12 | 7–8 | Zeile 1: 3–4 |
| Hero-Titel / Buttons | 1–12 | 1–8 | 1–4 |
| Lead, Kleingedrucktes | 1–6 | 1–6 | 1–4 |
| „Warum“-Titel, Kernaussage | 1–8 | 1–8 | 1–4 |
| vier Schritte | je 3 | je 4 (2 × 2) | je 4 (untereinander) |
| Bühne | 1–8 | 1–8 | 1–4 |
| Seitenleiste (Einstellungen, Zählung) | 9–12, Höhe = Bühne | 1–8, darunter | 1–4, darunter |
| Ergebnisblöcke (Personen, Vorschlag, Vergleich) | je 4 | je 4 | je 4 (untereinander) |
| Vergleichszeile: Name / Balken / Zahl | 1 / 2 / 1 Spalte des Blocks | dito | dito |
| Treemap-Panel | Ränder = `--margin`, oben `--header-h + --gutter`, unten `--gutter` | dito | dito |

## Kopfzeile

Es gibt eine einzige `<header class="site-header">` vor beiden Bildschirmen, sticky, mit Höhe `--header-h`. „Zurück“ und Status gehören zur Analyse. Auf dem Start-Bildschirm sind sie über `body[data-screen="home"]` per `visibility: hidden` ausgeblendet, behalten aber ihren Platz. Höhe, vertikale Position, Abstände und Ausrichtung sind dadurch auf jedem Bildschirm identisch (gemessen mit `eval/scripts/shots.ts`, Datei `header.json`: 64/64/64 px bzw. 96 px auf dem Telefon, Sprachumschalter überall im Abstand `--margin` vom rechten Rand). `main.ts` setzt `data-screen` in `go()`.

## Prüfung

```bash
# keine px/vw/em-Werte außerhalb der Token-Blöcke (Ausgabe muss leer sein)
awk '/^:root \{/{t=1} t&&/^\}/{t=0;next} /^  :root \{/{next} !t' src/style.css | grep -n -E "[0-9]+(px|vw|rem|em)\b" | grep -v -E "letter-spacing|max-width: *(1023|599)px"
# nur eine Spaltendefinition, alles andere subgrid
grep -n "grid-template-columns" src/style.css
# Screenshots + Header-Geometrie bei 375/768/1280/1920
node eval/scripts/shots.ts --label check
```

Ausnahmen, die keine Layout-Werte sind: `letter-spacing` (em), Inline-Breiten und -Positionen, die aus Daten berechnet werden (Balkenlänge im Vergleich, Treemap-Zellen, Canvas-Overlay über dem Bild).
