import { describe, it, expect, vi } from 'vitest';
import { AirlockSound, AIRLOCK_SOUND } from './AirlockSound.js';
import { GameObject } from '../core/GameObject.js';

// ─────────────────────────────────────────────
// Built by hand: a stand-in airlock that only reports states, and a sound
// with THREE.Audio's surface. The component's job is deciding when the
// pressure release plays, not decoding it.
// ─────────────────────────────────────────────

function fakeSound() {
  const sound = {
    isPlaying: false,
    volume: 1,
    play: vi.fn(() => { sound.isPlaying = true; }),
    stop: vi.fn(() => { sound.isPlaying = false; }),
    setVolume: vi.fn(v => { sound.volume = v; }),
  };
  return sound;
}

function fakeAirlock(state = 'pressurised') {
  const listeners = new Set();
  return {
    state,
    onStateChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    go(next) { this.state = next; for (const fn of [...listeners]) fn(next); },
    listeners,
  };
}

function build({ inside = true, sound = fakeSound(), state } = {}) {
  const airlock = fakeAirlock(state);
  const where = { inside };
  const go = new GameObject('Ambience');
  const voice = go.addComponent(new AirlockSound({ airlock, sound, isInside: () => where.inside }));
  voice.onAwake();
  return { voice, airlock, sound, where };
}

const run = (voice, seconds) => {
  for (let i = 0; i < Math.round(seconds * 60); i++) voice.onUpdate(1 / 60);
};

describe('AirlockSound', () => {
  it('releases the pressure as both doors shut, on the way out', () => {
    const { airlock, sound } = build();
    expect(sound.play).not.toHaveBeenCalled();
    airlock.go('depressurising');
    expect(sound.play).toHaveBeenCalledTimes(1);
    expect(sound.volume).toBe(AIRLOCK_SOUND.volume);
  });

  it('…and on the way back in', () => {
    const { airlock, sound } = build({ state: 'depressurised' });
    airlock.go('pressurising');
    expect(sound.play).toHaveBeenCalledTimes(1);
  });

  it('plays once a cycle: not again when the door opens, nor on the next state', () => {
    const { voice, airlock, sound } = build();
    airlock.go('depressurising');
    run(voice, AIRLOCK_SOUND.audibleSeconds);
    airlock.go('depressurised');
    run(voice, 1);
    expect(sound.play).toHaveBeenCalledTimes(1);

    airlock.go('pressurising');
    expect(sound.play).toHaveBeenCalledTimes(2);
  });

  it('is not heard from outside the chamber: a cycle the player is not in', () => {
    // A retry takes the suit off with the player back at the spawn.
    const { airlock, sound } = build({ inside: false });
    airlock.go('pressurising');
    expect(sound.play).not.toHaveBeenCalled();
  });

  it('does not start over when the cycle turns back on itself', () => {
    const { voice, airlock, sound } = build();
    airlock.go('depressurising');
    run(voice, 1);
    airlock.go('pressurising');
    expect(sound.play).toHaveBeenCalledTimes(1);
    expect(sound.stop).not.toHaveBeenCalled();
  });

  it('restarts cleanly if it is somehow still sounding when the next cycle begins', () => {
    const { airlock, sound } = build();
    airlock.go('depressurising');
    airlock.go('depressurised');
    airlock.go('pressurising');
    expect(sound.stop).toHaveBeenCalled();
    expect(sound.play).toHaveBeenCalledTimes(2);
    expect(sound.volume).toBe(AIRLOCK_SOUND.volume);
  });

  it('fades out when a door opens while it is still sounding, rather than cutting', () => {
    // A cycle that turned back is shorter than the clip.
    const { voice, airlock, sound } = build();
    airlock.go('depressurising');
    run(voice, 1);
    airlock.go('pressurising');
    run(voice, 1);
    airlock.go('pressurised');

    run(voice, AIRLOCK_SOUND.fadeOut / 2);
    expect(sound.isPlaying).toBe(true);
    expect(sound.volume).toBeGreaterThan(0);
    expect(sound.volume).toBeLessThan(AIRLOCK_SOUND.volume);

    run(voice, AIRLOCK_SOUND.fadeOut);
    expect(sound.isPlaying).toBe(false);
  });

  it('holds its level for the whole cycle while the doors stay shut', () => {
    const { voice, airlock, sound } = build();
    airlock.go('depressurising');
    run(voice, AIRLOCK_SOUND.audibleSeconds - 0.1);
    expect(sound.volume).toBe(AIRLOCK_SOUND.volume);
    expect(sound.stop).not.toHaveBeenCalled();
  });

  it('carries on without a clip', () => {
    const { voice, airlock } = build({ sound: null });
    expect(() => { airlock.go('depressurising'); run(voice, 1); airlock.go('depressurised'); run(voice, 1); }).not.toThrow();
  });

  it('lets go of the airlock, and falls silent, when the scene is torn down', () => {
    const { voice, airlock, sound } = build();
    airlock.go('depressurising');
    voice.onDestroy();
    expect(sound.isPlaying).toBe(false);
    expect(airlock.listeners.size).toBe(0);
  });

  it('knows how long the clip is audible, for the cycle to match', () => {
    expect(AIRLOCK_SOUND.audibleSeconds).toBeGreaterThan(2.5);
    expect(AIRLOCK_SOUND.audibleSeconds).toBeLessThan(3.8);   // the file runs 3.76 s, its tail silent
    expect(AIRLOCK_SOUND.volume).toBeGreaterThan(0);
    expect(AIRLOCK_SOUND.volume).toBeLessThanOrEqual(1);
  });
});
