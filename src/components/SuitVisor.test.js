import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { SuitVisor, breathEnvelope, seamlessLoop } from './SuitVisor.js';
import { EVASuit } from './EVASuit.js';
import { Component } from '../core/Component.js';
import { GameObject } from '../core/GameObject.js';

// ─────────────────────────────────────────────
// SuitVisor  –  helmet glass overlay + breathing while the suit is worn
// ─────────────────────────────────────────────
// Built by hand rather than through the Engine, which would drag in Rapier's
// WASM. The sound is a stand-in with THREE.Audio's surface — jsdom has no
// Web Audio, and the visor's job is deciding *when* to breathe, not decoding.

/** A buffer-shaped object: `seconds` long, loud between `loudFrom`–`loudTo`. */
function fakeBuffer({ seconds = 2, sampleRate = 1000, loudFrom = 0.5, loudTo = 1 } = {}) {
  const data = new Float32Array(seconds * sampleRate);
  for (let i = 0; i < data.length; i++) {
    const t = i / sampleRate;
    data[i] = (t >= loudFrom && t < loudTo ? 0.8 : 0.01) * (i % 2 ? 1 : -1);
  }
  return { sampleRate, length: data.length, duration: seconds, getChannelData: () => data };
}

function fakeSound(buffer = fakeBuffer()) {
  const sound = {
    buffer,
    context: { currentTime: 0 },
    isPlaying: false,
    volume: 1,
    play: vi.fn(() => { sound.isPlaying = true; }),
    stop: vi.fn(() => { sound.isPlaying = false; }),
    setVolume: vi.fn(v => { sound.volume = v; }),
    disconnect: vi.fn(),
  };
  return sound;
}

function buildPlayer({ sound = fakeSound(), fadeSeconds = 0.5, silenced } = {}) {
  const camera = new THREE.PerspectiveCamera(75, 16 / 9);
  const engine = { camera };
  const go = new GameObject('Player');
  go.scene = { userData: { engine } };
  const suit = go.addComponent(new EVASuit());
  const visor = go.addComponent(new SuitVisor({ suit, sound, fadeSeconds, silenced }));
  visor.onAwake();
  visor.onStart();
  return { camera, suit, visor, sound };
}

/** Advance `seconds` in 1/60 s frames, moving the audio clock along with it. */
function run(visor, sound, seconds) {
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps; i++) {
    sound.context.currentTime += 1 / 60;
    visor.onUpdate(1 / 60);
  }
}

describe('breathEnvelope', () => {
  it('samples loudness at a fixed rate, normalised so the loudest moment is 1', () => {
    const env = breathEnvelope(fakeBuffer({ seconds: 2, loudFrom: 0.5, loudTo: 1 }), 10);
    expect(env.rate).toBe(10);
    expect(env.values).toHaveLength(20);
    expect(Math.max(...env.values)).toBeCloseTo(1);
    expect(env.values[7]).toBeCloseTo(1);           // 0.7 s — mid-breath
    expect(env.values[15]).toBeLessThan(0.05);      // 1.5 s — quiet
  });

  it('survives a silent clip without dividing by zero', () => {
    const silent = { sampleRate: 100, length: 100, duration: 1, getChannelData: () => new Float32Array(100) };
    const env = breathEnvelope(silent, 10);
    expect(env.values.every(v => v === 0)).toBe(true);
  });
});

