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

**Starten:** Knopf in der Kopfzeile eines geöffneten PDFs, kleiner Knopf hinter PDF-Links und PDF-Pfaden in Backticks in der Leseansicht, Kontextmenü im Dateibaum, Befehl „PDF auswählen und präsentieren“ oder `obsidian://pdf-praesentieren?file=Pfad.pdf&page=3`.

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
| Stift | Kugelschreiber, Füller, Fineliner, Pinsel · Glättung aus, leicht oder stark · Strichstärke · 12 Farben und eigene |
| Marker | freihand oder gerade · Strichstärke · 8 Farben und eigene |
| Formen | Linie, Pfeil, Rechteck, Ellipse · Strichstärke und Farbe des Stifts |
| Radierer | ganzer Strich oder nur die Stelle · Größe |
| Lasso | Tinte umkreisen, dann mit dem Stift verschieben, kopieren oder löschen. Die kleine Leiste über der Auswahl hat Kopieren, Löschen und Aufheben |

**Stiftablage:** Beim Stift stehen in der Leiste vier Fächer. Jedes Fach merkt sich Farbe, Stiftart, Strichstärke und Glättung, ein Tipp nimmt den ganzen Stift. Je dicker der Stift, desto größer der Punkt. Im Einstellungsfeld legt „Aktuellen Stift in Fach n ablegen“ den eingestellten Stift in das zuletzt gewählte Fach. Bei Marker und Formen sind es weiter vier Schnellfarben: Eine neu gewählte Farbe ersetzt die letzte.

**Zeichnen und halten:** Bleibt der Stift am Ende eines Strichs kurz stehen, wird aus dem Strich eine gerade Linie, ein Rechteck oder eine Ellipse. Bei der Linie folgt das Ende dem Stift, bis er abgesetzt wird. Schrift und kleine Buchstaben bleiben, wie sie sind. Abschaltbar bei Stift und Marker.

Die Hand-Taste in der Leiste schaltet auf Zeichnen mit dem Finger um. Geblättert wird dann über die Leiste, gezoomt weiter mit zwei Fingern.

**Seiten sperren:** In der Seitenübersicht sperrt das Schloss eine Seite, etwa eine Lösung im selben PDF. Blättern überspringt sie, die Übersicht zeigt kein Vorschaubild und die Seitenzahl unten zählt sie nicht mit. Gezeigt werden kann sie erst nach dem Freigeben. Die Sperre wird mit der Tinte gespeichert und bleibt auch nach „Alle Tinte löschen“ stehen.

**Abdecken:** Mit dem Werkzeug „Abdecken“ zieht der Stift Flächen über die Folie, ein Stifttipp entfernt sie. Sie werden gespeichert. In der Stunde zieht der Finger sie weg wie ein Blatt auf dem Overheadprojektor, oder ein Tipp deckt sie ganz auf. Beim nächsten Öffnen liegt wieder alles drauf.

**Zeiger:** Laserpunkt oder Schlüsselloch: Alles ist dunkel außer einem Sichtfenster, das Stift oder Finger verschiebt. Der zweite Tipp auf das Zeiger-Symbol wählt und stellt die Größe ein.

**Mehr:** Das Feld mit den drei Punkten enthält:
- **Leere Seite einfügen** hinter der aktuellen Seite.
- **Tintenstand:** eigene Tinte je Lerngruppe. Ein Tintenstand ist eine eigene Datei, „Alle Tinte löschen“ trifft nur den aktuellen. Beim Start aus einem Entwurf mit mehreren Kursen stehen die Kurse schon zur Wahl.
- **Stundenmappe:** Beim Start aus einem Entwurf die PDFs aus der Zeile „Digital“, ohne Lehrerhand und Lösungen. Der Wechsel verlässt das Vollbild nicht, der Timer läuft weiter.
- **Planzeit:** eine Zeile mit Minute, Phase und Planende aus dem Verlaufsplan. Nur das, weil die Klasse mitliest.
- **Tafel neu entstehen lassen:** Die Striche der Seite erscheinen in wenigen Sekunden neu, ein Tipp hält an.
- **Zeile hervorheben:** Bei PDFs mit Zeilenzählung im Text ein Band über Zeile n.
- **Als PDF mit Tinte sichern:** neben dem Original, ohne gesperrte Seiten.

In der Seitenübersicht zeigt „Nur beschriebene“ den Ertrag der Stunde. Der Befehl „Verweildauer der letzten Präsentation einfügen“ schreibt eine Zeile für die Reflexion an den Cursor. Der Timer zählt nach dem Ablauf klein weiter.

