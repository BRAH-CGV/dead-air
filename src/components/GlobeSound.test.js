import { describe, it, expect, vi } from 'vitest';
import { GlobeSound, GLOBE_SOUND, boomBuffer } from './GlobeSound.js';
import { GlobeSpin } from './GlobeSpin.js';
import { GameObject } from '../core/GameObject.js';
import { ASSETS } from '../assets/manifest.js';

function fakeSound() {
  const sound = {
    isPlaying: false, volume: 0, offset: 0,
    play: vi.fn(() => { sound.isPlaying = true; }),
    stop: vi.fn(() => { sound.isPlaying = false; }),
    setVolume: vi.fn((v) => { sound.volume = v; }),
    setPlaybackRate: vi.fn(),
    disconnect: vi.fn(),
    removeFromParent: vi.fn(),
  };
  return sound;
}

function build() {
  const globe = new GameObject('Globe');
  const spin = globe.addComponent(new GlobeSpin());
  const voices = Array.from({ length: GLOBE_SOUND.voices }, fakeSound);
  const sound = globe.addComponent(new GlobeSound({ voices }));
  sound.onStart();
  return { spin, sound, voices };
}

const run = (g, seconds) => {
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    g.spin.onUpdate(1 / 60);
    g.sound.onUpdate(1 / 60);
  }
};
/** A press of E: the push, then a frame. */
const push = g => {
  g.spin.onInteract({});
  run(g, 1 / 60);
};
const plays = g => g.voices.reduce((n, v) => n + v.play.mock.calls.length, 0);

describe('GlobeSound', () => {
  it('its clip is in the manifest', () => {
    expect(ASSETS[GLOBE_SOUND.key]).toMatchObject({ type: 'audio' });
  });

  it('silent until the globe is pushed', () => {
    const g = build();
    run(g, 1);
    expect(plays(g)).toBe(0);
  });

  it('a push plays the spin, whole and as it is: from its top, at its own pitch', () => {
    const g = build();
    push(g);
    expect(plays(g)).toBe(1);
    expect(g.voices[0].offset).toBe(0);
    expect(g.voices[0].volume).toBe(GLOBE_SOUND.volume);
    run(g, 2);
    expect(plays(g)).toBe(1);   // once: nothing looped or repeated
    for (const v of g.voices) expect(v.setPlaybackRate).not.toHaveBeenCalled();
  });

  it('pushed again while it spins: a fresh push on its own voice, the last one let go rather than cut', () => {
    const g = build();
    push(g);
    run(g, 0.5);
    push(g);
    expect(plays(g)).toBe(2);
    expect(g.voices[1].play).toHaveBeenCalled();
    expect(g.voices[0].stop).toHaveBeenCalled();          // faded out, then stopped
    expect(g.voices[1].isPlaying).toBe(true);
  });

  it('flowing, not choppy: a push while it still sounds carries on from just past the slap, the old one lingering under it', () => {
    const g = build();
    push(g);
    expect(g.voices[0].offset).toBe(0);                  // from rest: the whole spin, slap and all
    run(g, 0.5);
    push(g);
    expect(g.voices[1].offset).toBe(GLOBE_SOUND.flowOffset);
    expect(GLOBE_SOUND.flowOffset).toBeGreaterThan(GLOBE_SOUND.slapAt);   // the slap left out
    expect(GLOBE_SOUND.release).toBeGreaterThanOrEqual(0.4);
    expect(GLOBE_SOUND.swell).toBeGreaterThan(0);
  });

  it('a touch quieter than the recording', () => {
    expect(GLOBE_SOUND.volume).toBeLessThan(1);
  });

  it('mashed, it doesn\'t stutter: presses closer together than `minGap` add no new push sound', () => {
    const g = build();
    push(g);
    push(g);
    push(g);
    expect(plays(g)).toBe(1);
    run(g, GLOBE_SOUND.minGap);
    push(g);
    expect(plays(g)).toBe(2);
  });

  it('a press at full speed (the globe can go no faster) still sounds the hand on it', () => {
    const g = build();
    for (let i = 0; i < 6; i++) { push(g); run(g, 0.2); }
    expect(g.spin.speed).toBeGreaterThan(0);
    expect(plays(g)).toBe(6);
  });

  it('a pause silences it', () => {
    const g = build();
    push(g);
    g.sound._onPause(true);
    expect(g.voices.every(v => !v.isPlaying)).toBe(true);
  });
});

