import { describe, it, expect, vi } from 'vitest';
import { MenuMusic, MENU_MUSIC } from './MenuMusic.js';
import { ASSETS, PRELOAD } from '../assets/manifest.js';

// ─────────────────────────────────────────────
// Built by hand: a stand-in for THREE.Audio whose gain is a recording
// AudioParam. The class's job is deciding when the music is wanted and
// scheduling the fades, not decoding or playing it.
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
    context: { currentTime: 10 },
    gain: { gain: fakeParam() },
    setBuffer: vi.fn(),
    setLoop: vi.fn(),
    setLoopStart: vi.fn(),
    play: vi.fn(() => { sound.isPlaying = true; }),
    stop: vi.fn(() => { sound.isPlaying = false; }),
    disconnect: vi.fn(),
  };
  return sound;
}

/** A two-second mono buffer, enough for the loop seam to be blended. */
function fakeBuffer() {
  const data = new Float32Array(2000).fill(0.1);
  return { numberOfChannels: 1, sampleRate: 1000, length: data.length, duration: 2, getChannelData: () => data };
}

function build({ load } = {}) {
  let arrive, fail;
  const pending = new Promise((resolve, reject) => { arrive = resolve; fail = reject; });
  const engine = {
    audioListener: {},
    assets: { load: load ?? vi.fn(() => pending) },
  };
  const sound = fakeSound();
  const music = new MenuMusic({ engine, createSound: vi.fn(() => sound) });
  const loaded = async (buffer = fakeBuffer()) => { arrive(buffer); await pending; await Promise.resolve(); };
  return { music, engine, sound, loaded, fail, gain: sound.gain.gain };
}

describe('MenuMusic', () => {
  it('plays the ambient music track, fetched on demand like the rest of the ambience', () => {
    expect(ASSETS[MENU_MUSIC.key]).toMatchObject({ type: 'audio' });
    expect(MENU_MUSIC.key).toBe('sfx:interior-base-ambient-music');
    expect(PRELOAD).not.toContain(MENU_MUSIC.key);
  });

  it('fetches its clip when loaded, and plays nothing until asked', async () => {
    const { music, engine, sound, loaded } = build();
    music.load();
    expect(engine.assets.load).toHaveBeenCalledWith(MENU_MUSIC.key);
    await loaded();
    expect(sound.play).not.toHaveBeenCalled();
  });

  it('loops without a click at the seam', async () => {
    const { music, sound, loaded } = build();
    music.load();
    await loaded();
    expect(sound.setLoop).toHaveBeenCalledWith(true);
    expect(sound.setLoopStart.mock.calls[0][0]).toBeGreaterThan(0);
  });

  it('fades in from silence when the menu wants it', async () => {
    const { music, sound, loaded, gain } = build();
    music.load();
    await loaded();
    music.setPlaying(true);

    expect(sound.play).toHaveBeenCalledTimes(1);
    expect(gain.ramps).toEqual([{ to: MENU_MUSIC.volume, at: 10 + MENU_MUSIC.fadeIn }]);
    // From where the gain is now, so nothing jumps.
    expect(gain.cancelScheduledValues).toHaveBeenCalledWith(10);
    expect(gain.setValueAtTime).toHaveBeenCalledWith(0, 10);
  });

  it('starts as soon as the clip arrives, if the menu was already up', async () => {
    const { music, sound, loaded, gain } = build();
    music.load();
    music.setPlaying(true);
    expect(sound.play).not.toHaveBeenCalled();

    await loaded();
    expect(sound.play).toHaveBeenCalledTimes(1);
    expect(gain.ramps.at(-1).to).toBe(MENU_MUSIC.volume);
  });

  it('fades out for the game, and keeps looping silent rather than cutting', async () => {
    const { music, sound, loaded, gain } = build();
    music.load();
    await loaded();
    music.setPlaying(true);
    sound.context.currentTime = 30;
    music.setPlaying(false);

    expect(gain.ramps.at(-1)).toEqual({ to: 0, at: 30 + MENU_MUSIC.fadeOut });
    expect(sound.stop).not.toHaveBeenCalled();
  });

  it('comes back on the way out to the menu, without starting a second copy', async () => {
    const { music, sound, loaded, gain } = build();
    music.load();
    await loaded();
    music.setPlaying(true);
    music.setPlaying(false);
    music.setPlaying(true);
    expect(sound.play).toHaveBeenCalledTimes(1);
    expect(gain.ramps.at(-1).to).toBe(MENU_MUSIC.volume);
  });

  it('does not reschedule a fade for a state it is already in', async () => {
    const { music, loaded, gain } = build();
    music.load();
    await loaded();
    music.setPlaying(true);
    music.setPlaying(true);
    expect(gain.ramps).toHaveLength(1);
  });

  it('is never played if the game starts before it was wanted', async () => {
    const { music, sound, loaded } = build();
    music.load();
    music.setPlaying(false);
    await loaded();
    expect(sound.play).not.toHaveBeenCalled();
  });

  it('stays quiet: at or under the level the track was liked at in game', () => {
    expect(MENU_MUSIC.volume).toBeGreaterThan(0);
    expect(MENU_MUSIC.volume).toBeLessThanOrEqual(0.2);
    expect(MENU_MUSIC.fadeIn).toBeGreaterThan(0);
    expect(MENU_MUSIC.fadeOut).toBeGreaterThan(0);
  });

  it('carries on with no audio at all', () => {
    const music = new MenuMusic({ engine: {} });
    expect(() => { music.load(); music.setPlaying(true); music.setPlaying(false); music.dispose(); }).not.toThrow();
  });

  it('carries on if the clip fails to load', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { music, sound } = build({ load: vi.fn(() => Promise.reject(new Error('404'))) });
    music.load();
    music.setPlaying(true);
    await Promise.resolve(); await Promise.resolve();
    expect(sound.play).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('stops and unhooks when disposed, and ignores a clip that arrives afterwards', async () => {
    const a = build();
    a.music.load();
    await a.loaded();
    a.music.setPlaying(true);
    a.music.dispose();
    expect(a.sound.isPlaying).toBe(false);
    expect(a.sound.disconnect).toHaveBeenCalled();

    const b = build();
    b.music.load();
    b.music.setPlaying(true);
    b.music.dispose();
    await b.loaded();
    expect(b.sound.play).not.toHaveBeenCalled();
  });
});
