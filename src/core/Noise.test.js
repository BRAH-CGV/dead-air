import { describe, it, expect } from 'vitest';
import { makeNoise2D, fbm, ridgedFbm } from './Noise.js';

// The terrain is generated, not authored, so "the valley looks right" is only
// a useful statement if the valley is the same every time. These tests pin the
// two properties the generator relies on: determinism from the seed, and
// continuity — a height function with steps in it makes cliffs the player
// falls through.

describe('makeNoise2D', () => {
  it('is deterministic for a given seed', () => {
    const a = makeNoise2D(1234);
    const b = makeNoise2D(1234);

    for (const [x, z] of [[0, 0], [1.5, -3.25], [-90.1, 412.7]]) {
      expect(a(x, z)).toBe(b(x, z));
    }
  });

  it('gives a different field for a different seed', () => {
    const a = makeNoise2D(1);
    const b = makeNoise2D(2);

    // Compare a spread of samples: any single one could coincide by chance.
    const samples = [[0.5, 0.5], [4.5, 9.5], [-12.5, 33.5], [101.5, -7.5]];
    const differing = samples.filter(([x, z]) => a(x, z) !== b(x, z));
    expect(differing.length).toBe(samples.length);
  });

  it('stays inside [-1, 1]', () => {
    const n = makeNoise2D(7);
    for (let i = 0; i < 500; i++) {
      const v = n(i * 0.37 - 90, i * -0.91 + 15);
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('is continuous — a tiny step in x makes a tiny step in value', () => {
    const n = makeNoise2D(99);
    for (let i = 0; i < 200; i++) {
      const x = i * 0.13 - 13;
      expect(Math.abs(n(x, 2.7) - n(x + 0.001, 2.7))).toBeLessThan(0.01);
    }
  });

  it('varies across the field — the continuity test alone would pass on a constant', () => {
    const n = makeNoise2D(5);
    const values = new Set();
    for (let i = 0; i < 50; i++) values.add(n(i * 0.5, i * 0.25));
    expect(values.size).toBeGreaterThan(20);
  });
});

describe('fbm', () => {
  it('stays inside [-1, 1] however many octaves are stacked', () => {
    const n = makeNoise2D(3);
    for (let i = 0; i < 300; i++) {
      const v = fbm(n, i * 0.07, i * -0.11, { octaves: 6 });
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('is deterministic', () => {
    const n = makeNoise2D(42);
    expect(fbm(n, 3.3, -1.1)).toBe(fbm(n, 3.3, -1.1));
  });

  it('adds detail as octaves are added', () => {
    const n = makeNoise2D(11);
    expect(fbm(n, 1.7, 2.3, { octaves: 1 })).not.toBe(fbm(n, 1.7, 2.3, { octaves: 5 }));
  });

  it('is continuous', () => {
    const n = makeNoise2D(21);
    for (let i = 0; i < 200; i++) {
      const x = i * 0.09;
      expect(Math.abs(fbm(n, x, 0.4) - fbm(n, x + 0.0005, 0.4))).toBeLessThan(0.01);
    }
  });
});

describe('ridgedFbm', () => {
  it('stays inside [0, 1] — it is a height multiplier, never negative', () => {
    const n = makeNoise2D(13);
    for (let i = 0; i < 300; i++) {
      const v = ridgedFbm(n, i * 0.05, i * 0.08);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('is continuous — ridgelines are creases, not cliffs', () => {
    const n = makeNoise2D(17);
    for (let i = 0; i < 200; i++) {
      const x = i * 0.11;
      expect(Math.abs(ridgedFbm(n, x, 1.3) - ridgedFbm(n, x + 0.0005, 1.3))).toBeLessThan(0.01);
    }
  });

  it('peaks where the underlying noise crosses zero', () => {
    // That inversion is the whole trick: |n| is small at a zero crossing, so
    // 1 - |n| is near 1 there, turning smooth blobs into sharp ridges.
    const n = makeNoise2D(4);
    const single = { octaves: 1 };
    let best = { v: -Infinity, x: 0 };
    for (let i = 0; i < 400; i++) {
      const x = i * 0.01;
      const v = ridgedFbm(n, x, 0, single);
      if (v > best.v) best = { v, x };
    }
    expect(Math.abs(n(best.x, 0))).toBeLessThan(0.05);
  });
});
