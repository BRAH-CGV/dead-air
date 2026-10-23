import { describe, it, expect } from 'vitest';
import { findBursts, loudSpan, DuctCrawl, DUCT_CRAWL, ductEnvelope, walkRate } from './RagnoSounds.js';

const SR = 1000;

function seeded(seed) {
  let a = seed * 0x9e3779b9;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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

describe('DuctCrawl', () => {
  /** Every cue over `seconds`, with the time it came. */
  function cues(seconds, seed = 4, dt = 1 / 60) {
    const crawl = new DuctCrawl(seeded(seed));
    crawl.start();
    const out = [];
    for (let t = 0; t < seconds; t += dt) {
      for (const c of crawl.update(dt)) out.push({ t, clip: c.clip, layer: c.layer, gain: c.gain, detune: c.detune });
    }
    return out;
  }

  it('cuts the recording into one step (the first thud) and the layers after it, in order, none overlapping', () => {
    const { step, layers } = DUCT_CRAWL.clips;
    expect(step[0]).toBe(0);
    let end = step[0] + step[1];
    for (const [start, length] of layers) {
      expect(start).toBeGreaterThanOrEqual(end);
      expect(length).toBeGreaterThan(0.1);
      end = start + length;
    }
    expect(end).toBeLessThanOrEqual(12.84);
    expect(layers.length).toBeGreaterThanOrEqual(10);
  });

  it('starts with the thud at once, then walks: a footfall every fraction of a second, with now and then a pause', () => {
    const all = cues(20);
    const steps = all.filter(c => !c.layer);
    expect(steps[0].t).toBe(0);
    expect(steps[0].clip).toBe(DUCT_CRAWL.clips.step);
    expect(steps.length).toBeGreaterThan(25);
    const gaps = steps.slice(1).map((c, i) => c.t - steps[i].t);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(DUCT_CRAWL.stepEvery[0] - 0.02);
    expect(Math.max(...gaps)).toBeGreaterThan(DUCT_CRAWL.stepEvery[1]);   // a pause
  });

  it('not the same thud every footfall: under half are it, the rest the other knocks and creaks, quieter', () => {
    const steps = cues(30).filter(c => !c.layer);
    const thuds = steps.filter(c => c.clip === DUCT_CRAWL.clips.step);
    expect(thuds.length / steps.length).toBeLessThan(0.55);
    expect(thuds.length / steps.length).toBeGreaterThan(0.25);
    const others = steps.filter(c => c.clip !== DUCT_CRAWL.clips.step);
    expect(new Set(others.map(c => c.clip)).size).toBeGreaterThan(DUCT_CRAWL.clips.layers.length / 2);
    for (const c of others) expect(c.gain).toBeLessThan(c.clip[2]);
    // Nor two thuds at quite the same level.
    expect(new Set(thuds.map(c => c.gain)).size).toBeGreaterThan(thuds.length / 2);
  });

  it('the step is quieter than its recording: the thud is the loudest thing in the file', () => {
    expect(DUCT_CRAWL.clips.step[2]).toBeLessThan(0.5);
  });

  it('layers the creaks and thuds over the steps, sometimes two at once, never the same one twice running', () => {
    const layers = cues(30).filter(c => c.layer);
    expect(layers.length).toBeGreaterThan(40);
    // Footfalls and layers alike: no knock or creak twice running.
    const pieces = cues(30).filter(c => c.clip !== DUCT_CRAWL.clips.step);
    for (let i = 1; i < pieces.length; i++) expect(pieces[i].clip).not.toBe(pieces[i - 1].clip);
    const together = layers.filter((c, i) => i > 0 && c.t === layers[i - 1].t);
    expect(together.length).toBeGreaterThan(0);
    expect(new Set(layers.map(c => c.clip)).size).toBeGreaterThan(DUCT_CRAWL.clips.layers.length / 2);
  });

  it('pitches each sound a little apart, within its spread', () => {
    const all = cues(20);
    for (const c of all) {
      expect(Math.abs(c.detune)).toBeLessThanOrEqual(c.layer ? DUCT_CRAWL.detune.layer : DUCT_CRAWL.detune.step);
      expect(c.gain).toBeLessThanOrEqual(c.clip[2]);
      expect(c.gain).toBeGreaterThan(0);
    }
    expect(new Set(all.map(c => c.detune)).size).toBeGreaterThan(10);
  });

  it('is the same crawl from the same seed', () => {
    expect(cues(5, 9)).toEqual(cues(5, 9));
  });
});

describe('ductEnvelope', () => {
  const o = { fadeIn: 1.2, fadeOut: 1, floor: 0.25 };

  it('climbing in, it swells from faint to full; climbing out, it dies away again — never cut in or out', () => {
    expect(ductEnvelope(0, 8, o)).toBeCloseTo(0.25);
    expect(ductEnvelope(0.6, 8, o)).toBeGreaterThan(0.25);
    expect(ductEnvelope(0.6, 8, o)).toBeLessThan(1);
    expect(ductEnvelope(4, 8, o)).toBe(1);
    expect(ductEnvelope(7.5, 8, o)).toBeLessThan(1);
    expect(ductEnvelope(8, 8, o)).toBeCloseTo(0.25);
    for (let t = 0; t < 8; t += 0.1) expect(ductEnvelope(t + 0.1, 8, o) - ductEnvelope(t, 8, o)).toBeLessThan(0.15);
  });

  it('a short run (going back out) still swells and fades, never past full', () => {
    for (let t = 0; t <= 1.5; t += 0.05) expect(ductEnvelope(t, 1.5, o)).toBeLessThanOrEqual(1);
    expect(ductEnvelope(0.75, 1.5, o)).toBeGreaterThan(ductEnvelope(0, 1.5, o));
  });
});
