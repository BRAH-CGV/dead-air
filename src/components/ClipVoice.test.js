import { describe, it, expect, vi } from 'vitest';
import { ClipVoice, clipSet, pickClip } from './ClipVoice.js';
import { GameObject } from '../core/GameObject.js';

// ─────────────────────────────────────────────
// A sound with THREE.Audio's surface, and an engine that only has an asset
// cache. The voice's job is choosing a clip and deciding whether it can be
// played at all, not decoding or playing anything.
// ─────────────────────────────────────────────

function fakeSound() {
  const sound = {
    isPlaying: false,
    volume: 1,
    buffer: null,
    played: [],
    play: vi.fn(() => { sound.isPlaying = true; sound.played.push(sound.buffer); }),
    stop: vi.fn(() => { sound.isPlaying = false; }),
    setVolume: vi.fn((v) => { sound.volume = v; }),
    setBuffer: vi.fn((b) => { sound.buffer = b; }),
    disconnect: vi.fn(),
    removeFromParent: vi.fn(),
  };
  return sound;
}

/** A GameObject in a scene whose asset cache holds `loaded` (key → buffer). */
function host(loaded = {}) {
  const go = new GameObject('Host');
  go.scene = { userData: { engine: { assets: { has: key => key in loaded, get: key => loaded[key] } } } };
  return go;
}

describe('pickClip', () => {
  it('covers every clip on the first pick', () => {
    expect(pickClip(4, -1, 0)).toBe(0);
    expect(pickClip(4, -1, 0.999)).toBe(3);
  });

  it('never picks the one just played', () => {
    for (let last = 0; last < 4; last++) {
      const seen = new Set();
      for (let roll = 0; roll < 1; roll += 0.01) seen.add(pickClip(4, last, roll));
      expect(seen.has(last)).toBe(false);
      expect(seen.size).toBe(3);
    }
  });

  it('has no choice with one clip', () => {
    expect(pickClip(1, 0, 0.5)).toBe(0);
  });
});

describe('ClipVoice', () => {
  it('plays one of the set, at the volume asked', () => {
    const sound = fakeSound();
    const voice = new ClipVoice({ sound });
    const started = voice.play(host(), clipSet([], ['a', 'b', 'c']), 0.6);
    expect(started).toBe(true);
    expect(sound.play).toHaveBeenCalledTimes(1);
    expect(['a', 'b', 'c']).toContain(sound.buffer);
    expect(sound.volume).toBe(0.6);
  });

  it('uses every clip, and never the same one twice running', () => {
    const sound = fakeSound();
    const voice = new ClipVoice({ sound });
    const set = clipSet([], ['a', 'b', 'c']);
    for (let i = 0; i < 60; i++) voice.play(host(), set);
    expect(new Set(sound.played)).toEqual(new Set(['a', 'b', 'c']));
    expect(sound.played.every((clip, i) => clip !== sound.played[i - 1])).toBe(true);
  });

  it('remembers the last clip of each set apart', () => {
    const rolls = [0, 0, 0, 0];
    const sound = fakeSound();
    const voice = new ClipVoice({ sound, random: () => rolls.shift() });
    const ins = clipSet([], ['i1', 'i2']);
    const outs = clipSet([], ['o1', 'o2']);
    voice.play(host(), ins);
    voice.play(host(), outs);
    voice.play(host(), ins);
    voice.play(host(), outs);
    expect(sound.played).toEqual(['i1', 'o1', 'i2', 'o2']);
  });

  it('cuts a clip still sounding', () => {
    const sound = fakeSound();
    const voice = new ClipVoice({ sound });
    const set = clipSet([], ['a', 'b']);
    voice.play(host(), set);
    voice.play(host(), set);
    expect(sound.stop).toHaveBeenCalledTimes(1);
  });

  it('reads the clips from the asset cache by key, leaving out any not loaded', () => {
    const sound = fakeSound();
    const voice = new ClipVoice({ sound });
    const set = clipSet(['sfx:one', 'sfx:missing', 'sfx:two']);
    for (let i = 0; i < 20; i++) voice.play(host({ 'sfx:one': 'ONE', 'sfx:two': 'TWO' }), set);
    expect(new Set(sound.played)).toEqual(new Set(['ONE', 'TWO']));
  });

  it('starts nothing while the browser holds the audio back', () => {
    const sound = fakeSound();
    sound.context = { state: 'suspended' };
    const voice = new ClipVoice({ sound });
    const set = clipSet([], ['a']);
    expect(voice.play(host(), set)).toBe(false);
    expect(sound.play).not.toHaveBeenCalled();

    sound.context.state = 'running';
    expect(voice.play(host(), set)).toBe(true);
  });

  it('starts nothing with no clips, or with a null sound', () => {
    const sound = fakeSound();
    expect(new ClipVoice({ sound }).play(host(), clipSet([], []))).toBe(false);
    expect(new ClipVoice({ sound }).play(host(), clipSet(['sfx:missing']))).toBe(false);
    expect(new ClipVoice({ sound: null }).play(host(), clipSet([], ['a']))).toBe(false);
    expect(sound.play).not.toHaveBeenCalled();
  });

  it('gives up on nothing when asked before the scene has an engine', () => {
    const voice = new ClipVoice();
    const set = clipSet(['sfx:one']);
    expect(voice.play(new GameObject('Unplaced'), set)).toBe(false);
    expect(voice.sound).toBeUndefined();
    expect(set.buffers).toBeUndefined();
  });

  it('builds nothing on an engine with no audio', () => {
    const voice = new ClipVoice();
    expect(voice.play(host({ 'sfx:one': 'ONE' }), clipSet(['sfx:one']))).toBe(false);
    expect(voice.sound).toBeNull();
  });

  it('falls silent and unhooks on dispose', () => {
    const sound = fakeSound();
    const voice = new ClipVoice({ sound });
    voice.play(host(), clipSet([], ['a']));
    voice.dispose();
    expect(sound.isPlaying).toBe(false);
    expect(sound.disconnect).toHaveBeenCalled();
    expect(sound.removeFromParent).toHaveBeenCalled();
    expect(() => new ClipVoice().dispose()).not.toThrow();
  });
});
