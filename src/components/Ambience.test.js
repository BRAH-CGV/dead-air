import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { Ambience, AMBIENCE, blendLoopSeam } from './Ambience.js';
import { AmbienceMix } from '../systems/AmbienceMix.js';
import { GameObject } from '../core/GameObject.js';

// ─────────────────────────────────────────────
// Built by hand, as SuitVisor's tests are: jsdom has no Web Audio, and the
// component's job is deciding how loud each loop is, not decoding it. The
// sounds are stand-ins with THREE.Audio's surface.
// ─────────────────────────────────────────────

const MUSIC = 'music';

function fakeSound() {
  const sound = {
    isPlaying: false,
    volume: 1,
    play: vi.fn(() => { sound.isPlaying = true; }),
    stop: vi.fn(() => { sound.isPlaying = false; }),
    setVolume: vi.fn(v => { sound.volume = v; }),
    disconnect: vi.fn(),
  };
  return sound;
}

const box = (x0, x1) => new THREE.Box3(new THREE.Vector3(x0, 0, -2), new THREE.Vector3(x1, 3, 2));

/** office [0,6] ── passage [6,10] ── server [10,16], ears at `ear`. */
function build({ sounds, x = 3, volumes, testKeys } = {}) {
  const ear = new THREE.Vector3(x, 1, 0);
  const mix = new AmbienceMix({
    zones: [{ box: box(0, 6), track: 'centre' }, { box: box(10, 16), track: 'server' }],
    passages: [{ box: box(6, 10), axis: 'x' }],
  });
  sounds ??= { centre: fakeSound(), server: fakeSound(), [MUSIC]: fakeSound() };
  const go = new GameObject('Ambience');
  const ambience = go.addComponent(new Ambience({
    mix, music: MUSIC, sounds, volumes, testKeys,
    listenerPosition: out => out.copy(ear),
  }));
  ambience.onStart();
  return { ambience, sounds, ear };
}

function run(ambience, seconds) {
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps; i++) ambience.onUpdate(1 / 60);
}

describe('Ambience rooms', () => {
  it('fades the room you start in up from silence', () => {
    const { ambience, sounds } = build();
    ambience.onUpdate(1 / 60);
    expect(sounds.centre.isPlaying).toBe(true);
    expect(sounds.centre.volume).toBeGreaterThan(0);
    expect(sounds.centre.volume).toBeLessThan(0.2);

    run(ambience, 3);
    expect(sounds.centre.volume).toBeCloseTo(1);
  });

  it('leaves the rooms you are not in stopped', () => {
    const { ambience, sounds } = build();
    run(ambience, 3);
    expect(sounds.server.play).not.toHaveBeenCalled();
    expect(sounds.server.isPlaying).toBe(false);
  });

  it('plays both rooms in the passage between them', () => {
    const { ambience, sounds, ear } = build();
    run(ambience, 3);
    ear.x = 8;
    run(ambience, 3);
    expect(sounds.centre.volume).toBeCloseTo(Math.SQRT1_2);
    expect(sounds.server.volume).toBeCloseTo(Math.SQRT1_2);
  });

  it('stops a room once you have walked out of earshot', () => {
    const { ambience, sounds, ear } = build();
    run(ambience, 3);
    ear.x = 13;
    run(ambience, 5);
    expect(sounds.centre.isPlaying).toBe(false);
    expect(sounds.server.volume).toBeCloseTo(1);
  });

  it('eases over a teleport instead of cutting', () => {
    const { ambience, sounds, ear } = build();
    run(ambience, 3);
    ear.x = 13;
    ambience.onUpdate(1 / 60);
    expect(sounds.centre.volume).toBeGreaterThan(0.8);
    expect(sounds.server.volume).toBeLessThan(0.2);
  });

  it('never plays a room louder than its clip was mixed', () => {
    const { ambience, sounds, ear } = build();
    for (const x of [3, 7, 8, 9, 13, 3]) {
      ear.x = x;
      run(ambience, 1);
      expect(sounds.centre.volume).toBeLessThanOrEqual(1);
      expect(sounds.server.volume).toBeLessThanOrEqual(1);
    }
  });

  it('lifts a room by its own volume trim, and only that room', () => {
    const { ambience, sounds, ear } = build({ volumes: { centre: 1.5 } });
    run(ambience, 3);
    expect(sounds.centre.volume).toBeCloseTo(1.5);

    // The trim rides the crossfade…
    ear.x = 8;
    run(ambience, 3);
    expect(sounds.centre.volume).toBeCloseTo(1.5 * Math.SQRT1_2);
    expect(sounds.server.volume).toBeCloseTo(Math.SQRT1_2);

    // …and leaves the other room and the music at their own level.
    ear.x = 13;
    ambience.setTension(1);
    run(ambience, 20);
    expect(sounds.server.volume).toBeCloseTo(1);
    expect(sounds[MUSIC].volume).toBe(1);
  });

  it('trims the office loop up a little, and no other room', () => {
    expect(AMBIENCE.volumes[AMBIENCE.rooms.MainOffice]).toBeGreaterThan(1);
    expect(AMBIENCE.volumes[AMBIENCE.rooms.ServerRoom]).toBeUndefined();
    expect(AMBIENCE.volumes[AMBIENCE.rooms.LivingQuarters]).toBeUndefined();
  });

  it('never plays the music above the level its clip was mixed at', () => {
    expect(AMBIENCE.volumes[AMBIENCE.music] ?? 1).toBeLessThanOrEqual(1);
  });

  it('carries on without a clip that failed to load', () => {
    const { ambience, sounds } = build({ sounds: { centre: fakeSound() } });
    expect(() => run(ambience, 1)).not.toThrow();
    expect(sounds.centre.isPlaying).toBe(true);
  });
});

