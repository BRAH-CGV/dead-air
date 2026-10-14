import { describe, it, expect, vi } from 'vitest';
import { LoopVoice } from './LoopVoice.js';
import { GameObject } from '../core/GameObject.js';

function fakeSound() {
  const sound = {
    isPlaying: false,
    volume: 0,
    loop: false,
    play: vi.fn(() => { sound.isPlaying = true; }),
    pause: vi.fn(() => { sound.isPlaying = false; }),
    stop: vi.fn(() => { sound.isPlaying = false; }),
    setVolume: vi.fn((v) => { sound.volume = v; }),
    disconnect: vi.fn(),
  };
  return sound;
}

/** A host in a scene with an engine that can say when it pauses. */
function host() {
  const listeners = new Set();
  const engine = {
    onPauseChange: fn => { listeners.add(fn); return () => listeners.delete(fn); },
  };
  const go = new GameObject('Host');
  go.scene = { userData: { engine } };
  return { go, pause: paused => listeners.forEach(fn => fn(paused)), listeners };
}

const run = (voice, level, seconds = 3) => { for (let t = 0; t < seconds; t += 1 / 60) voice.set(level, 1 / 60); };

describe('LoopVoice', () => {
  it('is silent, and not playing, at level 0', () => {
    const sound = fakeSound();
    const voice = new LoopVoice({ sound });
    run(voice, 0, 1);
    expect(sound.play).not.toHaveBeenCalled();
  });

  it('eases up to the level instead of switching on, and starts the loop once', () => {
    const sound = fakeSound();
    const voice = new LoopVoice({ sound });
    voice.set(0.5, 1 / 60);
    expect(sound.volume).toBeGreaterThan(0);
    expect(sound.volume).toBeLessThan(0.1);
    run(voice, 0.5);
    expect(sound.volume).toBeCloseTo(0.5, 2);
    expect(sound.play).toHaveBeenCalledTimes(1);
  });

  it('follows a level that moves, up and down', () => {
    const sound = fakeSound();
    const voice = new LoopVoice({ sound });
    run(voice, 0.2);
    run(voice, 0.4);
    expect(sound.volume).toBeCloseTo(0.4, 2);
    run(voice, 0.1);
    expect(sound.volume).toBeCloseTo(0.1, 2);
  });

  it('fades out and stops the loop at level 0', () => {
    const sound = fakeSound();
    const voice = new LoopVoice({ sound });
    run(voice, 0.4);
    run(voice, 0);
    expect(sound.stop).toHaveBeenCalledTimes(1);
    expect(sound.isPlaying).toBe(false);
    run(voice, 0.4);
    expect(sound.play).toHaveBeenCalledTimes(2);   // wanted again: from its top
  });

  it('holds still while the game is paused, and carries on after', () => {
    const sound = fakeSound();
    const { go, pause } = host();
    const voice = new LoopVoice({ sound });
    const run_ = (level, seconds = 3) => { for (let t = 0; t < seconds; t += 1 / 60) voice.set(level, 1 / 60, go); };
    run_(0.4);
    pause(true);
    expect(sound.pause).toHaveBeenCalledTimes(1);
    pause(false);
    expect(sound.play).toHaveBeenCalledTimes(2);
    // Paused with nothing playing: resuming starts nothing.
    run_(0);
    sound.play.mockClear();
    pause(true);
    pause(false);
    expect(sound.play).not.toHaveBeenCalled();
  });

  it('builds a looping, unplaced sound from the asset cache, once there is an engine', () => {
    const voice = new LoopVoice({ key: 'sfx:hum' });
    expect(voice.set(0.3, 0.1, new GameObject('No engine'))).toBe(false);
    expect(voice.sound).toBeUndefined();   // not given up on
  });

  it('carries on with no sound at all, and disposes cleanly', () => {
    const none = new LoopVoice({ sound: null });
    expect(() => { run(none, 0.5); none.dispose(); }).not.toThrow();

    const sound = fakeSound();
    const { go, listeners } = host();
    const voice = new LoopVoice({ sound });
    for (let t = 0; t < 1; t += 1 / 60) voice.set(0.4, 1 / 60, go);
    voice.dispose();
    expect(sound.isPlaying).toBe(false);
    expect(sound.disconnect).toHaveBeenCalled();
    expect(listeners.size).toBe(0);
  });
});
