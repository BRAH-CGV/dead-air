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

/** Stand-ins for the audio classes, so a built sound can be inspected. */
vi.mock('three', async importOriginal => {
  const three = await importOriginal();
  class Audio extends three.Object3D {
    constructor(listener) { super(); this.listener = listener; this.isPlaying = false; this.volume = 0; }
    setBuffer(b) { this.buffer = b; }
    setLoop(l) { this.loop = l; }
    setVolume(v) { this.volume = v; }
    setRefDistance(d) { this.refDistance = d; }
    setRolloffFactor(r) { this.rolloff = r; }
    setDetune(c) { this.detune = c; }
    play() { this.isPlaying = true; }
    stop() { this.isPlaying = false; }
    pause() { this.isPlaying = false; }
    disconnect() {}
  }
  class PositionalAudio extends Audio {}
  return { ...three, Audio, PositionalAudio };
});

/** A host whose engine has the clip in its cache. */
function loadedHost(name) {
  const go = new GameObject(name);
  go.scene = { userData: { engine: {
    audioListener: { context: { createBuffer: () => ({ copyToChannel() {} }) } },
    assets: {
      has: key => key === 'sfx:hum',
      get: () => ({ numberOfChannels: 1, sampleRate: 48000, getChannelData: () => new Float32Array(48000) }),
    },
  } } };
  return go;
}

describe('LoopVoice placed on a host', () => {
  it('sounds from the host itself, and moves with it', () => {
    const drive = loadedHost('Drive');
    const voice = new LoopVoice({ key: 'sfx:hum', placed: { refDistance: 3, rolloff: 1 } });
    voice.set(0.1, 1 / 60, drive);
    expect(voice.sound.parent).toBe(drive.object3d);
    expect(voice.sound.refDistance).toBe(3);
    expect(voice.sound.rolloff).toBe(1);
  });

  it('follows to another host when a different one is named, and stays put at level 0', () => {
    const a = loadedHost('A');
    const b = loadedHost('B');
    const voice = new LoopVoice({ key: 'sfx:hum', placed: { refDistance: 3 } });
    voice.set(0.1, 1 / 60, a);
    voice.set(0.1, 1 / 60, b);
    expect(voice.sound.parent).toBe(b.object3d);
    voice.set(0, 1 / 60, a);          // fading out: not dragged back
    expect(voice.sound.parent).toBe(b.object3d);
  });

  it('takes the sound off the host when disposed', () => {
    const drive = loadedHost('Drive');
    const voice = new LoopVoice({ key: 'sfx:hum', placed: { refDistance: 3 } });
    voice.set(0.1, 1 / 60, drive);
    const sound = voice.sound;
    voice.dispose();
    expect(sound.parent).toBeNull();
  });

  it('plays pitched down by the cents asked, and at its own pitch otherwise', () => {
    const low = new LoopVoice({ key: 'sfx:hum', detune: -400 });
    low.set(0.1, 1 / 60, loadedHost('A'));
    expect(low.sound.detune).toBe(-400);
    const plain = new LoopVoice({ key: 'sfx:hum' });
    plain.set(0.1, 1 / 60, loadedHost('B'));
    expect(plain.sound.detune ?? 0).toBe(0);
  });

  it('is not placed unless asked', () => {
    const voice = new LoopVoice({ key: 'sfx:hum' });
    const host = loadedHost('Host');
    voice.set(0.1, 1 / 60, host);
    expect(voice.sound.parent).toBeNull();
  });
});

describe('LoopVoice fades and silence', () => {
  it('comes in and goes out at the rates it is given', () => {
    const quick = new LoopVoice({ sound: fakeSound(), rateUp: 30, rateDown: 30 });
    const slow = new LoopVoice({ sound: fakeSound(), rateUp: 2, rateDown: 2 });
    for (const v of [quick, slow]) v.set(0.5, 0.05);
    expect(quick.sound.volume).toBeGreaterThan(slow.sound.volume);

    const out = fakeSound();
    const voice = new LoopVoice({ sound: out, rateUp: 30, rateDown: 2 });
    run(voice, 0.5, 1);
    voice.set(0, 0.1);
    expect(out.volume).toBeGreaterThan(0.2);    // still well up after 0.1 s: a slow fade out
  });

  it('silence() stops the loop at once, and it can start again', () => {
    const sound = fakeSound();
    const voice = new LoopVoice({ sound });
    run(voice, 0.4);
    voice.silence();
    expect(sound.isPlaying).toBe(false);
    voice.set(0.4, 1 / 60);
    expect(sound.isPlaying).toBe(true);
    expect(sound.volume).toBeLessThan(0.1);      // from the bottom: it swells back in
  });
});

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
