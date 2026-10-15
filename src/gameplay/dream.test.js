import { describe, it, expect } from 'vitest';
import { DREAM_LEVELS, dreamLevel, walkScale, unease } from './dream.js';

describe('dream rules (#101)', () => {
  it('has three levels, each more unhinged than the last', () => {
    expect(DREAM_LEVELS.length).toBe(3);
    for (let i = 1; i < 3; i++) {
      const [a, b] = [DREAM_LEVELS[i - 1], DREAM_LEVELS[i]];
      expect(b.slowStart, 'slows sooner').toBeLessThan(a.slowStart);
      expect(b.pullRadius, 'pulls back sooner').toBeLessThan(a.pullRadius);
      expect(b.drag, 'drags harder').toBeGreaterThan(a.drag);
      expect(b.fogMax, 'thicker fog').toBeGreaterThan(a.fogMax);
      expect(b.skyMax, 'stranger sky').toBeGreaterThan(a.skyMax);
    }
    for (const L of DREAM_LEVELS) expect(L.slowStart).toBeLessThan(L.pullRadius);
  });

  it('dreamLevel clamps to the levels there are', () => {
    expect(dreamLevel(1)).toBe(DREAM_LEVELS[0]);
    expect(dreamLevel(3)).toBe(DREAM_LEVELS[2]);
    expect(dreamLevel(7)).toBe(DREAM_LEVELS[2]);
    expect(dreamLevel(0)).toBe(DREAM_LEVELS[0]);
    expect(dreamLevel(undefined)).toBe(DREAM_LEVELS[0]);
  });

  it('walks at full speed near the base, slower further out, at the floor past the pull', () => {
    const L = dreamLevel(1);
    expect(walkScale(0, L)).toBe(1);
    expect(walkScale(L.slowStart, L)).toBe(1);
    const mid = walkScale((L.slowStart + L.pullRadius) / 2, L);
    expect(mid).toBeLessThan(1);
    expect(mid).toBeGreaterThan(L.minWalk);
    expect(walkScale(L.pullRadius, L)).toBeCloseTo(L.minWalk);
    expect(walkScale(L.pullRadius * 3, L)).toBeCloseTo(L.minWalk);
  });

  it('only ever slows down as you go further', () => {
    const L = dreamLevel(2);
    let last = 2;
    for (let d = 0; d <= L.pullRadius + 10; d += 0.5) {
      const s = walkScale(d, L);
      expect(s).toBeLessThanOrEqual(last + 1e-12);
      last = s;
    }
  });

  it('unease runs 0 near the base to 1 at the pull radius', () => {
    const L = dreamLevel(1);
    expect(unease(0, L)).toBe(0);
    expect(unease(L.slowStart, L)).toBe(0);
    expect(unease(L.pullRadius, L)).toBe(1);
    expect(unease(L.pullRadius * 2, L)).toBe(1);
  });

  it('caps the crawl at the edge: a few seconds deep in the slow ring, then the pull (playtest)', () => {
    for (const L of DREAM_LEVELS) {
      expect(L.ringSeconds).toBeGreaterThan(0);
      expect(L.ringSeconds).toBeLessThanOrEqual(5);
    }
    expect(DREAM_LEVELS[2].ringSeconds).toBeLessThanOrEqual(DREAM_LEVELS[0].ringSeconds);
  });
});
