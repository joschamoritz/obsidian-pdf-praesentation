// iPadOS liefert in getCoalescedEvents() alle Stiftpositionen seit dem letzten Bild, nicht
// seit dem letzten Ereignis. Kommen in einem Bild mehrere Ereignisse an, überlappen sich die
// Listen. Ungefiltert läuft der Strich immer wieder ein Stück rückwärts: Das waren bei echten
// Strichen 38 % aller Schritte, und daraus entstanden Lücken und zackige Kanten.

export interface PenSample {
  clientX: number;
  clientY: number;
  timeStamp: number;
}

/** So viele zuletzt angenommene Positionen werden auf Wiederholung geprüft. */
const RECENT_POSITIONS = 16;

export class SampleFilter<S extends PenSample> {
  private lastTime = -Infinity;
  private recent: string[] = [];

  private remember(sample: S): void {
    this.recent.push(`${sample.clientX}|${sample.clientY}`);
    if (this.recent.length > RECENT_POSITIONS) this.recent.shift();
  }

  /** Der Aufsetzpunkt zählt als schon gesehen, damit er nicht gleich noch einmal angehängt wird. */
  start(sample: S): void {
    this.lastTime = -Infinity;
    this.recent = [];
    this.remember(sample);
  }

  /** Gibt nur die Punkte zurück, die noch nicht verarbeitet wurden. */
  fresh(batch: readonly S[], event: S): S[] {
    if (batch.length === 0) return this.isRepeated(event) ? [] : this.accept([event]);
    // Tragen alle Punkte dieselbe Zeit, taugt sie nicht zum Vergleichen. Dann bleibt die Position.
    const times = new Set(batch.map((sample) => sample.timeStamp));
    const timesUsable = batch.length === 1 || times.size > 1;
    const fresh = batch.filter((sample) => {
      if (timesUsable && sample.timeStamp <= this.lastTime) return false;
      return !this.isRepeated(sample);
    });
    if (timesUsable) this.lastTime = Math.max(this.lastTime, ...times);
    return this.accept(fresh);
  }

  private isRepeated(sample: S): boolean {
    return this.recent.includes(`${sample.clientX}|${sample.clientY}`);
  }

  private accept(samples: S[]): S[] {
    samples.forEach((sample) => this.remember(sample));
    return samples;
  }
}
