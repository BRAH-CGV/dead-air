import { describe, it, expect, vi } from 'vitest';
import { SatelliteSound, SATELLITE_SOUND } from './SatelliteSound.js';
import { GameObject } from '../core/GameObject.js';
import { ASSETS, PRELOAD } from '../assets/manifest.js';

// ─────────────────────────────────────────────
// Built by hand: a stand-in dish that only has the two velocities the
// component reads, and sounds with THREE.Audio's surface whose gain is a
// recording AudioParam. The component's job is deciding when the dish is
// moving and scheduling the fades, not decoding or playing anything.
// ─────────────────────────────────────────────

/** An AudioParam that remembers what was scheduled on it. */
function fakeParam() {
  const param = {
    value: 0,
    ramps: [],
    cancelScheduledValues: vi.fn(),
    setValueAtTime: vi.fn((v) => { param.value = v; }),
    linearRampToValueAtTime: vi.fn((v, t) => { param.ramps.push({ to: v, at: t }); param.value = v; }),
  };
  return param;
}

function fakeSound() {
  const sound = {
    isPlaying: false,
    volume: 1,
    context: { currentTime: 10 },
    gain: { gain: fakeParam() },
    play: vi.fn(() => { sound.isPlaying = true; }),
    stop: vi.fn(() => { sound.isPlaying = false; }),
    setVolume: vi.fn((v) => { sound.volume = v; }),
    disconnect: vi.fn(),
  };
  return sound;
}

function build({ sounds } = {}) {
  sounds ??= { loop: fakeSound(), ending: fakeSound() };
  const dish = new GameObject('Satellite');
  dish.velYaw = 0;
  dish.velPitch = 0;
  const voice = dish.addComponent(new SatelliteSound({ sounds }));
  voice.onStart();
  return { voice, dish, sounds, loop: sounds.loop, ending: sounds.ending, gain: sounds.loop?.gain.gain };
}

const tick = (voice, frames = 1) => { for (let i = 0; i < frames; i++) voice.onUpdate(1 / 60); };
const { startSpeed, stopSpeed, fade, loopVolume } = SATELLITE_SOUND;

describe('SatelliteSound', () => {
  it('is silent while the dish is still', () => {
    const { voice, loop, ending } = build();
    tick(voice, 30);
    expect(loop.play).not.toHaveBeenCalled();
    expect(ending.play).not.toHaveBeenCalled();
  });

  it('fades the loop in over about 30 ms as a movement starts', () => {
    const { voice, dish, loop, gain } = build();
    dish.velYaw = startSpeed * 2;
    tick(voice);

    expect(loop.play).toHaveBeenCalledTimes(1);
    expect(gain.ramps).toEqual([{ to: loopVolume, at: 10 + fade }]);
    // From where the gain is now, so nothing jumps.
    expect(gain.cancelScheduledValues).toHaveBeenCalledWith(10);
    expect(gain.setValueAtTime).toHaveBeenCalledWith(0, 10);
    expect(fade).toBeGreaterThanOrEqual(0.02);
    expect(fade).toBeLessThanOrEqual(0.05);
  });

  it('hears either axis: a tilt is a movement too', () => {
    const { voice, dish, loop } = build();
    dish.velPitch = -startSpeed * 2;   // tilting down
    tick(voice);
    expect(loop.play).toHaveBeenCalledTimes(1);
  });

  it('holds the loop through the movement without rescheduling it every frame', () => {
    const { voice, dish, gain } = build();
    dish.velYaw = startSpeed * 2;
    tick(voice, 60);
    expect(gain.ramps).toHaveLength(1);
  });

  it('fades the loop out over about 30 ms as the movement ends, and keeps it looping silent', () => {
    const { voice, dish, loop, gain } = build();
    dish.velYaw = startSpeed * 2;
    tick(voice, 30);
    loop.context.currentTime = 12;
    dish.velYaw = 0;
    tick(voice);

    expect(gain.ramps.at(-1)).toEqual({ to: 0, at: 12 + fade });
    // Not stopped: a cut would click, and the next movement fades the same
    // copy back up.
    expect(loop.stop).not.toHaveBeenCalled();
  });

  it('plays the ending once after each movement: the dish settling', () => {
    const { voice, dish, ending } = build();
    dish.velYaw = startSpeed * 2;
    tick(voice, 30);
    expect(ending.play).not.toHaveBeenCalled();

    dish.velYaw = 0;
    tick(voice, 30);
    expect(ending.play).toHaveBeenCalledTimes(1);
    expect(ending.volume).toBe(SATELLITE_SOUND.endingVolume);

    dish.velPitch = startSpeed * 2;
    tick(voice, 30);
    dish.velPitch = 0;
    tick(voice, 30);
    expect(ending.play).toHaveBeenCalledTimes(2);
  });

  it('starts the ending over if the last one is still sounding', () => {
    const { voice, dish, ending } = build();
    for (let i = 0; i < 2; i++) {
      dish.velYaw = startSpeed * 2;
      tick(voice);
      dish.velYaw = 0;
      tick(voice);
    }
    expect(ending.stop).toHaveBeenCalledTimes(1);
    expect(ending.play).toHaveBeenCalledTimes(2);
  });

  it('does not start and stop on a dish creeping at the threshold', () => {
    // It needs to be clearly moving to start, and clearly stopped to end.
    expect(stopSpeed).toBeLessThan(startSpeed);
    const { voice, dish, loop, ending } = build();
    const between = (startSpeed + stopSpeed) / 2;

    dish.velYaw = between;
    tick(voice, 10);
    expect(loop.play).not.toHaveBeenCalled();   // not enough to start

    dish.velYaw = startSpeed * 2;
    tick(voice);
    dish.velYaw = between;
    tick(voice, 10);
    expect(ending.play).not.toHaveBeenCalled();  // not slow enough to end
  });

  it('reports whether the dish is moving', () => {
    const { voice, dish } = build();
    expect(voice.moving).toBe(false);
    dish.velYaw = startSpeed * 2;
    tick(voice);
    expect(voice.moving).toBe(true);
    dish.velYaw = 0;
    tick(voice);
    expect(voice.moving).toBe(false);
  });

  it('carries on with no clips', () => {
    const { voice, dish } = build({ sounds: {} });
    expect(() => { dish.velYaw = 1; tick(voice, 5); dish.velYaw = 0; tick(voice, 5); }).not.toThrow();
  });

  it('falls silent and unhooks when the scene is torn down', () => {
    const { voice, dish, loop, ending } = build();
    dish.velYaw = startSpeed * 2;
    tick(voice);
    voice.onDestroy();
    expect(loop.isPlaying).toBe(false);
    expect(loop.disconnect).toHaveBeenCalled();
    expect(ending.disconnect).toHaveBeenCalled();
  });

  it('uses two small clips that are ready before the first movement', () => {
    for (const key of [SATELLITE_SOUND.loop, SATELLITE_SOUND.ending]) {
      expect(ASSETS[key], key).toMatchObject({ type: 'audio' });
      expect(PRELOAD, key).toContain(key);
    }
  });
});
