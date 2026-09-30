import * as THREE from 'three';
import { Component } from '../core/Component.js';

// ─────────────────────────────────────────────
// AudioSystem  –  every sound the game makes goes through here
// ─────────────────────────────────────────────
// One per scene, on BaseScene as `scene.audio` and on the threat context as
// `ctx.audio`. Sounds are manifest keys, decoded at preload; this plays them.
//
//   play(key, { volume, at, rate })   a one-shot; `at` makes it positional
//   positional(key, object3d, opts)   a looping emitter riding an object —
//                                     machines, threats. Silent at level 0.
//   follow(emitter, { level, rate })  drive an emitter from the game every
//                                     frame (the dish's speed → motor hum)
//   setAmbience(key)                  the room tone, crossfaded over FADE s
//   setPaused(bool)                   suspends everything (menus call this)
//   setVolume(0..1)                   master volume
//
// ── The browser's rules ──
// An AudioContext may not make sound until the page has had a click or a key
// press, so nothing starts before the first one (pointer lock, a key, a
// click). What was asked for meanwhile — the ambience, raised emitters —
// starts then. One-shots asked for before it, or while paused, are dropped:
// a stale bang on resume is worse than none.
//
// Without Web Audio (node tests, jsdom) `available` is false and every call
// is a harmless no-op, so the rest of the game never has to check.
// ─────────────────────────────────────────────

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/** Gain changes glide with this time constant (s) — no clicks. */
const GLIDE = 0.08;
/** A loop dropped to level 0 stops after its gain has glided out. */
const STOP_AFTER = 5 * GLIDE;
/** Changes smaller than this aren't worth a message to the audio thread. */
const EPSILON = 0.005;
/** One-shot voices kept at most; past this a sound is skipped. */
const MAX_VOICES = 24;

function webAudioAvailable() {
  return typeof window !== 'undefined' && !!(window.AudioContext || window.webkitAudioContext);
}

/** How hard the dish drive is working: its speed as a share of top speed. */
export function dishMotorLevel(satellite) {
  if (!satellite?.maxRotationSpeed) return 0;
  return clamp01(Math.hypot(satellite.velYaw, satellite.velPitch) / satellite.maxRotationSpeed);
}

/**
 * A looping sound on an object, whose loudness is `volume × level`. The game
 * sets the level; at 0 the sound stops, so a silent machine costs nothing.
 * With no sound (no Web Audio, or no buffer) it just remembers its level.
 */
class Emitter {
  constructor(system, sound, volume) {
    this.system = system;
    /** @type {THREE.PositionalAudio|null} */
    this.sound = sound;
    this.volume = volume;
    this.level = 0;
    this.rate = 1;
  }

  setLevel(level) {
    level = clamp01(level);
    // A change to or from silence always counts: it starts or stops the loop.
    if (Math.abs(level - this.level) < EPSILON && (level === 0) === (this.level === 0)) return this;
    this.level = level;
    this._apply();
    return this;
  }

  setRate(rate) {
    if (Math.abs(rate - this.rate) < EPSILON) return this;
    this.rate = rate;
    this.sound?.setPlaybackRate(rate);
    return this;
  }

  _apply() {
    const { sound } = this;
    if (!sound) return;
    sound.gain.gain.setTargetAtTime(this.volume * this.level, sound.context.currentTime, GLIDE);
    if (this.level > 0 && !sound.isPlaying && this.system.canPlay) sound.play();
    else if (this.level === 0 && sound.isPlaying) sound.stop(STOP_AFTER);
  }
}

export class AudioSystem extends Component {
  /** Ambience crossfade, seconds. */
  static FADE = 1;

