import { describe, it, expect } from 'vitest';
import { synthGrowl } from './Growl.js';

// ─────────────────────────────────────────────
// synthGrowl — a low growl, made rather than recorded
// ─────────────────────────────────────────────

const SR = 44100;

describe('synthGrowl', () => {
  it('is as long as asked', () => {
    expect(synthGrowl({ sampleRate: SR, seconds: 1.4 })).toHaveLength(Math.round(SR * 1.4));
  });

  it('is normalised, and starts and ends in silence (no click)', () => {
    const g = synthGrowl({ sampleRate: SR, seconds: 1.4 });
    const peak = g.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    expect(peak).toBeCloseTo(0.9, 2);
    expect(Math.abs(g[0])).toBeLessThan(0.01);
    expect(Math.abs(g[g.length - 1])).toBeLessThan(0.01);
  });

  it('is low — few zero crossings a second', () => {
    const g = synthGrowl({ sampleRate: SR, seconds: 1.4 });
    let crossings = 0;
    for (let i = 1; i < g.length; i++) if ((g[i - 1] < 0) !== (g[i] < 0)) crossings++;
    expect(crossings / 1.4).toBeLessThan(500);
  });

  it('is the same growl every time', () => {
    const a = synthGrowl({ sampleRate: SR, seconds: 0.5 });
    const b = synthGrowl({ sampleRate: SR, seconds: 0.5 });
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});
