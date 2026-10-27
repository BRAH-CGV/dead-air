import { describe, it, expect, vi } from 'vitest';
import { BuggySound, BUGGY_SOUND } from './BuggySound.js';
import { BUGGY_DEPARTURE } from '../gameplay/BuggyDeparture.js';
import { GameObject } from '../core/GameObject.js';

function fakeSound() {
  const sound = {
    isPlaying: false, volume: 0, rate: 1,
    play: vi.fn(() => { sound.isPlaying = true; }),
    stop: vi.fn(() => { sound.isPlaying = false; }),
    pause: vi.fn(() => { sound.isPlaying = false; }),
    setVolume: vi.fn((v) => { sound.volume = v; }),
    setPlaybackRate: vi.fn((r) => { sound.rate = r; }),
    disconnect: vi.fn(),
  };
  return sound;
}

function build() {
  const logic = { phase: 'idle', speed: 0, wantsFade: false };
  const sendOff = { logic, get active() { return logic.phase === 'closing' || logic.phase === 'driving'; } };
  const sound = fakeSound(), sand = fakeSound();
  const go = new GameObject('GameplaySystems');
  const voice = go.addComponent(new BuggySound({ sendOff, sound, sand }));
  voice.onStart();
  return { voice, logic, sound, sand };
}

const tick = (voice, seconds, dt = 1 / 60) => { for (let t = 0; t < seconds; t += dt) voice.onUpdate(dt); };

describe('BuggySound', () => {
  it('silent while the buggy is parked', () => {
    const { voice, sound } = build();
    tick(voice, 2);
    expect(sound.play).not.toHaveBeenCalled();
  });

  it('wakes as the lid shuts: a soft idle hum, rising from nothing', () => {
    const { voice, logic, sound } = build();
    logic.phase = 'closing';
    tick(voice, 0.05);
    expect(sound.play).toHaveBeenCalledTimes(1);
    const early = sound.volume;
    tick(voice, 1);
    expect(sound.volume).toBeGreaterThan(early);
    expect(sound.volume).toBeLessThan(BUGGY_SOUND.volume);
  });

  it('driving off, it swells and its whine climbs with the speed: an electric motor, not gears', () => {
    const { voice, logic, sound } = build();
    logic.phase = 'driving';
    logic.speed = 0.5;
    tick(voice, 2);
    const slow = { volume: sound.volume, rate: sound.rate };
    logic.speed = BUGGY_DEPARTURE.speed;
    tick(voice, 2);
    expect(sound.volume).toBeGreaterThan(slow.volume);
    expect(sound.rate).toBeGreaterThan(slow.rate);
    expect(sound.rate).toBeCloseTo(BUGGY_SOUND.rate[1], 2);
  });

  it('fades out with the screen, and stops once it has gone', () => {
    const { voice, logic, sound } = build();
    logic.phase = 'driving';
    logic.speed = BUGGY_DEPARTURE.speed;
    tick(voice, 2);
    const full = sound.volume;
    logic.wantsFade = true;
    tick(voice, 0.4);
    expect(sound.volume).toBeLessThan(full);
    expect(sound.stop).not.toHaveBeenCalled();
    logic.phase = 'gone';
    tick(voice, 0.05);
    expect(sound.stop).toHaveBeenCalled();
  });

  it('a bit quieter than it was', () => {
    expect(BUGGY_SOUND.volume).toBeLessThan(0.45);
  });

  it('the sand under the wheels: the window\'s sand, slowed and muffled to tyres on dust', () => {
    expect(BUGGY_SOUND.sandKey).toBe('sfx:window-sand');
    expect(BUGGY_SOUND.sandRate[1]).toBeLessThan(1);
    expect(BUGGY_SOUND.sandFilter.lowpass).toBeLessThan(2000);
  });

  it('the sand is heard as it moves: none standing, more with the speed, under the hum', () => {
    const { voice, logic, sand, sound } = build();
    logic.phase = 'closing';
    tick(voice, 1);
    expect(sand.volume).toBe(0);
    logic.phase = 'driving';
    logic.speed = 1;
    tick(voice, 2);
    const slow = { volume: sand.volume, rate: sand.rate };
    expect(slow.volume).toBeGreaterThan(0);
    logic.speed = BUGGY_DEPARTURE.speed;
    tick(voice, 2);
    expect(sand.volume).toBeGreaterThan(slow.volume);
    expect(sand.rate).toBeGreaterThan(slow.rate);
    expect(sand.volume).toBeLessThan(sound.volume);
    logic.phase = 'gone';
    tick(voice, 0.05);
    expect(sand.isPlaying).toBe(false);
  });

  it('pauses with the game and carries on after', () => {
    const { voice, logic, sound } = build();
    logic.phase = 'driving';
    logic.speed = 3;
    tick(voice, 1);
    voice._onPause(true);
    expect(sound.pause).toHaveBeenCalled();
    voice._onPause(false);
    expect(sound.play).toHaveBeenCalledTimes(2);
  });
});