describe('SuitVisor', () => {
  it('is a component, so it can ride on the player', () => {
    expect(new SuitVisor()).toBeInstanceOf(Component);
  });

  it('hangs a full-screen glass overlay on the camera, hidden while the suit is off', () => {
    const { camera, visor } = buildPlayer();
    expect(visor.overlay.parent).toBe(camera);
    expect(visor.overlay.material).toBeInstanceOf(THREE.ShaderMaterial);
    expect(visor.overlay.visible).toBe(false);
  });

  it('draws over everything and never gets in the way of the world', () => {
    const { visor } = buildPlayer();
    const { overlay } = visor;
    expect(overlay.frustumCulled).toBe(false);
    expect(overlay.material.depthTest).toBe(false);
    expect(overlay.material.transparent).toBe(true);
    expect(overlay.renderOrder).toBeGreaterThan(100);
    expect(overlay.castShadow).toBe(false);

    // The level editor picks with a THREE.Raycaster — the visor must be invisible to it.
    const hits = [];
    overlay.raycast(new THREE.Raycaster(new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 0, -1)), hits);
    expect(hits).toHaveLength(0);
  });

  it('fades the glass in when the suit goes on and out when it comes off', () => {
    const { suit, visor, sound } = buildPlayer({ fadeSeconds: 0.5 });
    const opacity = () => visor.uniforms.uOpacity.value;

    suit.putOn();
    run(visor, sound, 0.25);
    expect(visor.overlay.visible).toBe(true);
    expect(opacity()).toBeGreaterThan(0.3);
    expect(opacity()).toBeLessThan(0.7);
    run(visor, sound, 0.5);
    expect(opacity()).toBe(1);

    suit.takeOff();
    run(visor, sound, 1);
    expect(opacity()).toBe(0);
    expect(visor.overlay.visible).toBe(false);
  });

  it('breathes on a loop while the suit is worn, and stops once it is off', () => {
    const { suit, visor, sound } = buildPlayer();
    suit.putOn();
    expect(sound.play).toHaveBeenCalledOnce();

    suit.takeOff();
    run(visor, sound, 1);
    expect(sound.stop).toHaveBeenCalled();
    expect(sound.isPlaying).toBe(false);
  });

  it('falls silent at once when silenced (a death screen), and breathes again after', () => {
    let dead = false;
    const { suit, visor, sound } = buildPlayer({ silenced: () => dead });
    suit.putOn();
    run(visor, sound, 1);
    expect(sound.isPlaying).toBe(true);
    dead = true;
    visor.onUpdate(1 / 60);
    expect(sound.isPlaying).toBe(false);
    run(visor, sound, 2);
    expect(sound.isPlaying).toBe(false);   // stays quiet through it
    dead = false;
    run(visor, sound, 0.1);
    expect(sound.isPlaying).toBe(true);    // the suit is still on: back to breathing
  });

  it('fades the breathing with the glass, so it never cuts in or out', () => {
    const { suit, visor, sound } = buildPlayer({ fadeSeconds: 0.5 });
    suit.putOn();
    run(visor, sound, 0.25);
    expect(sound.volume).toBeGreaterThan(0);
    expect(sound.volume).toBeLessThan(visor.volume);
    run(visor, sound, 0.5);
    expect(sound.volume).toBeCloseTo(visor.volume);
  });

  it('fogs the glass on the loud part of the breath and lets it clear on the quiet part', () => {
    const { suit, visor, sound } = buildPlayer();
    const fog = () => visor.uniforms.uBreath.value;
    suit.putOn();

    run(visor, sound, 0.45);                        // quiet stretch
    const quiet = fog();
    run(visor, sound, 0.5);                         // 0.95 s — end of the breath
    const breath = fog();
    run(visor, sound, 0.95);                        // 1.9 s — quiet again
    const cleared = fog();

    expect(breath).toBeGreaterThan(quiet + 0.3);
    expect(cleared).toBeLessThan(breath);
  });

  it('starts breathing at once if the suit is already on when it starts', () => {
    const camera = new THREE.PerspectiveCamera();
    const go = new GameObject('Player');
    go.scene = { userData: { engine: { camera } } };
    const suit = go.addComponent(new EVASuit());
    suit.putOn();
    const sound = fakeSound();
    const visor = go.addComponent(new SuitVisor({ suit, sound }));
    visor.onAwake();
    visor.onStart();
    expect(sound.play).toHaveBeenCalledOnce();
  });

  it('cleans up after itself when destroyed', () => {
    const { camera, suit, visor, sound } = buildPlayer();
    suit.putOn();
    const { overlay } = visor;
    const dispose = vi.spyOn(overlay.material, 'dispose');

    visor.onDestroy();

    expect(overlay.parent).toBeNull();
    expect(camera.children).not.toContain(overlay);
    expect(dispose).toHaveBeenCalled();
    expect(sound.stop).toHaveBeenCalled();
    suit.takeOff();
    suit.putOn();                                   // unsubscribed — no second play
    expect(sound.play).toHaveBeenCalledOnce();
  });

  it('works silently when there is no sound to play', () => {
    const camera = new THREE.PerspectiveCamera();
    const go = new GameObject('Player');
    go.scene = { userData: { engine: { camera } } };
    const suit = go.addComponent(new EVASuit());
    const visor = go.addComponent(new SuitVisor({ suit }));
    visor.onAwake();
    visor.onStart();
    suit.putOn();
    expect(() => visor.onUpdate(1 / 60)).not.toThrow();
    expect(visor.overlay.visible).toBe(true);
  });
});

