// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { showToonPoof, TOON_POOF } from './ToonPoof.js';

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('showToonPoof', () => {
  it('puts a small comic burst on the screen, centred where it is asked, saying POOF', () => {
    const el = showToonPoof(300, 200);
    expect(el.parentNode).toBe(document.body);
    expect(el.textContent).toMatch(/POOF/);
    expect(el.querySelector('svg')).toBeTruthy();
    expect(el.style.left).toBe(`${300 - TOON_POOF.size / 2}px`);
    expect(el.style.top).toBe(`${200 - TOON_POOF.size / 2}px`);
    expect(el.style.pointerEvents).toBe('none');           // never takes a click
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