  /**
   * @param {object} opts
   * @param {THREE.Camera} [opts.camera]  The listener rides it.
   * @param {{ has(key: string): boolean, get(key: string): AudioBuffer }} [opts.assets]
   * @param {THREE.AudioListener|null} [opts.listener]  Default: a new one,
   *        where the page has Web Audio; null makes the system silent.
   * @param {EventTarget} [opts.doc]  Where the first gesture and visibility
   *        changes are heard. Default: `document`.
   * @param {number} [opts.volume=0.8]  Master volume.
   */
  constructor({ camera = null, assets = null, listener, doc = globalThis.document ?? null, volume = 0.8 } = {}) {
    super();
    this.assets = assets;
    this.camera = camera;
    this.listener = listener === undefined ? (webAudioAvailable() ? new THREE.AudioListener() : null) : listener;
    this.available = !!this.listener;
    this.volume = clamp01(volume);
    /** The room tone asked for — kept even while silent, to start on the first gesture. */
    this.ambienceKey = null;
    this.ambienceVolume = 0.5;
    this.paused = false;

    this._doc = doc;
    this._gestured = false;
    this._disposed = false;
    /** @type {THREE.Audio[]} one-shot voices, reused once they run out */
    this._voices = [];
    /** @type {Emitter[]} */
    this._emitters = [];
    /** @type {{ emitter: Emitter, level?: () => number, rate?: () => number }[]} */
    this._followers = [];
    /** @type {{ key: string|null, sound: THREE.Audio, freeAt: number }[]} */
    this._ambience = [];

    if (!this.available) return;

    camera?.add(this.listener);
    this.listener.setMasterVolume(this.volume);

    this._onGesture = () => {
      if (this._gestured) return;
      this._gestured = true;
      this._syncContext();
      this._fadeTo(this.ambienceKey);
      for (const e of this._emitters) e._apply();
    };
    this._onVisibility = () => this._syncContext();
    for (const type of ['pointerlockchange', 'pointerdown', 'keydown']) doc?.addEventListener(type, this._onGesture);
    doc?.addEventListener('visibilitychange', this._onVisibility);
  }

  get context() { return this.listener?.context ?? null; }

  /** Sounds may start: Web Audio is here and the page has had its gesture. */
  get canPlay() { return this.available && this._gestured && !this._disposed; }

  setVolume(volume) {
    this.volume = clamp01(volume);
    this.listener?.setMasterVolume(this.volume);
  }

  /** HOOK(menus): the pause menu calls this; the whole mix freezes in place. */
  setPaused(paused) {
    this.paused = paused;
    this._syncContext();
  }

  /** Run the context only when it may be heard: after the gesture, unpaused, tab shown. */
  _syncContext() {
    if (!this.canPlay) return;
    const ctx = this.context;
    const run = !this.paused && !this._doc?.hidden;
    if (run && ctx.state !== 'running') ctx.resume()?.catch?.(() => {});
    else if (!run && ctx.state === 'running') ctx.suspend()?.catch?.(() => {});
  }

  _buffer(key) {
    return key && this.assets?.has(key) ? this.assets.get(key) : null;
  }

  // ── One-shots ──────────────────────────────

  /**
   * Play a sound once.
   * @param {string} key
   * @param {{ volume?: number, rate?: number, at?: THREE.Object3D }} [opts]
   *        `at` plays it from that object, in 3D.
   * @returns {THREE.Audio|null} the voice, or null if nothing played
   */
  play(key, { volume = 1, rate = 1, at = null } = {}) {
    if (!this.canPlay || this.paused) return null;
    const buffer = this._buffer(key);
    if (!buffer) return null;
    const voice = this._freeVoice(!!at);
    if (!voice) return null;
    if (at) at.add(voice);
    voice.setBuffer(buffer);
    voice.setLoop(false);
    voice.setVolume(volume);
    voice.setPlaybackRate(rate);
    voice.play();
    return voice;
  }

  _freeVoice(positional) {
    for (const v of this._voices) {
      if (!v.isPlaying && (v instanceof THREE.PositionalAudio) === positional) return v;
    }
    if (this._voices.length >= MAX_VOICES) return null;
    const voice = positional ? new THREE.PositionalAudio(this.listener) : new THREE.Audio(this.listener);
    if (positional) voice.setRefDistance(2);
    this._voices.push(voice);
    return voice;
  }

