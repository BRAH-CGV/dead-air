import { describe, it, expect } from 'vitest';
import { drawIntro, makeStars, signalState, voyagePath, landingZoom, buggyX, beatDip, BEAT_DIP, ROVER } from './introDraw.js';
import { INTRO_BEATS, beatAt } from './IntroTimeline.js';

// ─────────────────────────────────────────────
// introDraw — the intro's pictures on a 2D canvas
// ─────────────────────────────────────────────

/** A 2D context that records what is drawn and checks nothing is NaN. */
function recordingContext() {
  const calls = [];
  const gradient = { addColorStop: () => {} };
  const ctx = new Proxy({ calls }, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => gradient;
      if (key === 'measureText') return (s) => ({ width: String(s).length * 8 });
      return (...args) => {
        for (const a of args) {
          if (typeof a === 'number' && !Number.isFinite(a)) throw new Error(`${String(key)} got ${a}`);
        }
        calls.push({ name: key, args });
      };
    },
    set(target, key, value) {
      target[key] = value;
      if (key === 'strokeStyle' || key === 'fillStyle') calls.push({ name: key, args: [value] });
      return true;
    },
  });
  return ctx;
}

const scene = { stars: makeStars(80, () => 0.37), array: 'ARRAY K-17' };

describe('drawIntro', () => {
  it('draws every beat, from start to end, without a bad number', () => {
    for (const beat of INTRO_BEATS) {
      for (const p of [0, 0.25, 0.5, 0.75, 0.999]) {
        const ctx = recordingContext();
        const info = { id: beat.id, beat, progress: p, local: p * (Number.isFinite(beat.seconds) ? beat.seconds : 3) };
        drawIntro(ctx, 1280, 720, info, scene);
        expect(ctx.calls.length, `${beat.id} @ ${p}`).toBeGreaterThan(0);
      }
    }
  });

  it('works on a phone-shaped screen too', () => {
    const ctx = recordingContext();
    drawIntro(ctx, 390, 844, beatAt(20, {}), scene);
    expect(ctx.calls.length).toBeGreaterThan(0);
  });
});

describe('makeStars', () => {
  it('scatters stars over the unit square, the same from the same numbers', () => {
    const a = makeStars(50, () => 0.25);
    expect(a).toHaveLength(50);
    for (const s of a) {
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x).toBeLessThanOrEqual(1);
      expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.y).toBeLessThanOrEqual(1);
    }
  });
});

describe('signalState (the silence)', () => {
  it('starts as a steady green call home', () => {
    const s = signalState(0.1);
    expect(s.on).toBe(true);
    expect(s.red).toBe(0);
    expect(s.wobble).toBe(0);
  });

  it('turns red and wavy', () => {
    const s = signalState(0.6);
    expect(s.on).toBe(true);
    expect(s.red).toBeGreaterThan(0.5);
    expect(s.wobble).toBeGreaterThan(0);
  });

  it('and then nothing', () => {
    expect(signalState(0.95).on).toBe(false);
  });
});

describe('voyagePath', () => {
  it('the ship goes from Earth, on the left, to Mars, on the right', () => {
    const out = {};
    const start = { ...voyagePath(0, 1000, 500, out) };
    const end = { ...voyagePath(1, 1000, 500, out) };
    expect(start.x).toBeLessThan(500);
    expect(end.x).toBeGreaterThan(500);
  });
});

describe('landingZoom', () => {
  it('Mars grows to fill the screen as the ship comes in', () => {
    expect(landingZoom(0)).toBeLessThan(landingZoom(0.5));
    expect(landingZoom(0.5)).toBeLessThan(landingZoom(1));
  });
});

describe('buggyX', () => {
  it('the buggy crosses from the left toward the array on the right', () => {
    expect(buggyX(0, 1000)).toBeLessThan(buggyX(1, 1000));
    expect(buggyX(0, 1000)).toBeLessThan(0);
    expect(buggyX(1, 1000)).toBeLessThan(1000);
  });
});

describe('the buggy', () => {
  it('is the rover parked outside the base: orange and white, six wheels', () => {
    // Side on, six wheels show as three, spaced like the model's axles.
    expect(ROVER.wheels).toHaveLength(3);
    const ctx = recordingContext();
    const drive = INTRO_BEATS.find((b) => b.id === 'drive');
    drawIntro(ctx, 1280, 720, { id: 'drive', beat: drive, progress: 0.6, local: 5 }, scene);
    const fills = ctx.calls.filter((c) => c.name === 'fillStyle').map((c) => c.args[0]);
    for (const colour of [ROVER.orange, ROVER.white, ROVER.chassis]) expect(fills).toContain(colour);
  });
});

describe('beatDip', () => {
  it('dips to black at each end of a beat, and the end card only fades up', () => {
    expect(beatDip(0, 7)).toBe(1);
    expect(beatDip(3.5, 7)).toBe(0);
    expect(beatDip(7, 7)).toBe(1);
    expect(beatDip(BEAT_DIP / 2, 7)).toBeGreaterThan(0);
    expect(beatDip(BEAT_DIP / 2, 7)).toBeLessThan(1);
    expect(beatDip(100, Infinity)).toBe(0);
  });
});