describe('GlobeSound — the pop as it turns to cheese (#169)', () => {
  function buildWithPop() {
    const globe = new GameObject('Globe');
    const spin = globe.addComponent(new GlobeSpin());
    const voices = Array.from({ length: GLOBE_SOUND.voices }, fakeSound);
    const pop = fakeSound();
    const sound = globe.addComponent(new GlobeSound({ voices, pop }));
    sound.onStart();
    return { spin, sound, voices, pop };
  }

  it('its clip is in the manifest', () => {
    expect(ASSETS[GLOBE_SOUND.pop.key]).toMatchObject({ type: 'audio', url: 'assets/audio/pop.mp3' });
  });

  it('pops once, at its level, the moment the globe becomes cheese, and never again', () => {
    const g = buildWithPop();
    for (let i = 0; i < 80 && !g.spin.cheese; i++) { push(g); run(g, 1 / 8); }
    expect(g.spin.cheese).toBe(true);
    expect(g.pop.play).toHaveBeenCalledTimes(1);
    expect(g.pop.volume).toBe(GLOBE_SOUND.pop.volume);
    for (let i = 0; i < 40; i++) { push(g); run(g, 1 / 8); }
    expect(g.pop.play).toHaveBeenCalledTimes(1);
  });

  it('no pop for an ordinary spin', () => {
    const g = buildWithPop();
    push(g);
    run(g, 3);
    expect(g.pop.play).not.toHaveBeenCalled();
  });

  it('stops the pop on a pause and lets it go when torn down', () => {
    const g = buildWithPop();
    g.pop.isPlaying = true;
    g.sound._onPause(true);
    expect(g.pop.stop).toHaveBeenCalled();
    g.sound.onDestroy();
    expect(g.pop.disconnect).toHaveBeenCalled();
  });
});

describe('GlobeSound — the boom as the cheese goes off', () => {
  function buildWithBoom() {
    const globe = new GameObject('Globe');
    const spin = globe.addComponent(new GlobeSpin({ screenPoof: () => {}, screenFlash: () => {} }));
    const voices = Array.from({ length: GLOBE_SOUND.voices }, fakeSound);
    const pop = fakeSound();
    const boom = fakeSound();
    const sound = globe.addComponent(new GlobeSound({ voices, pop, boom }));
    sound.onStart();
    return { spin, sound, voices, pop, boom };
  }

  it('booms once, at its level, the moment it goes off, everything else cut', () => {
    const g = buildWithBoom();
    for (let i = 0; i < 200 && !g.spin.blasted; i++) { push(g); run(g, 1 / 8); }
    expect(g.spin.blasted).toBe(true);
    expect(g.boom.play).toHaveBeenCalledTimes(1);
    expect(g.boom.volume).toBe(GLOBE_SOUND.boom.volume);
    expect(g.voices.every(v => !v.isPlaying)).toBe(true);
    run(g, 3);
    expect(g.boom.play).toHaveBeenCalledTimes(1);
  });

  it('no boom for the cheese spun a little', () => {
    const g = buildWithBoom();
    for (let i = 0; i < 80 && !g.spin.cheese; i++) { push(g); run(g, 1 / 8); }
    push(g);
    run(g, 3);
    expect(g.boom.play).not.toHaveBeenCalled();
  });

  it('stops the boom on a pause and lets it go when torn down', () => {
    const g = buildWithBoom();
    g.boom.isPlaying = true;
    g.sound._onPause(true);
    expect(g.boom.stop).toHaveBeenCalled();
    g.sound.onDestroy();
    expect(g.boom.disconnect).toHaveBeenCalled();
  });

  it('is made, not loaded: loud from the first instant, dying away, never clipping, the same every time', () => {
    const sampleRate = 8000;
    const context = {
      sampleRate,
      createBuffer: (channels, length, rate) => {
        const data = new Float32Array(length);
        return { length, sampleRate: rate, numberOfChannels: channels, getChannelData: () => data };
      },
    };
    const data = boomBuffer(context, { seconds: 2 }).getChannelData(0);
    expect(data.length).toBe(2 * sampleRate);
    const peak = (from, to) => data.subarray(from * sampleRate, to * sampleRate).reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    expect(peak(0, 0.2)).toBeGreaterThan(0.6);
    expect(peak(1.6, 2)).toBeLessThan(peak(0, 0.2) / 4);
    expect(peak(0, 2)).toBeLessThanOrEqual(1);
    expect(boomBuffer(context, { seconds: 2 }).getChannelData(0)).toEqual(data);
  });
});
