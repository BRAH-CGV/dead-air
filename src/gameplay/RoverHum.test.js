import { describe, it, expect } from 'vitest';
import { synthRoverHum } from './RoverHum.js';

const SR = 8000;

describe('synthRoverHum', () => {
  it('is a loop of the length asked for, never clipping', () => {
    const s = synthRoverHum({ sampleRate: SR, seconds: 2 });
    expect(s.length).toBe(2 * SR);
    let peak = 0;
    for (const v of s) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeLessThanOrEqual(0.9 + 1e-6);
    expect(peak).toBeGreaterThan(0.5);
  });

  it('a low hum, not an engine\'s roar: mostly low frequencies', () => {
    const s = synthRoverHum({ sampleRate: SR, seconds: 2 });
    let crossings = 0;
    for (let i = 1; i < s.length; i++) if ((s[i] > 0) !== (s[i - 1] > 0)) crossings++;
    expect(crossings / 2 / 2).toBeLessThan(160);   // a fundamental under ~160 Hz
  });

  it('loops without a seam: the end runs straight into the start', () => {
    const s = synthRoverHum({ sampleRate: SR, seconds: 2 });
    let step = 0;
    for (let i = 1; i < s.length; i++) step = Math.max(step, Math.abs(s[i] - s[i - 1]));
    expect(Math.abs(s[0] - s[s.length - 1])).toBeLessThanOrEqual(step);
  });

  it('is the same hum from the same seed', () => {
    const a = synthRoverHum({ sampleRate: 4000, seconds: 1, seed: 3 });
    const b = synthRoverHum({ sampleRate: 4000, seconds: 1, seed: 3 });
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});

