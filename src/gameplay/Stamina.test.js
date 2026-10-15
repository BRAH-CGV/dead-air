import { describe, it, expect } from 'vitest';
import { Stamina, STAMINA, drainForShift } from './Stamina.js';

describe('Stamina', () => {
  it('starts full and ok', () => {
    const s = new Stamina();
    expect(s.value).toBe(1);
    expect(s.level).toBe('ok');
  });

  it('drains over the night: empty by 4:48 AM of a 300 s shift with no food', () => {
    const s = new Stamina();
    expect(STAMINA.emptyAt).toBe(0.8);
    s.update(120);
    expect(s.value).toBeCloseTo(0.5);
    s.update(119);
    expect(s.value).toBeGreaterThan(0);
    s.update(1);
    expect(s.value).toBe(0);
  });

  it('empties the same share of the way through whatever length the shift is', () => {
    expect(drainForShift(300)).toBeCloseTo(1 / 240);
    expect(drainForShift(600)).toBeCloseTo(1 / 480);
    const s = new Stamina({ nightSeconds: 600 });
    s.update(240);
    expect(s.value).toBeCloseTo(0.5);
    s.update(240);
    expect(s.value).toBe(0);
  });

  it('clamps at 0 and at 1', () => {
    const s = new Stamina({ drainPerSecond: 0.1 });
    s.update(50);
    expect(s.value).toBe(0);
    s.restore(5);
    expect(s.value).toBe(1);
  });

  it('outside, out in the cold in the suit, it drains STAMINA.outsidePace times as fast', () => {
    expect(STAMINA.outsidePace).toBe(2);
    const s = new Stamina({ drainPerSecond: 0.01 });
    s.update(10, STAMINA.outsidePace);
    expect(s.value).toBeCloseTo(0.8);
  });

  it('staring at the dust eyes takes STAMINA.stare a second on top of the drain', () => {
    expect(STAMINA.stare).toBeGreaterThan(0);
    const s = new Stamina({ drainPerSecond: 0.01 });
    s.update(10, 1, STAMINA.stare);
    expect(s.value).toBeCloseTo(1 - 0.1 - 10 * STAMINA.stare);
    // A stare is felt: ten seconds of it cost more than a minute of the night.
    expect(10 * STAMINA.stare).toBeGreaterThan(60 * drainForShift(600));
  });

  it('the paces compose: staring outside drains both ways', () => {
    const s = new Stamina({ drainPerSecond: 0.01 });
    s.update(5, STAMINA.outsidePace, STAMINA.stare);
    expect(s.value).toBeCloseTo(1 - 5 * (0.01 * STAMINA.outsidePace + STAMINA.stare));
  });

  it('restore adds an amount', () => {
    const s = new Stamina({ drainPerSecond: 0.1 });
    s.update(5);                        // 0.5
    s.restore(0.35);
    expect(s.value).toBeCloseTo(0.85);
  });

  it('levels: ok from 0.5, tired from 0.2, critical below', () => {
    const s = new Stamina();
    s.value = 0.5;
    expect(s.level).toBe('ok');
    s.value = 0.49;
    expect(s.level).toBe('tired');
    s.value = 0.2;
    expect(s.level).toBe('tired');
    s.value = 0.19;
    expect(s.level).toBe('critical');
  });

  it('reset() fills it again for a new or retried night', () => {
    const s = new Stamina();
    s.update(200);
    s.reset();
    expect(s.value).toBe(1);
  });
});