describe('Ambience tension music', () => {
  it('is silent until something raises the tension', () => {
    const { ambience, sounds } = build();
    run(ambience, 5);
    expect(sounds[MUSIC].play).not.toHaveBeenCalled();
    expect(ambience.tension).toBe(0);
  });

  it('creeps in over musicFadeIn rather than starting', () => {
    const { ambience, sounds } = build();
    ambience.setTension(1);
    run(ambience, AMBIENCE.musicFadeIn / 2);
    expect(sounds[MUSIC].isPlaying).toBe(true);
    expect(sounds[MUSIC].volume).toBeCloseTo(0.5, 1);

    run(ambience, AMBIENCE.musicFadeIn);
    expect(sounds[MUSIC].volume).toBeCloseTo(1);
  });

  it('never goes above the level the clip was mixed at', () => {
    const { ambience, sounds } = build();
    ambience.setTension(7);
    run(ambience, 20);
    expect(ambience.tension).toBe(1);
    expect(sounds[MUSIC].volume).toBe(1);
  });

  it('holds at a partial tension', () => {
    const { ambience, sounds } = build();
    ambience.setTension(0.4);
    run(ambience, 20);
    expect(sounds[MUSIC].volume).toBeCloseTo(0.4);
  });

  it('creeps out over musicFadeOut, then stops', () => {
    const { ambience, sounds } = build();
    ambience.setTension(1);
    run(ambience, 20);

    ambience.setTension(0);
    run(ambience, AMBIENCE.musicFadeOut / 2);
    expect(sounds[MUSIC].isPlaying).toBe(true);
    expect(sounds[MUSIC].volume).toBeCloseTo(0.5, 1);

    run(ambience, AMBIENCE.musicFadeOut);
    expect(sounds[MUSIC].isPlaying).toBe(false);
  });

  it('follows the most tense of several sources', () => {
    const { ambience } = build();
    ambience.setTension(0.3, 'stalker');
    ambience.setTension(0.8, 'window');
    expect(ambience.tension).toBe(0.8);

    ambience.setTension(0, 'window');
    expect(ambience.tension).toBe(0.3);

    ambience.setTension(0, 'stalker');
    expect(ambience.tension).toBe(0);
  });

  it('drops every source at once with clearTension', () => {
    const { ambience } = build();
    ambience.setTension(0.3, 'stalker');
    ambience.setTension(0.8, 'window');
    ambience.clearTension();
    expect(ambience.tension).toBe(0);
  });

  it('leaves the room ambience alone', () => {
    const { ambience, sounds } = build();
    ambience.setTension(1);
    run(ambience, 20);
    expect(sounds.centre.volume).toBeCloseTo(1);
  });
});

