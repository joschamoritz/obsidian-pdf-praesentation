# PDF-Präsentation

Obsidian-Plugin: PDFs im Vollbild zeigen, per AirPlay vom iPad, mit Pencil-Ink, Marker, Laserpointer und leeren Seiten. Gebaut für den Unterricht, damit Tafelbilder und Folien direkt aus der Notiz heraus laufen, ohne Import in eine andere App.

## Installation

Das Plugin steht nicht im Community-Verzeichnis von Obsidian und wird von Hand installiert:

```bash
npm install
npm run build
npm run install-plugin -- "/Pfad/zum/Vault"
```

Danach in Obsidian unter *Einstellungen → Community-Plugins* einschalten. Mit iCloud oder einem anderen Sync kommt es von dort auch aufs iPad.

## Bedienung

**Starten:** Knopf in der Kopfzeile eines geöffneten PDFs, kleiner Knopf hinter PDF-Links in der Leseansicht, Kontextmenü im Dateibaum, Befehl „PDF auswählen und präsentieren“ oder `obsidian://pdf-praesentieren?file=Pfad.pdf&page=3`.

| Eingabe | Wirkung |
|---|---|
| Pencil | zeichnet mit dem gewählten Werkzeug |
| Wischen, Antippen am linken oder rechten Rand | blättern |
| Antippen in der Mitte, Griff unten | Werkzeugleiste ein und aus |
| zwei Finger | zoomen und verschieben |
| ein Finger im Zoom | verschieben, Doppeltipp setzt den Zoom zurück |
| Pfeiltasten, Bild auf/ab, Leertaste, Pos1, Ende | blättern, auch mit Presenter |
| Strg + Mausrad, Zoomgeste auf dem Trackpad | zoomen an der Stelle des Mauszeigers |
| Mausrad oder zwei Finger auf dem Trackpad im Zoom | verschieben |
| `+`, `-`, `0` | hinein, heraus, zurück auf die ganze Seite |
| Esc | beenden |

**Werkzeuge:** Laserpointer, Stift, Marker, Formen, Radierer. Der erste Tipp wählt ein Werkzeug, der zweite Tipp oder der Regler-Knopf öffnet seine Einstellungen.

| Werkzeug | Einstellungen |
|---|---|
| Stift | Kugelschreiber, Füller, Fineliner, Pinsel · Strichstärke · 12 Farben und eigene |
| Marker | freihand oder gerade · Strichstärke · 8 Farben und eigene |
| Formen | Linie, Pfeil, Rechteck, Ellipse · Strichstärke und Farbe des Stifts |
| Radierer | ganzer Strich oder nur die Stelle · Größe |

Die vier Farben in der Leiste sind Schnellfarben: Eine neu gewählte Farbe ersetzt die letzte.

Die Hand-Taste in der Leiste schaltet auf Zeichnen mit dem Finger um. Geblättert wird dann über die Leiste, gezoomt weiter mit zwei Fingern.

Die Stecknadel fixiert die Leiste: Sie bleibt stehen, und die Seite rückt so weit, dass die Leiste nichts verdeckt. Die Einstellung gilt je Gerät.

Die Werkzeugwahl liegt je Gerät im localStorage.

## Tinte

Tinte, leere Seiten und die zuletzt gezeigte Seite werden automatisch gespeichert: zwei Sekunden nach dem letzten Strich, beim Beenden und wenn die App in den Hintergrund geht. Das PDF selbst bleibt immer unverändert. „Alle Tinte löschen“ in der Seitenübersicht macht ein PDF wieder sauber für die nächste Lerngruppe und entfernt auch eingefügte leere Seiten.

Die Dateien liegen in `.obsidian/plugins/pdf-praesentation/tinte/` und heißen `<Pfad-Hash>.<Inhalts-Hash>.json`. Sie reisen per iCloud mit, tauchen aber nicht zwischen dem Material auf. Wer das Plugin deinstalliert, löscht auch die Tinte.

| Fall | Verhalten |
|---|---|
| PDF verschoben oder umbenannt, auch außerhalb von Obsidian | Die Tinte findet sich über den Inhalts-Hash wieder |
| inhaltsgleiche Kopie, das Original liegt noch dort | Die Kopie startet ohne Tinte |
| PDF neu erzeugt | Die Tinte bleibt, mit Hinweis, dass sie verrutscht sein kann |
| PDF hat weniger Seiten als vorher | Tinte auf den fehlenden Seiten fällt weg, mit Hinweis |
| Datei gerade nicht lesbar (etwa noch nicht aus iCloud geladen) | Hinweis, und es wird nichts gespeichert, damit nichts überschrieben wird |
| Datei beschädigt | wird zu `*.defekt` umbenannt, es geht ohne Tinte weiter |
| Schreiben schlägt fehl | Hinweis, die Tinte bleibt bis zum Beenden von Obsidian im Speicher |

