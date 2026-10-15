import { describe, it, expect } from 'vitest';
import { findBursts, loudSpan, synthDuctCrawl, walkRate } from './RagnoSounds.js';

const SR = 1000;

/** Silence with tones of `amp` between [start, end) seconds. */
function clip(seconds, parts) {
  const out = new Float32Array(Math.round(seconds * SR));
  for (const [start, end, amp] of parts) {
    for (let i = Math.round(start * SR); i < Math.round(end * SR); i++) out[i] = amp * Math.sin(i * 0.9);
  }
  return out;
}

describe('findBursts', () => {
  it('finds each sound between silences, with how loud it peaks', () => {
    const samples = clip(6, [[0.5, 1.0, 0.05], [2, 2.6, 0.5], [4, 4.3, 0.04]]);
    const bursts = findBursts(samples, SR, { threshold: -40 });
    expect(bursts).toHaveLength(3);
    expect(bursts[0].start).toBeCloseTo(0.5, 1);
    expect(bursts[0].end).toBeCloseTo(1.0, 1);
    expect(bursts[1].peak).toBeGreaterThan(bursts[0].peak);
  });

  it('bridges short gaps inside one sound', () => {
    const samples = clip(3, [[0.5, 0.9, 0.2], [0.95, 1.4, 0.2]]);
    expect(findBursts(samples, SR, { threshold: -40, gap: 0.15 })).toHaveLength(1);
  });

  it('drops blips shorter than the minimum', () => {
    const samples = clip(3, [[0.5, 0.52, 0.3], [1, 1.5, 0.3]]);
    expect(findBursts(samples, SR, { threshold: -40, min: 0.1 })).toHaveLength(1);
  });
});

describe('loudSpan', () => {
  it('the stretch where the clip is loud, quiet lead-in and tail cut', () => {
    const samples = clip(3, [[0, 0.3, 0.01], [0.3, 2.0, 0.6], [2.0, 3, 0.01]]);
    const [start, end] = loudSpan(samples, SR, -20);
    expect(start).toBeCloseTo(0.3, 1);
    expect(end).toBeCloseTo(2.0, 1);
  });

  it('all of it, if nothing is that loud', () => {
    const samples = clip(1, [[0, 1, 0.001]]);
    expect(loudSpan(samples, SR, -10)).toEqual([0, 1]);
  });
});

describe('synthDuctCrawl', () => {
  it('is a run of knocks in a metal duct: mostly quiet, with sharp hits, never clipping', () => {
    const s = synthDuctCrawl({ sampleRate: 8000, seconds: 3, seed: 3 });
    expect(s.length).toBe(24000);
    let peak = 0, quiet = 0;
    for (const v of s) { peak = Math.max(peak, Math.abs(v)); if (Math.abs(v) < 0.02) quiet++; }
    expect(peak).toBeLessThanOrEqual(1);
    expect(peak).toBeGreaterThan(0.3);
    expect(quiet / s.length).toBeGreaterThan(0.3);
  });

  it('is the same every time for one seed', () => {
    const a = synthDuctCrawl({ sampleRate: 4000, seconds: 1, seed: 9 });
    const b = synthDuctCrawl({ sampleRate: 4000, seconds: 1, seed: 9 });
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});

describe('walkRate', () => {
  it('plays the walking loop at the pace of his steps: slow when creeping, quick when running', () => {
    expect(walkRate(0)).toBe(0);
    expect(walkRate(1.4)).toBeGreaterThan(0.5);
    expect(walkRate(4.2)).toBeGreaterThan(walkRate(1.4));
    expect(walkRate(20)).toBeLessThanOrEqual(2);
  });
});
