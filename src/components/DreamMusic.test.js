import { describe, it, expect, vi } from 'vitest';
import { DreamMusic, DREAM_MUSIC } from './DreamMusic.js';
import { AMBIENCE } from './Ambience.js';
import { GameObject } from '../core/GameObject.js';

function fakeSound() {
  const sound = {
    isPlaying: false, volume: 0,
    play: vi.fn(() => { sound.isPlaying = true; }),
    stop: vi.fn(() => { sound.isPlaying = false; }),
    pause: vi.fn(() => { sound.isPlaying = false; }),
    setVolume: vi.fn((v) => { sound.volume = v; }),
    disconnect: vi.fn(),
  };
  return sound;
}

function build() {
  const go = new GameObject('Dream');
  const sound = fakeSound();
  const music = go.addComponent(new DreamMusic({ sound }));
  music.onStart();
  return { music, sound };
}

const tick = (music, seconds) => { for (let t = 0; t < seconds; t += 1 / 60) music.onUpdate(1 / 60); };

describe('DreamMusic', () => {
  it('is the base\'s spooky music', () => {
    expect(DREAM_MUSIC.key).toBe(AMBIENCE.music);
  });

  it('creeps in as the dream starts, from nothing to its level', () => {
    const { music, sound } = build();
    tick(music, 1 / 60);
    expect(sound.play).toHaveBeenCalledTimes(1);
    expect(sound.volume).toBeLessThan(DREAM_MUSIC.volume * 0.1);
    tick(music, DREAM_MUSIC.fadeIn / 2);
    expect(sound.volume).toBeGreaterThan(0);
    expect(sound.volume).toBeLessThan(DREAM_MUSIC.volume);
    tick(music, DREAM_MUSIC.fadeIn);
    expect(sound.volume).toBeCloseTo(DREAM_MUSIC.volume);
    expect(sound.play).toHaveBeenCalledTimes(1);
  });

  it('any loop can go under a dream: its own track and level', () => {
    const go = new GameObject('Dream');
    const sound = fakeSound();
    const loop = go.addComponent(new DreamMusic({ sound, key: AMBIENCE.outside, volume: 0.3 }));
    loop.onStart();
    tick(loop, DREAM_MUSIC.fadeIn + 1);
    expect(loop.key).toBe(AMBIENCE.outside);
    expect(sound.volume).toBeCloseTo(0.3);
  });

  it('pauses with the game and carries on after', () => {
    const { music, sound } = build();
    tick(music, 1);
    music._onPause(true);
    expect(sound.pause).toHaveBeenCalled();
    music._onPause(false);
    expect(sound.isPlaying).toBe(true);
  });

  it('stops when the dream ends', () => {
    const { music, sound } = build();
    tick(music, 1);
    music.onDestroy();
    expect(sound.isPlaying).toBe(false);
  });
});
