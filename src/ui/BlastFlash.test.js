// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { showBlastFlash, shakeScreen, BLAST_FLASH, SCREEN_SHAKE } from './BlastFlash.js';

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('showBlastFlash', () => {
  it('covers the whole page, under the white-out, and never takes a click', () => {
    const el = showBlastFlash(300, 200);
    expect(el.parentNode).toBe(document.body);
    expect(el.style.position).toBe('fixed');
    expect(el.style.pointerEvents).toBe('none');
    expect(Number(el.style.zIndex)).toBeLessThan(102);   // #whiteout's
  });

  it('takes itself away once it has played', () => {
    vi.useFakeTimers();
    const el = showBlastFlash(0, 0);
    vi.advanceTimersByTime(BLAST_FLASH.ms);
    expect(el.parentNode).toBe(null);
  });
});

describe('shakeScreen', () => {
  it('jolts the element hardest at once, dying away to still, over its time', () => {
    const el = { animate: vi.fn(() => ({})) };
    shakeScreen(el);
    const [frames, { duration }] = el.animate.mock.calls[0];
    expect(duration).toBe(SCREEN_SHAKE.ms);
    const px = f => Math.hypot(...f.transform.match(/translate\((-?[\d.]+)px, (-?[\d.]+)px\)/).slice(1).map(Number));
    const early = Math.max(...frames.slice(0, 5).map(px));
    const late = Math.max(...frames.slice(-6, -1).map(px));
    expect(early).toBeGreaterThan(SCREEN_SHAKE.px / 4);
    expect(late).toBeLessThan(early / 4);
    expect(frames.at(-1).transform).toMatch(/translate\(0\.0px, 0\.0px\).*scale\(1\.000\)/);
  });

  it('is zoomed in while it shakes, so the page behind never shows', () => {
    const el = { animate: vi.fn(() => ({})) };
    shakeScreen(el);
    const [frames] = el.animate.mock.calls[0];
    const zoom = Number(frames[0].transform.match(/scale\(([\d.]+)\)/)[1]);
    expect(zoom).toBeGreaterThan(1);
  });

  it('does nothing to an element that cannot animate', () => {
    expect(shakeScreen(null)).toBe(null);
    expect(shakeScreen({})).toBe(null);
  });
});