describe('Ambience test keys', () => {
  // Testing only: there is nothing on this branch to raise the tension yet,
  // and two candidate tracks to compare.
  const TRIAL = 'trial';

  function buildWithKeys() {
    const sounds = { centre: fakeSound(), server: fakeSound(), [MUSIC]: fakeSound(), [TRIAL]: fakeSound() };
    return build({ sounds, testKeys: { KeyM: MUSIC, Comma: TRIAL } });
  }

  it('swings a key\'s track in on one press and back out on the next', () => {
    const { ambience, sounds } = buildWithKeys();
    ambience.onKeyDown({ code: 'KeyM' });
    expect(ambience.tension).toBe(1);
    run(ambience, 20);
    expect(sounds[MUSIC].volume).toBe(1);
    expect(sounds[TRIAL].play).not.toHaveBeenCalled();

    ambience.onKeyDown({ code: 'KeyM' });
    expect(ambience.tension).toBe(0);
    run(ambience, 20);
    expect(sounds[MUSIC].isPlaying).toBe(false);
  });

  it('plays the other track on the other key', () => {
    const { ambience, sounds } = buildWithKeys();
    ambience.onKeyDown({ code: 'Comma' });
    run(ambience, 20);
    expect(sounds[TRIAL].isPlaying).toBe(true);
    expect(sounds[TRIAL].volume).toBe(1);
    expect(sounds[MUSIC].play).not.toHaveBeenCalled();
  });

  it('crossfades from one track to the other when the keys are swapped', () => {
    const { ambience, sounds } = buildWithKeys();
    ambience.onKeyDown({ code: 'KeyM' });
    run(ambience, 20);

    ambience.onKeyDown({ code: 'Comma' });
    expect(ambience.tension).toBe(1);
    run(ambience, 1);
    expect(sounds[MUSIC].isPlaying).toBe(true);
    expect(sounds[MUSIC].volume).toBeLessThan(1);
    expect(sounds[TRIAL].volume).toBeGreaterThan(0);

    run(ambience, 20);
    expect(sounds[MUSIC].isPlaying).toBe(false);
    expect(sounds[TRIAL].volume).toBe(1);

    // The key of the track now playing is the one that lets go.
    ambience.onKeyDown({ code: 'Comma' });
    expect(ambience.tension).toBe(0);
  });

  it('ignores other keys, and a key held down', () => {
    const { ambience } = buildWithKeys();
    ambience.onKeyDown({ code: 'KeyN' });
    expect(ambience.tension).toBe(0);

    ambience.onKeyDown({ code: 'KeyM' });
    ambience.onKeyDown({ code: 'KeyM', repeat: true });
    expect(ambience.tension).toBe(1);
  });

  it('leaves a real threat holding its own tension', () => {
    const { ambience } = buildWithKeys();
    ambience.setTension(0.5, 'stalker');
    ambience.onKeyDown({ code: 'KeyM' });
    expect(ambience.tension).toBe(1);
    ambience.onKeyDown({ code: 'KeyM' });
    expect(ambience.tension).toBe(0.5);
  });

  it('does nothing without test keys', () => {
    const { ambience } = build();
    ambience.onKeyDown({ code: 'KeyM' });
    expect(ambience.tension).toBe(0);
  });

  it('keeps the real tension music as the one a threat raises', () => {
    expect(AMBIENCE.music).toBe('sfx:interior-base-spooky-music');
  });
});

describe('Ambience teardown', () => {
  it('stops and unhooks every sound', () => {
    const { ambience, sounds } = build();
    ambience.setTension(1);
    run(ambience, 2);
    ambience.onDestroy();
    for (const sound of Object.values(sounds)) {
      expect(sound.isPlaying).toBe(false);
      expect(sound.disconnect).toHaveBeenCalled();
    }
  });
});

describe('blendLoopSeam', () => {
  const RATE = 1000;
  const ramp = n => Float32Array.from({ length: n }, (_, i) => i / n);

  it('returns where the loop should restart: one fade in from the start', () => {
    expect(blendLoopSeam([ramp(2000)], RATE, 0.1)).toBeCloseTo(0.1);
  });

  it('ends the clip on the sample before the restart point, so the wrap is continuous', () => {
    const data = ramp(2000);
    const original = data.slice();
    blendLoopSeam([data], RATE, 0.1);
    // Loops from sample 100; the last sample has become sample 99.
    expect(data[1999]).toBeCloseTo(original[99]);
  });

  it('changes nothing before the fade', () => {
    const data = ramp(2000);
    const original = data.slice();
    blendLoopSeam([data], RATE, 0.1);
    expect(Array.from(data.subarray(0, 1900))).toEqual(Array.from(original.subarray(0, 1900)));
    // …and the fade starts from the clip's own tail.
    expect(data[1900]).toBeCloseTo(original[1900], 1);
  });

  it('fades every channel', () => {
    const left = ramp(2000), right = ramp(2000).map(v => -v);
    blendLoopSeam([left, right], RATE, 0.1);
    expect(right[1999]).toBeCloseTo(-left[1999]);
  });

  it('leaves a clip too short to fade alone', () => {
    const data = ramp(150);
    const original = data.slice();
    expect(blendLoopSeam([data], RATE, 0.1)).toBe(0);
    expect(Array.from(data)).toEqual(Array.from(original));
  });
});
