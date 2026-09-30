import { describe, it, expect } from 'vitest';
import { SOUNDS, renderSound } from './sounds.js';
import { SAMPLE_RATE } from './synth.js';
import { ASSETS } from '../assets/manifest.js';

const rendered = new Map(Object.keys(SOUNDS).map(key => [key, renderSound(key)]));

/** Typical size of a step between neighbouring samples. */
function stepRms(x) {
  let s = 0;
  for (let i = 1; i < x.length; i++) s += (x[i] - x[i - 1]) ** 2;
  return Math.sqrt(s / (x.length - 1));
}

describe('sound recipes', () => {
  it('every recipe has a .wav under assets/audio/, and every .wav a recipe (recordings are .mp3)', () => {
    const wav = Object.keys(ASSETS)
      .filter(k => ASSETS[k].type === 'audio' && ASSETS[k].url.endsWith('.wav'))
      .sort();
    expect(Object.keys(SOUNDS).sort()).toEqual(wav);
    for (const key of wav) {
      expect(ASSETS[key].url).toBe(`assets/audio/${key.slice(key.indexOf(':') + 1)}.wav`);
    }
  });

  it('renders mono, audible, unclipped samples of the length the recipe declares', () => {
    for (const [key, x] of rendered) {
      expect(x, key).toBeInstanceOf(Float32Array);
      expect(x.length, key).toBe(Math.round(SOUNDS[key].seconds * SAMPLE_RATE));
      let peak = 0, finite = true;
      for (const v of x) {
        finite &&= Number.isFinite(v);
        peak = Math.max(peak, Math.abs(v));
      }
      expect(finite, key).toBe(true);
      expect(peak, key).toBeLessThanOrEqual(1);
      expect(peak, key).toBeGreaterThan(0.05);
    }
  });

  it('loops wrap without a click: last sample to first is an ordinary step', () => {
    for (const [key, x] of rendered) {
      if (!SOUNDS[key].loop) continue;
      const seam = Math.abs(x[0] - x[x.length - 1]);
      expect(seam, key).toBeLessThan(4 * stepRms(x) + 1e-3);
    }
  });

  it('one-shots end in silence, so nothing is cut off mid-sound', () => {
    for (const [key, x] of rendered) {
      if (SOUNDS[key].loop) continue;
      const tail = x.subarray(x.length - 32).map(Math.abs);
      expect(Math.max(...tail), key).toBeLessThan(0.02);
    }
  });

  it('is deterministic: rebuilding gives the same samples', () => {
    const key = 'amb:office';
    expect(renderSound(key)).toEqual(rendered.get(key));
  });

  it('covers what package E asks for: rooms, machines, threats and the sting', () => {
    // The wind outside is the team's recording (amb:outside-wind), not a recipe.
    for (const key of [
      'amb:office', 'amb:server-room', 'amb:quarters', 'amb:corridor', 'amb:airlock',
      'amb:server-hum', 'amb:generator', 'amb:dish-motor', 'sfx:scan-tick', 'sfx:scan-lock',
      'sfx:save', 'sfx:delete', 'sfx:airlock-hiss', 'sfx:airlock-clunk', 'sfx:chime',
      'amb:breathing', 'sfx:glass-tap', 'amb:camera-servo', 'amb:camera-tone', 'sfx:death-sting',
      'sfx:power-cut',
    ]) expect(SOUNDS, key).toHaveProperty([key]);
  });
});
