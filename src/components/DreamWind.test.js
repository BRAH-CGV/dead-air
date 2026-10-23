import { describe, it, expect, vi } from 'vitest';
import { DreamWind, DREAM_WIND } from './DreamWind.js';
import { AMBIENCE } from './Ambience.js';
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
  const walk = { state: 'walking', pullSpeed: 0 };
  const go = new GameObject('Dream');
  const sound = fakeSound();
  const wind = go.addComponent(new DreamWind({ walk, sound }));
  wind.onStart();
  return { wind, walk, sound };
}

const tick = (wind, seconds) => { for (let t = 0; t < seconds; t += 1 / 60) wind.onUpdate(1 / 60); };

describe('DreamWind', () => {
  it('is the wind outside the base', () => {
    expect(DREAM_WIND.key).toBe(AMBIENCE.outside);
  });

  it('silent while they walk', () => {
    const { wind, sound } = build();
    tick(wind, 2);
    expect(sound.play).not.toHaveBeenCalled();
  });

  it('dragged back, it rushes past: louder and higher the faster they fly', () => {
    const { wind, walk, sound } = build();
    walk.state = 'pulled';
    walk.pullSpeed = 2;
    tick(wind, 0.5);
    expect(sound.isPlaying).toBe(true);
    const slow = { volume: sound.volume, rate: sound.rate };
    walk.pullSpeed = DREAM_WIND.fullSpeed;
    tick(wind, 0.5);
    expect(sound.volume).toBeGreaterThan(slow.volume);
    expect(sound.rate).toBeGreaterThan(slow.rate);
    expect(sound.volume).toBeCloseTo(DREAM_WIND.volume);
  });

  it('awake, it dies away rather than cutting', () => {
    const { wind, walk, sound } = build();
    walk.state = 'pulled';
    walk.pullSpeed = DREAM_WIND.fullSpeed;
    tick(wind, 0.5);
    walk.state = 'awake';
    tick(wind, DREAM_WIND.fadeOut / 3);
    expect(sound.isPlaying).toBe(true);
    expect(sound.volume).toBeLessThan(DREAM_WIND.volume);
    tick(wind, DREAM_WIND.fadeOut);
    expect(sound.isPlaying).toBe(false);
  });

  it('pauses with the game', () => {
    const { wind, walk, sound } = build();
    walk.state = 'pulled';
    walk.pullSpeed = 5;
    tick(wind, 0.3);
    wind._onPause(true);
    expect(sound.pause).toHaveBeenCalled();
    wind._onPause(false);
    expect(sound.isPlaying).toBe(true);
  });
});
