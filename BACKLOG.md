# Backlog

Ideen und offene Prüfungen für das Plugin. Stand: 12.11.2026 (v0.12.1, lokal; auf GitHub liegt v0.10.0).
Rückmeldungen vom iPad haben Vorrang vor neuen Funktionen.

## Als Nächstes: iPad-Test von v0.11 bis v0.12.1

Erst danach kommen neue Funktionen und der Upload auf GitHub.

| Funktion | Seit | Worauf achten |
|---|---|---|
| **Glättung** Aus · Leicht · Stark, voreingestellt Leicht | v0.11.0 | Kommt die Schrift an GoodNotes heran? Ist Leicht zu schwach, Stark zu rund? Mit Schreib- und Druckschrift ausprobieren. Gespeichert werden die Rohpunkte, die Stärken lassen sich also nachjustieren, ohne alte Tinte zu verändern |
| **Timer:** Farbe aus acht Farben (mit Pink) oder eigene, Effekt bei null, Ton | v0.12.0 / v0.12.1 | Kommt der Ton über AirPlay am Board an? Auch bei eingeschaltetem Stummschalter? Laut genug? Öffnet das „+“ den Farbwähler des iPads? |
| **Zeichnen und halten:** Linie, Rechteck, Ellipse nach 0,55 s Stillstand | v0.12.0 | Löst es beim Schreiben ungewollt aus, etwa bei einer Denkpause mit aufgesetztem Stift? Dann Wartezeit verlängern oder Mindestgröße erhöhen |
| **Lasso:** umkreisen, verschieben, kopieren, löschen | v0.12.0 | Fängt es Schrift sauber ein? Ruckelt das Verschieben auf vollen Tafelbildern? |
| **Stiftablage:** vier Fächer statt Schnellfarben beim Stift | v0.12.0 | Ist das Ablegen verständlich? Reichen vier Fächer? |
| **Leere Seite einfügen** liegt jetzt im Mehr-Feld | v0.12.0 | Fehlt der Knopf in der Leiste? Er musste weichen, damit die Leiste quer in eine Zeile passt |

## Zweiter Bildschirm: Browser-Empfänger

**Nächster Schritt:** Verbindungstest am Board mit einem anderen Browser wiederholen, am besten Chrome. Die Testseite benennt eingebaute Android-Browser seit dem 12.11.2026 richtig. Danach entscheiden.

**Verbindungstest in der Schule (09.11.2026, 1:44 min, eingebauter Browser des Boards):**

| | iPad (Safari 27, iPadOS) | Board (Android, eingebauter Browser) |
|---|---|---|
| Verbindung | Dauerverbindung | nur Ersatzweg (Polling) |
| Bis zum Server | 49 ms | 51 ms |
| Zum anderen Gerät und zurück, üblich | 76 ms | 159 ms |
| … langsamste 5 % | 248 ms | 346 ms |
| Höchstwert | 329 ms | 501 ms |
| Verloren / Abbrüche | 0 / 0 | 0 / 0 |

- Datenprobe 8 MB in 6,4 s (1,2 MB/s). Ein übliches Folien-PDF wäre also in wenigen Sekunden drüben.
- Direkter Weg zwischen den Geräten: kommt nicht zustande. Der Umweg über den Server bleibt.
- Board-Browser: Ihm fehlt `Promise.withResolvers`. Das aktuelle pdf.js läuft dort nicht.
- Auf dem Board gibt es laut Nutzer weitere Browser.

**Eindruck des Nutzers:** deutliche Verzögerung bei der Tinte, aber ausreichend, um Folien zu zeigen.

**Folgerungen:**
- Das Schul-WLAN lässt Dauerverbindungen zu, das iPad hatte eine. Am Board fehlte sie. Vermutlich lag das am alten eingebauten Browser, das zeigt der Test mit Chrome.
- Kein PDF ans Board schicken. Das iPad rendert die Seiten selbst als Bild in Board-Auflösung (1920 × 1080) und schickt diese. Damit ist der Board-Browser fast egal, und es bleibt scharf.
- Tinte live ist möglich, kommt aber spürbar später an, solange das Board nur den Ersatzweg hat.
- Für das Plugin muss der Server den Ursprung von Obsidian zulassen (`ALLOWED_ORIGINS` im Repo `unterricht.signifikation`). Die Testseite lief in Safari, nicht in Obsidian.

**Entscheidung offen:** Lohnt der Aufwand für randlose Folien und eine Ansicht nur für die Lehrkraft? AirPlay bleibt in jedem Fall der Rückweg.

## Weitere Ideen

| Idee | Herkunft | Was sie täte |
|---|---|---|
| Lasso: Farbe oder Größe der Auswahl ändern | GoodNotes | Auswahl umfärben oder vergrößern |
| Zeichnen und halten: Dreieck und Pfeil erkennen | GoodNotes | weitere Formen |
| „Nach der Stunde“ | Plugin-Bewertung 11.11.2026 | Beim Beenden drei kurze Felder für die Reflexion, direkt in den Entwurf geschrieben, mit der Verweildauer der Folien |

## Noch zu prüfen
- **Zoom-Einstellung am Board:** Nimmt sie die seitlichen Balken der AirPlay-Spiegelung weg?
- **Druck beim Schreiben:** Reagieren Füller und Pinsel passend auf den Druck des Pencils?
- **Sicheres Speichern im Ernstfall:** Konfliktkopien von iCloud und Umbenennen eines PDFs in Obsidian sind nur in Tests geprüft, nicht am echten Fall.

## Erledigt
- v0.11.0: Glättung der Schrift
- v0.12.0: Timer mit Farbe, Effekt und Ton · Lasso · Zeichnen und halten · Stiftablage
- v0.12.1: Pink, Orange und eigene Farbe für den Timer; Schrift auf der Timerfarbe nach höherem Kontrast
- 12.11.2026: Testseite benennt eingebaute Android-Browser richtig
- Das lebendige Wochen-Dashboard ist ein eigenes Plugin und läuft in einer eigenen Sitzung, nicht hier

## Bewusst nicht
- Abstimmungen über Schüler-iPads, Zufallsauswahl mit Namen, Fotos von Schülerarbeiten: Das bräuchte einen Server, oder Schülerdaten würden per iCloud mitreisen.
- Eigenes Backup der Tinte: Wichtige Seiten werden über „Als PDF sichern“ gesichert.
- Eigene iPad-App: Die Arbeit soll in Obsidian bleiben.
