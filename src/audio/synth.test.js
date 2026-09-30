import { describe, it, expect } from 'vitest';
import {
  SAMPLE_RATE, rng, white, sine, biquad, seamless, loopFreq, normalize, envelope, encodeWav, rms,
} from './synth.js';

describe('synth', () => {
  it('rng is seeded: the same seed gives the same sounds every build', () => {
    const a = rng(7), b = rng(7), c = rng(8);
    const seqA = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(seqA);
    expect([c(), c(), c()]).not.toEqual(seqA);
    for (const v of seqA) expect(v >= 0 && v < 1).toBe(true);
  });

  it('loopFreq rounds a pitch to a whole number of cycles in the loop, so a tone never clicks at the seam', () => {
    expect(loopFreq(221.3, 2)).toBeCloseTo(221.5);
    expect(loopFreq(50, 6)).toBe(50);
    const n = 2 * SAMPLE_RATE;
    const tone = sine(n, loopFreq(221.3, 2));
    // One more sample would carry on from where it started.
    expect(Math.abs(tone[n - 1] - tone[0])).toBeLessThan(0.07);
  });

  it('a lowpass keeps the low tone and takes out the high one', () => {
    const n = SAMPLE_RATE;
    const low  = biquad(sine(n, 100),  'lowpass', 500, 0.707);
    const high = biquad(sine(n, 5000), 'lowpass', 500, 0.707);
    expect(rms(low.subarray(2000))).toBeGreaterThan(0.6);
    expect(rms(high.subarray(2000))).toBeLessThan(0.02);
  });

  it('a bandpass sweeps when given a centre per sample', () => {
    const n = SAMPLE_RATE;
    const swept = biquad(white(n, rng(1)), 'bandpass', i => 300 + 600 * i / n, 2);
    expect(swept.length).toBe(n);
    expect(swept.every(Number.isFinite)).toBe(true);
  });

  it('seamless folds the tail of a noise bed into its head, so the loop wraps without a jump', () => {
    const n = 1000, fade = 200;
    const x = white(n + fade, rng(3));
    const y = seamless(x, fade);
    expect(y.length).toBe(n);
    expect(y[0]).toBeCloseTo(x[n]);            // wraps on from y[n-1] = x[n-1]
    expect(y[n - 1]).toBe(x[n - 1]);
    expect(y[fade]).toBe(x[fade]);             // past the fade, untouched
  });

  it('envelope draws straight lines between (seconds, level) points', () => {
    const env = envelope(SAMPLE_RATE, [[0, 0], [0.5, 1], [1, 0]]);
    expect(env[0]).toBe(0);
    expect(env[Math.round(SAMPLE_RATE / 4)]).toBeCloseTo(0.5, 3);
    expect(env[SAMPLE_RATE / 2]).toBeCloseTo(1, 3);
    expect(env[SAMPLE_RATE - 1]).toBeCloseTo(0, 3);
  });

  it('normalize scales to the peak asked for', () => {
    const x = normalize(Float32Array.from([0.1, -0.4, 0.2]), 0.8);
    expect(Math.max(...x.map(Math.abs))).toBeCloseTo(0.8);
  });

  it('encodeWav writes a mono 16-bit PCM file, clamped, that browsers decode', () => {
    const bytes = encodeWav(Float32Array.from([0, 1, -1, 2]), 22050);
    const text = (at, len) => String.fromCharCode(...bytes.subarray(at, at + len));
    const view = new DataView(bytes.buffer);
    expect(text(0, 4)).toBe('RIFF');
    expect(text(8, 4)).toBe('WAVE');
    expect(text(12, 4)).toBe('fmt ');
    expect(view.getUint16(20, true)).toBe(1);        // PCM
    expect(view.getUint16(22, true)).toBe(1);        // mono
    expect(view.getUint32(24, true)).toBe(22050);
    expect(view.getUint16(34, true)).toBe(16);
    expect(text(36, 4)).toBe('data');
    expect(view.getUint32(40, true)).toBe(8);
    expect(bytes.length).toBe(44 + 8);
    expect(view.getInt16(46, true)).toBe(32767);
    expect(view.getInt16(48, true)).toBe(-32767);
    expect(view.getInt16(50, true)).toBe(32767);     // 2 clamps to full scale
  });
});
