import { describe, it, expect } from 'vitest';
import { MouseSpikeFilter, MOUSE_SPIKE } from './MouseSpikes.js';

describe('MouseSpikeFilter — a touchpad glitch dropped, a fast flick kept (#117)', () => {
  it('passes ordinary movement through unchanged', () => {
    const f = new MouseSpikeFilter();
    expect(f.accept(12, -4)).toBe(true);
    expect(f.accept(-30, 8)).toBe(true);
  });

  it('keeps a fast flick that builds up over a few events, however big it gets', () => {
    const f = new MouseSpikeFilter();
    for (const dx of [20, 60, 150, 400, 900, 1500]) expect(f.accept(dx, 0), `${dx}`).toBe(true);
  });

  it('drops one huge jump out of nowhere, then carries on', () => {
    const f = new MouseSpikeFilter();
    f.accept(5, 2);
    expect(f.accept(2000, -1400)).toBe(false);
    expect(f.accept(6, 1)).toBe(true);
  });

  it('drops a big jump from rest', () => {
    const f = new MouseSpikeFilter();
    expect(f.accept(0, MOUSE_SPIKE.minimum + 50)).toBe(false);
  });

  it('a big delta just under the floor is never a spike', () => {
    const f = new MouseSpikeFilter();
    expect(f.accept(MOUSE_SPIKE.minimum, 0)).toBe(true);
  });

  it('drops NaN and Infinity', () => {
    const f = new MouseSpikeFilter();
    expect(f.accept(NaN, 0)).toBe(false);
    expect(f.accept(0, Infinity)).toBe(false);
  });

  it('a dropped spike is not what the next one is measured against', () => {
    const f = new MouseSpikeFilter();
    f.accept(4, 0);
    f.accept(3000, 0);
    expect(f.accept(2900, 0)).toBe(false);
  });

  it('reset() forgets the last movement (pointer lock regained)', () => {
    const f = new MouseSpikeFilter();
    f.accept(20, 0); f.accept(60, 0); f.accept(150, 0); f.accept(400, 0);
    f.reset();
    expect(f.accept(1000, 0)).toBe(false);
  });
});
