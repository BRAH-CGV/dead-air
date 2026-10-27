// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { showToonPoof, TOON_POOF } from './ToonPoof.js';

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('showToonPoof', () => {
  it('puts a small burst of comic lines on the screen, centred where it is asked', () => {
    const el = showToonPoof(300, 200);
    expect(el.parentNode).toBe(document.body);
    expect(el.querySelectorAll('.toon-poof-line')).toHaveLength(TOON_POOF.lines);
    expect(el.querySelectorAll('.toon-poof-sparkle')).toHaveLength(TOON_POOF.sparkles);
    expect(el.style.left).toBe(`${300 - TOON_POOF.size / 2}px`);
    expect(el.style.top).toBe(`${200 - TOON_POOF.size / 2}px`);
    expect(el.style.pointerEvents).toBe('none');           // never takes a click
  });

  it('has no words and no bubble: only lines and sparkles', () => {
    const el = showToonPoof(0, 0);
    expect(el.textContent.trim()).toBe('');
    expect(el.querySelector('text, polygon, circle, ellipse, rect')).toBe(null);
  });

  it('leaves the middle clear, where the cloud is', () => {
    const el = showToonPoof(0, 0);
    for (const line of el.querySelectorAll('.toon-poof-line')) {
      const [x, y] = line.getAttribute('d').match(/M\s*(-?[\d.]+)[ ,](-?[\d.]+)/).slice(1).map(Number);
      expect(Math.hypot(x - 50, y - 50)).toBeGreaterThan(20);
    }
  });

  it('is small: a fraction of the screen', () => {
    expect(TOON_POOF.size).toBeLessThanOrEqual(200);
  });

  it('takes itself away once it has played', () => {
    vi.useFakeTimers();
    const el = showToonPoof(10, 10);
    vi.advanceTimersByTime(TOON_POOF.ms + 50);
    expect(el.parentNode).toBe(null);
  });

  it('goes where it is told, when given a parent', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const el = showToonPoof(0, 0, { parent: host });
    expect(el.parentNode).toBe(host);
  });
});
