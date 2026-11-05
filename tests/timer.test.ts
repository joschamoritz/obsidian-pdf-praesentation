import { beforeEach, describe, expect, it } from 'vitest';
import { normalizePreferences } from '../src/presenter/session';
import { CountdownTimer, formatRemaining } from '../src/presenter/timer';
import { medianColor } from '../src/presenter/view';

describe('CountdownTimer', () => {
  let time: number;
  let timer: CountdownTimer;
  const pass = (seconds: number) => (time += seconds * 1000);

  beforeEach(() => {
    time = 1_000_000;
    timer = new CountdownTimer(5, () => time);
  });

  it('läuft nach der Uhrzeit, auch wenn zwischendurch nichts tickt', () => {
    expect(timer.status).toBe('idle');
    timer.start();
    pass(90);
    expect(timer.status).toBe('running');
    expect(timer.remaining).toBe(210_000);
  });

  it('hält an und setzt an derselben Stelle fort', () => {
    timer.start();
    pass(60);
    timer.toggle();
    expect(timer.status).toBe('paused');
    pass(600);
    expect(timer.remaining).toBe(240_000);
    timer.toggle();
    pass(40);
    expect(timer.status).toBe('running');
    expect(timer.remaining).toBe(200_000);
  });

  it('endet bei null und startet danach von vorn', () => {
    timer.start();
    pass(301);
    expect(timer.status).toBe('finished');
    expect(timer.remaining).toBe(0);
    timer.start();
    expect(timer.status).toBe('running');
    expect(timer.remaining).toBe(300_000);
  });

  it('ein zweiter Start verschenkt keine Zeit', () => {
    timer.start();
    pass(100);
    timer.start();
    expect(timer.remaining).toBe(200_000);
  });

  it('setzt zurück', () => {
    timer.start();
    pass(100);
    timer.reset();
    expect(timer.status).toBe('idle');
    expect(timer.remaining).toBe(300_000);
  });

  it('zeigt die letzte Minute als Warnung, kurze Timer erst im letzten Viertel', () => {
    timer.start();
    expect(timer.phase).toBe('normal');
    pass(241);
    expect(timer.phase).toBe('warning');
    pass(60);
    expect(timer.phase).toBe('finished');

    const short = new CountdownTimer(1, () => time);
    short.start();
    pass(30);
    expect(short.phase).toBe('normal');
    pass(20);
    expect(short.phase).toBe('warning');
  });

  it('eine Minute mehr geht jederzeit, auch nach dem Ende', () => {
    timer.adjust(1);
    expect(timer.minutes).toBe(6);
    timer.start();
    pass(100);
    timer.adjust(1);
    expect(timer.remaining).toBe(320_000);
    timer.pause();
    timer.adjust(-1);
    expect(timer.remaining).toBe(260_000);
    timer.start();
    pass(400);
    expect(timer.status).toBe('finished');
    timer.adjust(1);
    expect(timer.status).toBe('running');
    expect(timer.remaining).toBe(60_000);
  });

  it('bleibt in vernünftigen Grenzen', () => {
    timer.setMinutes(0);
    expect(timer.minutes).toBe(1);
    timer.adjust(-5);
    expect(timer.minutes).toBe(1);
    timer.setMinutes(9999);
    expect(timer.minutes).toBe(180);
  });

  it('eine neue Dauer stoppt einen laufenden Timer', () => {
    timer.start();
    pass(10);
    timer.setMinutes(10);
    expect(timer.status).toBe('idle');
    expect(timer.remaining).toBe(600_000);
  });
});

describe('Zeitanzeige', () => {
  it('rundet auf und zeigt Stunden nur, wenn nötig', () => {
    expect(formatRemaining(300_000)).toBe('5:00');
    expect(formatRemaining(59_001)).toBe('1:00');
    expect(formatRemaining(1)).toBe('0:01');
    expect(formatRemaining(0)).toBe('0:00');
    expect(formatRemaining(-5)).toBe('0:00');
    expect(formatRemaining(3_725_000)).toBe('1:02:05');
  });
});

describe('Randfarbe', () => {
  it('nimmt die Farbe der Mehrheit der Ecken, ein Logo in einer Ecke stört nicht', () => {
    expect(medianColor([[245, 248, 251], [245, 248, 251], [245, 248, 251], [20, 90, 160]])).toBe('rgb(245, 248, 251)');
  });
});

describe('Einstellungen', () => {
  it('ergänzt Timer und Rand bei alten Einstellungen', () => {
    const preferences = normalizePreferences({ tool: 'pen' });
    expect(preferences.timerSize).toBe('medium');
    expect(preferences.timerMinutes).toBeGreaterThan(0);
    expect(preferences.edgeMode).toBe('page');
  });

  it('verwirft unbrauchbare Werte', () => {
    const preferences = normalizePreferences({ timerSize: 'gigantisch', timerMinutes: -3, timerX: 'links', edgeMode: 'lila' });
    expect(preferences.timerSize).toBe('medium');
    expect(preferences.timerMinutes).toBeGreaterThan(0);
    expect(typeof preferences.timerX).toBe('number');
    expect(preferences.edgeMode).toBe('page');
  });
});