  // ── Positional loops ───────────────────────

  /**
   * A looping sound riding `object3d`, silent until its level is raised.
   * @param {string} key
   * @param {THREE.Object3D} object3d
   * @param {{ volume?: number, refDistance?: number, rolloff?: number }} [opts]
   *        `refDistance` (m): full volume inside it, falling off past it.
   * @returns {Emitter}
   */
  positional(key, object3d, { volume = 1, refDistance = 2, rolloff = 1 } = {}) {
    const buffer = this.available ? this._buffer(key) : null;
    let sound = null;
    if (buffer) {
      sound = new THREE.PositionalAudio(this.listener);
      sound.setBuffer(buffer);
      sound.setLoop(true);
      sound.setRefDistance(refDistance);
      sound.setRolloffFactor(rolloff);
      sound.gain.gain.value = 0;
      object3d.add(sound);
    }
    const emitter = new Emitter(this, sound, volume);
    this._emitters.push(emitter);
    return emitter;
  }

  /**
   * Drive an emitter from the game, every frame. Either function may be left
   * out. Returns the emitter.
   * @param {Emitter} emitter
   * @param {{ level?: () => number, rate?: () => number }} drivers
   */
  follow(emitter, { level, rate } = {}) {
    this._followers.push({ emitter, level, rate });
    return emitter;
  }

  onUpdate() {
    const followers = this._followers;
    for (let i = 0; i < followers.length; i++) {
      const f = followers[i];
      if (f.level) f.emitter.setLevel(f.level());
      if (f.rate) f.emitter.setRate(f.rate());
    }
  }

  // ── Ambience ───────────────────────────────

  /** The room tone: `key` fades in over FADE s as the last one fades out. null fades to silence. */
  setAmbience(key) {
    if (key === this.ambienceKey) return;
    this.ambienceKey = key;
    if (this.canPlay) this._fadeTo(key);
  }

  _fadeTo(key) {
    const ctx = this.context;
    const now = ctx.currentTime, end = now + AudioSystem.FADE;

    for (const a of this._ambience) {
      if (!a.sound.isPlaying) continue;
      const gain = a.sound.gain.gain;
      gain.cancelScheduledValues(now);
      gain.setValueAtTime(gain.value, now);
      gain.linearRampToValueAtTime(0, end);
      a.sound.stop(AudioSystem.FADE);
      a.freeAt = end;
    }

    const buffer = this._buffer(key);
    if (!buffer) return;
    // A voice still fading out keeps its gain ramp; take one that has finished.
    let voice = this._ambience.find(a => !a.sound.isPlaying && a.freeAt <= now);
    if (!voice) {
      voice = { key: null, sound: new THREE.Audio(this.listener), freeAt: 0 };
      this._ambience.push(voice);
    }
    voice.key = key;
    const { sound } = voice;
    sound.setBuffer(buffer);
    sound.setLoop(true);
    const gain = sound.gain.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(0, now);
    gain.linearRampToValueAtTime(this.ambienceVolume, end);
    sound.play();
  }

  // ── Teardown ───────────────────────────────

  onDestroy() { this.dispose(); }

  /** Stop everything and let go of the page. Safe to call twice. */
  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    if (!this.available) return;

    for (const type of ['pointerlockchange', 'pointerdown', 'keydown']) this._doc?.removeEventListener(type, this._onGesture);
    this._doc?.removeEventListener('visibilitychange', this._onVisibility);

    const silence = (sound) => {
      if (sound.isPlaying) sound.stop();
      if (sound.source) sound.disconnect();
      sound.gain.disconnect();
      sound.removeFromParent();
    };
    for (const v of this._voices) silence(v);
    for (const e of this._emitters) if (e.sound) silence(e.sound);
    for (const a of this._ambience) silence(a.sound);
    this._voices.length = 0;
    this._emitters.length = 0;
    this._followers.length = 0;
    this._ambience.length = 0;

    this.listener.removeFromParent();
    this.listener.gain.disconnect();
  }
}