Keine Temp-Datei mit Umbenennen und kein Löschen nach dem Leeren: iCloud erzeugt beim Umbenennen Konfliktkopien und stellt Dateien wieder her, die kurz nach dem Schreiben gelöscht werden. Deshalb wird in die Datei selbst geschrieben, und eine geleerte Datei bleibt als leere Datei stehen.

## Wie gezeichnet wird

Striche bleiben Daten, keine Pixel. Stiftstriche werden als ein einziger Umriss gefüllt (`perfect-freehand`, MIT), Marker und Formen als ein einziger Pfad. Die Ebenen für Tinte liegen über der Bühne und werden für den sichtbaren Ausschnitt in Gerätepixeln neu gezeichnet, deshalb bleibt die Tinte bei jedem Zoom scharf und braucht immer gleich viel Speicher. Das PDF liegt als ganze Seite in Bildschirmauflösung darunter. Im Zoom kommt nach der Geste ein scharfer Ausschnitt dazu. Seitengröße und Lage sitzen auf ganzen Gerätepixeln.

## Stiftdaten auf dem iPad

`getCoalescedEvents()` liefert auf dem iPad alle Positionen seit dem letzten Bild, nicht seit dem letzten Ereignis. Die Listen überlappen sich, und ungefiltert läuft der Strich ständig rückwärts (bei 270 echten Strichen 38,5 % aller Schritte), was Lücken und zackige Kanten ergibt. Außerdem kommen die Positionen auf ganzen Gerätepixeln an. Darum:

- `samples.ts` lässt jeden Punkt nur einmal durch, nach Zeit und Position.
- `appendPoint` ignoriert kleine Schritte zurück.
- `smoothedPoints` nimmt beim Zeichnen die Pixelstufen, die gespeicherten Punkte bleiben unverändert.
- Dateien der Version 1 werden beim Laden mit `cleanStroke` aufgeräumt.

Am PC zeigt sich das nicht. `dev/vergleich.html` zeichnet echte iPad-Punkte aus `dev/fixtures/ink-ipad.json` so nach, wie sie auf dem Gerät erscheinen.

## Entwicklung

Der Code liegt bewusst außerhalb des iCloud-Vaults, in den Vault kommen nur `main.js`, `manifest.json` und `styles.css`.

```bash
npm install
npm test
npm run check
npm run build
npm run install-plugin -- "/Pfad/zum/Vault"
```

Mit `npm run dev` startet die Testseite ohne Obsidian auf http://localhost:5199. Sie braucht eigene PDFs unter `dev/fixtures/` (`folien.pdf`, `blaetter.pdf`) und für die Vergleichsseite eine Tintendatei als `ink-ipad.json`. Der Ordner wird nicht eingecheckt, weil dort Unterrichtsmaterial liegt.

`src/presenter/` kennt Obsidian nicht und läuft deshalb auch auf der Testseite. `src/main.ts` verbindet es mit Obsidian.

pdf.js rendert über `requestAnimationFrame`. In einem verdeckten Fenster bleibt das Rendern deshalb stehen und läuft erst weiter, wenn das Fenster sichtbar wird.

Obsidian setzt auf dem iPad `.is-tablet button:not(.clickable-icon) { padding: 4px 20px }`. Die Testseite stellt diese Regel nach, damit Knöpfe dort genauso aussehen wie auf dem Gerät. Eigene Knöpfe brauchen deshalb `padding` mit `!important`.

## Stand

Schreiben, Handballen, Wischen, Speichern und scharfe Tinte laufen im Alltag auf dem iPad. Der Farbwähler des Systems und das Verhalten ohne Sync sind weniger erprobt. AirPlay zeigt dasselbe Bild wie das iPad, eine getrennte Referentenansicht gibt es dort nicht.

## Lizenz

MIT, siehe [LICENSE](LICENSE). Enthält [perfect-freehand](https://github.com/steveruizok/perfect-freehand) (MIT) und Symbole von [Lucide](https://lucide.dev) (ISC). PDF-Rendering kommt von dem pdf.js, das Obsidian mitbringt.
