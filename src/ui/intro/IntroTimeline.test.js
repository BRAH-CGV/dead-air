import { describe, it, expect } from 'vitest';
import {
  INTRO_BEATS, INTRO_SECONDS, beatAt, captionAlpha, arrayLabel, captionFor, CAPTION_FADE,
} from './IntroTimeline.js';

// ─────────────────────────────────────────────
// IntroTimeline — the intro's beats, in order, against the clock
// ─────────────────────────────────────────────

describe('INTRO_BEATS', () => {
  it('tells the story in order: Earth, the colony, the silence, the sky, your ship, the landing, the drive', () => {
    expect(INTRO_BEATS.map(b => b.id)).toEqual([
      'voyage', 'colony', 'silence', 'sky', 'ship', 'landing', 'drive', 'begin',
    ]);
  });

  it('every beat but the last has a length and a caption; the last holds until clicked', () => {
    for (const beat of INTRO_BEATS.slice(0, -1)) {
      expect(beat.seconds, beat.id).toBeGreaterThan(0);
      expect(Number.isFinite(beat.seconds), beat.id).toBe(true);
      expect(beat.caption.length, beat.id).toBeGreaterThan(0);
    }
    expect(INTRO_BEATS.at(-1).seconds).toBe(Infinity);
  });

  it('runs about a minute before the end card', () => {
    expect(INTRO_SECONDS).toBeGreaterThan(40);
    expect(INTRO_SECONDS).toBeLessThan(75);
  });
});

describe('beatAt', () => {
  it('finds the beat and how far into it the clock is', () => {
    const out = {};
    expect(beatAt(0, out)).toBe(out);
    expect(out.id).toBe('voyage');
    expect(out.index).toBe(0);
    expect(out.local).toBe(0);
    expect(out.progress).toBe(0);

    const first = INTRO_BEATS[0].seconds;
    beatAt(first + 1, out);
    expect(out.id).toBe('colony');
    expect(out.local).toBeCloseTo(1);
    expect(out.progress).toBeCloseTo(1 / INTRO_BEATS[1].seconds);
  });

  it('past the end it sits on the end card', () => {
    const out = beatAt(INTRO_SECONDS + 100, {});
    expect(out.id).toBe('begin');
    expect(out.local).toBeCloseTo(100);
    expect(out.progress).toBe(1);
  });

  it('before the start it is the first beat', () => {
    expect(beatAt(-3, {}).id).toBe('voyage');
  });
});

describe('captionAlpha', () => {
  it('fades in, holds, and fades out before the beat ends', () => {
    expect(captionAlpha(0, 6)).toBe(0);
    expect(captionAlpha(CAPTION_FADE / 2, 6)).toBeCloseTo(0.5);
    expect(captionAlpha(3, 6)).toBe(1);
    expect(captionAlpha(6 - CAPTION_FADE / 2, 6)).toBeCloseTo(0.5);
    expect(captionAlpha(6, 6)).toBe(0);
  });

  it('a beat held forever only fades in', () => {
    expect(captionAlpha(0, Infinity)).toBe(0);
    expect(captionAlpha(100, Infinity)).toBe(1);
  });
});

describe('arrayLabel', () => {
  it('names an array and its coordinates, from the random numbers it is given', () => {
    const label = arrayLabel(() => 0.5);
    expect(label).toMatch(/^ARRAY [A-Z]-\d{2} · \d{1,2}\.\d°[NS] \d{1,3}\.\d°[EW]$/);
  });

  it('is different with different numbers', () => {
    expect(arrayLabel(() => 0.1)).not.toBe(arrayLabel(() => 0.9));
  });
});

describe('captionFor', () => {
  it('fills the array into the landing caption', () => {
    const landing = INTRO_BEATS.find(b => b.id === 'landing');
    expect(landing.caption).toContain('{array}');
    expect(captionFor(landing, 'ARRAY K-17')).toContain('ARRAY K-17');
    expect(captionFor(landing, 'ARRAY K-17')).not.toContain('{array}');
  });
});
