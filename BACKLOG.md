# Backlog

Ideen und offene Prüfungen für das Plugin. Stand: 12.11.2026 (v0.13.1, auch auf GitHub).
Rückmeldungen vom iPad haben Vorrang vor neuen Funktionen.

## Als Nächstes

Alles bis v0.13.1 ist am iPad geprüft. Offen ist der Browser-Empfänger (unten), neue Wünsche kommen unter „Weitere Ideen“.

## Zweiter Bildschirm: Browser-Empfänger

**Nächster Schritt:** Verbindungstest am Board mit Chrome statt dem eingebauten Browser wiederholen (`unterricht.signifikation.de/verbindungstest`). Danach entscheiden.

**Bisheriger Test (09.11.2026, eingebauter Browser des Boards):** iPad mit Dauerverbindung, Board nur über den Ersatzweg. Hin und zurück üblich 76 ms (iPad) und 159 ms (Board), 95 % unter 248 bzw. 346 ms, nichts verloren, keine Abbrüche. Datenprobe 8 MB in 6,4 s. Direkter Weg zwischen den Geräten kommt nicht zustande. Dem Board-Browser fehlt `Promise.withResolvers`. Eindruck: Tinte deutlich verzögert, für Folien ausreichend.

**Folgerungen für einen späteren Bau:**
- Das iPad rendert die Seiten als Bild in Board-Auflösung und schickt diese, kein PDF ans Board.
- Tinte live geht, mit Dauerverbindung deutlich schneller.
- Der Server muss den Ursprung von Obsidian zulassen (`ALLOWED_ORIGINS` im Repo `unterricht.signifikation`).
- AirPlay bleibt immer der Rückweg.

**Entscheidung offen:** Lohnt der Aufwand für randlose Folien und eine Ansicht nur für die Lehrkraft?

## Weitere Ideen
Zurzeit keine offenen. Neue Wünsche hier eintragen.

## Noch zu prüfen
- **Zoom-Einstellung am Board:** Nimmt sie die seitlichen Balken der AirPlay-Spiegelung weg?
- **Druck beim Schreiben:** Reagieren Füller und Pinsel passend auf den Druck des Pencils?
- **Sicheres Speichern im Ernstfall:** Konfliktkopien von iCloud und Umbenennen eines PDFs in Obsidian sind nur in Tests geprüft, nicht am echten Fall.

## Erledigt
| Version | Inhalt | iPad |
|---|---|---|
| v0.11.0 | Glättung der Schrift (Aus · Leicht · Stark) | geprüft 12.11.2026 |
| v0.12.0 | Timer mit Farbe, Effekt und Ton · Lasso · Zeichnen und halten · Stiftablage · „Leere Seite einfügen“ im Mehr-Feld | geprüft 12.11.2026 |
| v0.12.1 | Timer: Pink, Orange, eigene Farbe | geprüft 12.11.2026 |
| v0.13.0 | Laser als Spur mit Halten · Dreieck und Pfeil · Lasso umfärben und vergrößern · Nach der Stunde | geprüft 12.11.2026, Laser zu dick |
| v0.13.1 | Laserbreite wie früher, Stärke wählbar | geprüft 12.11.2026 |

Außerdem: Die Testseite benennt eingebaute Android-Browser richtig (12.11.2026). Das lebendige Wochen-Dashboard ist ein eigenes Plugin aus einer eigenen Sitzung.

## Bewusst nicht
- Abstimmungen über Schüler-iPads, Zufallsauswahl mit Namen, Fotos von Schülerarbeiten: Das bräuchte einen Server, oder Schülerdaten würden per iCloud mitreisen.
- Eigenes Backup der Tinte: Wichtige Seiten werden über „Als PDF sichern“ gesichert.
- Eigene iPad-App: Die Arbeit soll in Obsidian bleiben.
