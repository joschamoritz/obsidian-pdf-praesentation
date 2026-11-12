# Backlog

Ideen und offene Prüfungen für das Plugin. Stand: 11.11.2026 (v0.10.0).
Rückmeldungen vom iPad haben Vorrang vor neuen Funktionen.

## Als Nächstes

### Schrift glätten wie GoodNotes
**Stand:** in v0.11.0 gebaut (Aus · Leicht · Stark, voreingestellt Leicht), am iPad noch nicht geprüft. Danach die Stärken nachjustieren oder den Punkt streichen.

**Rückmeldung (11.11.2026):** GoodNotes schreibt schöner, weil es zittrige Bewegungen glättet und die Handschrift lesbarer wirkt.

**Befund im Code:** Die Glättung ist bisher bewusst schwach. `perfect-freehand` läuft mit `streamline: 0`, `smoothing: 0.3`, danach folgen zwei leichte Glättungsdurchgänge (`src/presenter/ink.ts`). Ziel war bisher, dass die Spitze ohne Verzögerung am Stift bleibt.

**Idee:**
- Beim Schreiben leicht nachziehen, damit die Spitze am Stift bleibt.
- Nach dem Absetzen den Strich einmal stärker geglättet neu zeichnen. GoodNotes wirkt ähnlich.
- Einstellung je Stift: Aus · Leicht · Stark.
- Gespeichert werden weiter die Rohpunkte. Die Glättung entsteht beim Zeichnen, damit sich alte Tinte nicht verändert und die Stufe später änderbar bleibt.

**Prüfen:** am iPad mit echtem Pencil, mit Schreibschrift und Druckschrift. Am PC ist das nicht zu beurteilen.

## Zweiter Bildschirm: Browser-Empfänger

**Verbindungstest in der Schule (09.11.2026, 1:44 min):**

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
- Die Testseite nennt den Board-Browser „Safari 4“. Das ist ein Erkennungsfehler der Testseite: Android-WebViews tragen `Version/4.0` vor `Chrome/…` in der Kennung. Gemeint ist ein älterer eingebauter Chromium-Browser.

**Eindruck des Nutzers:** deutliche Verzögerung bei der Tinte, aber ausreichend, um Folien zu zeigen.

**Folgerungen:**
- Das Schul-WLAN lässt Dauerverbindungen zu, das iPad hatte eine. Am Board fehlt sie. Ursache ist entweder dessen alter Browser oder dessen Netzanschluss. Prüfen: Gibt es auf dem Board einen anderen Browser, etwa Chrome aus dem Store, oder ein Browser-Update?
- Kein PDF ans Board schicken. Das iPad rendert die Seiten selbst als Bild in Board-Auflösung (1920 × 1080) und schickt diese. Damit ist der alte Browser egal, und es bleibt scharf.
- Tinte live ist möglich, kommt aber spürbar später an, solange das Board nur den Ersatzweg hat.
- Für das Plugin muss der Server den Ursprung von Obsidian zulassen (`ALLOWED_ORIGINS` im Repo `unterricht.signifikation`). Die Testseite lief in Safari, nicht in Obsidian.

**Entscheidung offen:** Lohnt der Aufwand für randlose Folien und eine Ansicht nur für die Lehrkraft? AirPlay bleibt in jedem Fall der Rückweg.

## Weitere Ideen

| Idee | Herkunft | Was sie täte |
|---|---|---|
| Lasso | OwlLuna, GoodNotes | Tinte auswählen und verschieben |
| Zeichnen und halten | OwlLuna, GoodNotes | Stift am Ende stehen lassen, der Strich wird zur geraden Linie oder Form |
| Stiftablage | OwlLuna | feste Stifte, jeder mit eigener Art, Farbe und Stärke |

## Noch zu prüfen
- **Zoom-Einstellung am Board:** Nimmt sie die seitlichen Balken der AirPlay-Spiegelung weg?
- **Druck beim Schreiben:** Reagieren Füller und Pinsel passend auf den Druck des Pencils?
- **Sicheres Speichern im Ernstfall:** Konfliktkopien von iCloud und Umbenennen eines PDFs in Obsidian sind nur in Tests geprüft, nicht am echten Fall.

## Bewusst nicht
- Abstimmungen über Schüler-iPads, Zufallsauswahl mit Namen, Fotos von Schülerarbeiten: Das bräuchte einen Server, oder Schülerdaten würden per iCloud mitreisen.
- Eigenes Backup der Tinte: Wichtige Seiten werden über „Als PDF sichern“ gesichert.
- Eigene iPad-App: Die Arbeit soll in Obsidian bleiben.