describe('seamlessLoop', () => {
  const RATE = 1000;

  /** A sine whose period doesn't divide the clip, so end → start jumps. */
  function sine(n, { pad = 0, freq = 7.3 } = {}) {
    const data = new Float32Array(n + pad * 2);
    for (let i = 0; i < n; i++) data[pad + i] = 0.5 * Math.sin(2 * Math.PI * freq * i / RATE + 0.3);
    return data;
  }
  const maxStep = (d) => {
    let m = 0;
    for (let i = 1; i < d.length; i++) m = Math.max(m, Math.abs(d[i] - d[i - 1]));
    return m;
  };

  it('a raw clip jumps at the wrap — the click this exists to remove', () => {
    const d = sine(1000);
    expect(Math.abs(d[0] - d[d.length - 1])).toBeGreaterThan(maxStep(d) * 5);
  });

  it('wraps from end to start no harder than any step inside the clip', () => {
    const d = sine(1000);
    const [out] = seamlessLoop([d], RATE, { fadeSeconds: 0.1 });
    const wrap = Math.abs(out[0] - out[out.length - 1]);
    expect(wrap).toBeLessThanOrEqual(maxStep(d) * 1.05);
    expect(maxStep(out)).toBeLessThanOrEqual(maxStep(d) * 1.5);   // the fade itself is smooth
  });

  it('trims the encoder silence padded onto both ends before looping', () => {
    const d = sine(1000, { pad: 50 });
    const [out] = seamlessLoop([d], RATE, { fadeSeconds: 0.1 });
    expect(out).toHaveLength(1000 - 100);                    // trimmed, less the fade overlap
    expect(Math.abs(out[0])).toBeGreaterThan(0);             // starts on sound, not padding
  });

  it('treats every channel alike, so stereo stays in step', () => {
    const left = sine(1000), right = sine(1000, { freq: 11.1 });
    const out = seamlessLoop([left, right], RATE, { fadeSeconds: 0.1 });
    expect(out).toHaveLength(2);
    expect(out[0]).toHaveLength(out[1].length);
  });

  it('leaves a clip too short to fade alone', () => {
    const d = sine(100);
    expect(seamlessLoop([d], RATE, { fadeSeconds: 0.1 })[0]).toEqual(d);
  });
});

describe('SuitVisor volume', () => {
  it('breathes at 0.4 by default — present, under the rest of the mix', () => {
    expect(new SuitVisor().volume).toBe(0.4);
  });
});

describe('SuitVisor timing', () => {
  it('builds its overlay on awake — before the boot warm-up, so its shader is compiled with everything else', () => {
    // Built on the first frame instead, the overlay compiled the first time
    // the suit went on: a one-second freeze in the airlock.
    const camera = new THREE.PerspectiveCamera();
    const go = new GameObject('Player');
    go.scene = { userData: { engine: { camera } } };
    const suit = go.addComponent(new EVASuit());
    const visor = go.addComponent(new SuitVisor({ suit, sound: fakeSound() }));
    visor.onAwake();
    expect(visor.overlay.parent).toBe(camera);
  });
});
