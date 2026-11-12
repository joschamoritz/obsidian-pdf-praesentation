// Tonsignal am Ende des Timers. Die Töne werden erzeugt statt als Datei mitgeliefert: Das Plugin
// bleibt klein, und es gibt keine Rechtefrage. Über AirPlay klingen sie aus den Lautsprechern am Board.

export type TimerSound = 'off' | 'gong' | 'bell' | 'chime' | 'beep';

export const TIMER_SOUNDS: { sound: TimerSound; label: string }[] = [
  { sound: 'off', label: 'Aus' },
  { sound: 'gong', label: 'Gong' },
  { sound: 'bell', label: 'Glocke' },
  { sound: 'chime', label: 'Dreiklang' },
  { sound: 'beep', label: 'Piepton' },
];

export interface Tone {
  /** Beginn in Sekunden nach dem Start */
  at: number;
  frequency: number;
  /** Ausklingzeit in Sekunden */
  duration: number;
  gain: number;
  wave: OscillatorType;
}

/** Ein Schlag aus Grundton und unharmonischen Obertönen, wie bei Metall. */
function strike(at: number, base: number, partials: [number, number, number][]): Tone[] {
  return partials.map(([ratio, gain, duration]) => ({ at, frequency: base * ratio, duration, gain, wave: 'sine' as OscillatorType }));
}

export function soundPlan(sound: TimerSound): Tone[] {
  switch (sound) {
    case 'gong':
      return strike(0, 110, [
        [1, 0.5, 4.5],
        [2, 0.25, 3.2],
        [2.76, 0.18, 2.4],
        [5.4, 0.06, 1.2],
      ]);
    case 'bell': {
      const partials: [number, number, number][] = [
        [1, 0.35, 2.2],
        [2.76, 0.16, 1.4],
        [5.4, 0.07, 0.7],
      ];
      return [...strike(0, 880, partials), ...strike(0.9, 880, partials)];
    }
    case 'chime':
      return [523.25, 659.25, 783.99, 1046.5].map((frequency, index) => ({
        at: index * 0.22,
        frequency,
        duration: 1.6,
        gain: 0.3,
        wave: 'sine' as OscillatorType,
      }));
    case 'beep':
      return [0, 0.3, 0.6, 1.2, 1.5, 1.8].map((at) => ({ at, frequency: 1000, duration: 0.16, gain: 0.18, wave: 'square' as OscillatorType }));
    case 'off':
    default:
      return [];
  }
}

type AudioContextClass = typeof AudioContext;

/**
 * Spielt die Töne ab. Das iPad gibt Ton erst nach einer Berührung frei, deshalb ruft der Presenter
 * bei jedem Tipp unlock() auf. Ohne Freigabe bleibt das Signal stumm, der Timer läuft trotzdem.
 */
export class SoundPlayer {
  private context: AudioContext | null = null;

  unlock(): void {
    try {
      // Safari und das iPad: Ton auch bei Stummschalter, wie bei einem Video
      const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
      if (session && session.type !== 'playback') session.type = 'playback';
    } catch {
      // Ältere Fassungen kennen das nicht.
    }
    const context = this.ensure();
    if (context && context.state === 'suspended') void context.resume().catch(() => undefined);
  }

  play(sound: TimerSound): void {
    const tones = soundPlan(sound);
    if (!tones.length) return;
    const context = this.ensure();
    if (!context) return;
    if (context.state === 'suspended') void context.resume().catch(() => undefined);
    const start = context.currentTime + 0.05;
    for (const tone of tones) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = tone.wave;
      oscillator.frequency.value = tone.frequency;
      const begin = start + tone.at;
      gain.gain.setValueAtTime(0.0001, begin);
      gain.gain.linearRampToValueAtTime(tone.gain, begin + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, begin + tone.duration);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(begin);
      oscillator.stop(begin + tone.duration + 0.05);
    }
  }

  destroy(): void {
    void this.context?.close().catch(() => undefined);
    this.context = null;
  }

  private ensure(): AudioContext | null {
    if (this.context) return this.context;
    const Context: AudioContextClass | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextClass }).webkitAudioContext;
    if (!Context) return null;
    try {
      this.context = new Context();
    } catch {
      this.context = null;
    }
    return this.context;
  }
}
