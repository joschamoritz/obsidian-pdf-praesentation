import { beforeEach, describe, expect, it } from 'vitest';
import { GestureRouter, PALM_WINDOW_MS, type GestureHandlers, type PointerInput } from '../src/presenter/gestures';

function input(pointerId: number, pointerType: string, clientX: number, clientY: number, timeStamp: number): PointerInput {
  return { pointerId, pointerType, clientX, clientY, button: 0, timeStamp };
}

describe('GestureRouter', () => {
  let log: string[];
  let zoomed: boolean;
  let fingerDraws: boolean;
  let router: GestureRouter<PointerInput>;

  beforeEach(() => {
    log = [];
    zoomed = false;
    fingerDraws = false;
    const handlers: GestureHandlers<PointerInput> = {
      inkStart: () => log.push('inkStart'),
      inkMove: () => log.push('inkMove'),
      inkEnd: () => log.push('inkEnd'),
      inkCancel: () => log.push('inkCancel'),
      swipe: (direction) => log.push(`swipe:${direction}`),
      tap: () => log.push('tap'),
      pan: () => log.push('pan'),
      pinch: () => log.push('pinch'),
      gestureEnd: () => log.push('gestureEnd'),
      isZoomed: () => zoomed,
      fingerDraws: () => fingerDraws,
    };
    router = new GestureRouter(handlers);
  });

  it('der Stift zeichnet', () => {
    router.down(input(1, 'pen', 10, 10, 0));
    router.move(input(1, 'pen', 20, 20, 10));
    router.up(input(1, 'pen', 20, 20, 20));
    expect(log).toEqual(['inkStart', 'inkMove', 'inkEnd']);
  });

  it('die aufliegende Hand löst beim Schreiben nichts aus', () => {
    router.down(input(1, 'pen', 10, 10, 0));
    router.down(input(2, 'touch', 300, 300, 5));
    router.move(input(2, 'touch', 100, 300, 50));
    router.up(input(2, 'touch', 100, 300, 60));
    router.up(input(1, 'pen', 12, 12, 70));
    expect(log).toEqual(['inkStart', 'inkEnd']);
  });

  it('ein Handballen, der vor dem Stift aufliegt, blättert nicht', () => {
    router.down(input(2, 'touch', 300, 300, 0));
    router.down(input(1, 'pen', 10, 10, 20));
    router.move(input(2, 'touch', 100, 300, 50));
    router.up(input(1, 'pen', 12, 12, 60));
    router.up(input(2, 'touch', 100, 300, 70));
    expect(log).toEqual(['inkStart', 'inkEnd']);
  });

  it('kurz nach dem Stift zählt eine Berührung noch als Hand, danach wieder als Finger', () => {
    router.down(input(1, 'pen', 10, 10, 0));
    router.up(input(1, 'pen', 10, 10, 100));
    router.down(input(2, 'touch', 300, 300, 100 + PALM_WINDOW_MS - 1));
    router.up(input(2, 'touch', 300, 300, 100 + PALM_WINDOW_MS + 10));
    expect(log).toEqual(['inkStart', 'inkEnd']);

    router.down(input(3, 'touch', 300, 300, 100 + PALM_WINDOW_MS + 50));
    router.up(input(3, 'touch', 300, 300, 100 + PALM_WINDOW_MS + 100));
    expect(log).toEqual(['inkStart', 'inkEnd', 'tap']);
  });

  it('Wischen nach links blättert vor, nach rechts zurück', () => {
    router.down(input(1, 'touch', 400, 300, 0));
    router.move(input(1, 'touch', 300, 305, 50));
    router.up(input(1, 'touch', 300, 305, 100));
    router.down(input(2, 'touch', 100, 300, 200));
    router.move(input(2, 'touch', 200, 300, 250));
    router.up(input(2, 'touch', 200, 300, 300));
    expect(log).toEqual(['swipe:1', 'swipe:-1']);
  });

  it('senkrechtes Ziehen blättert nicht', () => {
    router.down(input(1, 'touch', 300, 100, 0));
    router.move(input(1, 'touch', 310, 300, 50));
    router.up(input(1, 'touch', 310, 300, 100));
    expect(log).toEqual([]);
  });

  it('im Zoom verschiebt ein Finger, statt zu blättern', () => {
    zoomed = true;
    router.down(input(1, 'touch', 400, 300, 0));
    router.move(input(1, 'touch', 300, 300, 50));
    router.up(input(1, 'touch', 300, 300, 100));
    expect(log).toEqual(['pan', 'gestureEnd']);
  });

  it('zwei Finger zoomen, der übrig gebliebene Finger löst danach nichts aus', () => {
    router.down(input(1, 'touch', 100, 100, 0));
    router.down(input(2, 'touch', 200, 100, 10));
    router.move(input(2, 'touch', 300, 100, 50));
    router.up(input(2, 'touch', 300, 100, 60));
    router.move(input(1, 'touch', 400, 100, 70));
    router.up(input(1, 'touch', 400, 100, 80));
    expect(log).toEqual(['pinch', 'gestureEnd']);
  });

  it('im Fingermodus zeichnet ein Finger, ein schneller zweiter macht daraus eine Zoomgeste', () => {
    fingerDraws = true;
    router.down(input(1, 'touch', 100, 100, 0));
    router.down(input(2, 'touch', 200, 100, 100));
    router.move(input(2, 'touch', 300, 100, 150));
    router.up(input(1, 'touch', 100, 100, 200));
    router.up(input(2, 'touch', 300, 100, 210));
    expect(log).toEqual(['inkStart', 'inkCancel', 'pinch', 'gestureEnd']);
  });

  it('ein von iPadOS abgebrochener Strich bleibt erhalten', () => {
    router.down(input(1, 'pen', 10, 10, 0));
    router.cancel(input(1, 'pen', 10, 10, 50));
    expect(log).toEqual(['inkStart', 'inkEnd']);
  });
});