**Timer:** Das Uhr-Symbol öffnet die Einstellung für Dauer und Größe (klein bis riesig). Die Anzeige liegt über der Folie, lässt sich mit dem Finger verschieben, ein Tipp hält sie an. In der letzten Minute wird sie orange, am Ende rot. Farbe der Anzeige, Effekt bei null (Blinken, Pulsieren, Aufleuchten der ganzen Fläche oder nichts) und ein Ton (Gong, Glocke, Dreiklang, Piepton oder aus) sind wählbar, „Ende vorführen“ zeigt beides zur Probe. Der Ton kommt über AirPlay aus den Lautsprechern am Board. Das iPad gibt Ton erst nach einer Berührung frei, das übernimmt der Start des Timers. „+ 1 Min.“ geht auch, während sie läuft.

**Rand:** Unter „Mehr“ steht die Fläche um die Folie auf ihrer Randfarbe oder auf Schwarz. Die Balken links und rechts am Board kommen von der Spiegelung und lassen sich aus dem Plugin nicht ändern.

Die Stecknadel fixiert die Leiste: Sie bleibt stehen, und die Seite rückt so weit, dass die Leiste nichts verdeckt. Die Einstellung gilt je Gerät.

Die Werkzeugwahl liegt je Gerät im localStorage.

## Tinte

Tinte, leere Seiten und Sperren werden automatisch gespeichert: zwei Sekunden nach dem letzten Strich, spätestens nach 20 Sekunden, beim Beenden und wenn die App in den Hintergrund geht. Das PDF selbst bleibt immer unverändert. Die zuletzt gezeigte Seite merkt sich jedes Gerät selbst. „Alle Tinte löschen“ in der Seitenübersicht macht ein PDF wieder sauber für die nächste Lerngruppe und entfernt auch eingefügte leere Seiten.

Die Dateien liegen in `.obsidian/plugins/pdf-praesentation/tinte/` und heißen `<Pfad-Hash>.<Inhalts-Hash>.json`. Sie reisen per iCloud mit, tauchen aber nicht zwischen dem Material auf. Wer das Plugin deinstalliert, löscht auch die Tinte.

Grundsatz: Tinte wird nie überschrieben, ohne dass ihr Stand bekannt ist.

| Fall | Verhalten |
|---|---|
| Datei wurde seit dem Laden von einem anderen Gerät geändert | Sie wird nicht überschrieben. Die eigene Fassung geht in eine Nebendatei, beim nächsten Öffnen wird beides zusammengeführt |
| iCloud-Konfliktkopie (`abc.def 2.json`) | wird beim Öffnen zusammengeführt und danach beiseitegelegt (`.uebernommen-…`) |
| Zusammenführen | Es kommt nur dazu, nichts geht weg. Ein gelöschter Strich kann deshalb wieder auftauchen |
| PDF in Obsidian verschoben oder umbenannt | Die Tinte zieht sofort mit um |
| PDF außerhalb von Obsidian verschoben | Die Tinte findet sich über den Inhalts-Hash wieder. Bei mehreren Kandidaten gewinnt der ähnlichste Pfad, bei Gleichstand startet das PDF leer, und die anderen bleiben unberührt |
| Inhaltsgleiche Kopie, das Original liegt noch dort | Die Kopie startet ohne Tinte |
| PDF neu erzeugt | Die Tinte bleibt, mit dem Hinweis, dass sie verrutscht sein kann |
| PDF hat weniger Seiten als vorher | Die Tinte der fehlenden Seiten reist unsichtbar mit und kommt zurück, wenn die Seiten wieder da sind |
| Datei gerade nicht lesbar, auch iCloud-Platzhalter | Hinweis, und es wird nichts gespeichert, damit nichts überschrieben wird. Tinte aus der Sitzung bleibt bis zum Beenden von Obsidian im Speicher |
| Datei beschädigt | wird zu `.defekt-…` umbenannt. Geladen wird die Sicherung vom Beginn der letzten Sitzung (`.sicherung`) |
| Schreiben schlägt fehl | Hinweis, die Tinte bleibt bis zum Beenden von Obsidian im Speicher und wird beim nächsten Öffnen nachgeschrieben |
| Beschriebene leere Seite entfernen | braucht zwei Tipps |

Keine Temp-Datei mit Umbenennen und kein Löschen nach dem Leeren: iCloud erzeugt beim Umbenennen Konfliktkopien und stellt Dateien wieder her, die kurz nach dem Schreiben gelöscht werden. Deshalb wird in die Datei selbst geschrieben, und eine geleerte Datei bleibt als leere Datei stehen.

**Grenze:** Wird ein PDF außerhalb von Obsidian umbenannt und entsteht ein neues unter dem alten Namen, wandert die Tinte zum neuen PDF, mit dem Hinweis auf die Änderung. Das Plugin sieht nicht, dass das alte PDF jetzt woanders liegt.

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

MIT, siehe [LICENSE](LICENSE). Enthält [perfect-freehand](https://github.com/steveruizok/perfect-freehand) (MIT), [pdf-lib](https://github.com/Hopding/pdf-lib) (MIT) und Symbole von [Lucide](https://lucide.dev) (ISC). PDF-Rendering kommt von dem pdf.js, das Obsidian mitbringt.
