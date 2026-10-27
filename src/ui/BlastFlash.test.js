// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { showBlastFlash, BLAST_FLASH } from './BlastFlash.js';

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
