import * as THREE from 'three';
import { Component } from '../core/Component.js';
import { seamlessLoop } from './SuitVisor.js';

// ─────────────────────────────────────────────
// GeneratorSound  –  the diesel outside: start-up, hum, wind-down
// ─────────────────────────────────────────────
// Rides on the generator and is its switch's voice:
//
//   switchOn()   the start-up clip (crank, catch, settle), crossfading into
//                the running hum
//   switchOff()  the wind-down clip, and the hum stops
//
// The hum follows the grid on its own, without a start-up or a wind-down:
// it is running when the night starts, and it cuts dead when the UFO trips
// the generator.
//
// Loudness is where you stand. Outdoors it falls off with distance from the
// generator; anywhere inside the base (rooms, corridors) it is a whisper
// through the walls. The change eases over a moment, so stepping through
// the airlock doesn't snap it.
//
// The three clips are cut from one recording at MPEG frame boundaries (see
// ATTRIBUTIONS.md); the hum is made seamless at load with SuitVisor's
// seamlessLoop.
// ─────────────────────────────────────────────

/** Tuning. Seconds unless stated. */
export const GENERATOR = {
  /** The start-up clip has settled into a steady run by here, and starts
   *  handing over to the hum… */
  humFadeStart: 3.0,
  /** …which has fully taken over by here. */
  humFadeEnd: 4.2,
  /** Volume at the reference distance, outdoors. */
  volume: 0.6,
  /** Metres from the generator at full volume; beyond it, inverse falloff. */
  refDistance: 4,
  /** Fraction of the outdoor volume that gets through the walls. */
  insideLevel: 0.01,
  /** Rate (per second) the inside/outside level eases at. */
  placeRate: 4,
};

/** Manifest keys behind each clip. */
export const GENERATOR_SOUNDS = {
  start:   'sfx:generator-start',
  running: 'sfx:generator-running',
  stop:    'sfx:generator-stop',
};

const _ear = new THREE.Vector3();

export class GeneratorSound extends Component {
  /**
   * @param {object} opts
   * @param {import('../systems/PowerGrid.js').PowerGrid} opts.grid
   * @param {object} opts.hooks
   * @param {(out: THREE.Vector3) => THREE.Vector3} opts.hooks.listenerPosition
   * @param {(p: THREE.Vector3) => boolean} opts.hooks.isOutside
   * @param {THREE.Vector3} [opts.position]  Where the generator stands. Left
   *        out, its GameObject's world position.
   * @param {Record<string, THREE.Audio>} [opts.sounds]  Built from GENERATOR_SOUNDS when left out.
   */
  constructor({ grid, hooks, position = null, sounds = null }) {
    super();
    this.grid = grid;
    this.hooks = hooks;
    this.position = position;
    this.sounds = sounds;

    /** Seconds since switchOn(), or null when not starting up. */
    this._starting = null;
    /** Eased place level: 1 at the generator outdoors, insideLevel inside. */
    this._place = null;
  }

  onStart() {
    if (!this.sounds) this.sounds = this._buildSounds();
    if (!this.position) {
      this.position = new THREE.Vector3();
      this.gameObject?.object3d.getWorldPosition(this.position);
    }
    this.sounds.running?.setLoop?.(true);
  }

  onDestroy() {
    for (const sound of Object.values(this.sounds ?? {})) {
      if (sound?.isPlaying) sound.stop();
      try { sound?.disconnect?.(); } catch (_) { /* never connected */ }
    }
  }

  /** The player started it. */
  switchOn() {
    if (this.grid.on) return;
    this.grid.setOn(true);
    if (!this.grid.on) return;   // tripped breakers: the panel comes first
    this._stop('stop');
    this._stop('running');
    this._starting = 0;
    this._play('start');
  }

  /** The player shut it down. */
  switchOff() {
    if (!this.grid.on) return;
    this.grid.setOn(false);
    this._starting = null;
    this._stop('start');
    this._stop('running');
    this._play('stop');
  }

  onUpdate(dt) {
    const place = this._placeLevel(dt);
    let start = 1, hum = 1;

    if (this._starting !== null) {
      this._starting += dt;
      const k = Math.min(Math.max(
        (this._starting - GENERATOR.humFadeStart) / (GENERATOR.humFadeEnd - GENERATOR.humFadeStart), 0), 1);
      start = 1 - k;
      hum = k;
      if (k >= 1) this._starting = null;
    }

    // The hum follows the switch: running whenever the grid is on and the
    // start-up has handed over; dead the moment it goes off.
    const humming = this.grid.on && (this._starting === null || this._starting >= GENERATOR.humFadeStart);
    if (humming && !this.sounds.running?.isPlaying) this.sounds.running?.play();
    if (!humming) this._stop('running');
    if (this._starting === null) this._stop('start');

    const v = GENERATOR.volume * place;
    this.sounds.start?.isPlaying && this.sounds.start.setVolume(v * start);
    this.sounds.running?.isPlaying && this.sounds.running.setVolume(v * hum);
    this.sounds.stop?.isPlaying && this.sounds.stop.setVolume(v);
  }

  /** 1 by the generator, falling off with distance outdoors; a sliver of
   *  that indoors. Eased, so the airlock doesn't snap it. */
  _placeLevel(dt) {
    const ear = this.hooks.listenerPosition(_ear);
    let target;
    if (this.hooks.isOutside(ear)) {
      const d = ear.distanceTo(this.position);
      target = Math.min(1, GENERATOR.refDistance / Math.max(d, 1e-3));
    } else {
      target = GENERATOR.insideLevel;
    }
    if (this._place === null) this._place = target;
    else this._place += (target - this._place) * (1 - Math.exp(-GENERATOR.placeRate * dt));
    return this._place;
  }

  _play(name) {
    const sound = this.sounds?.[name];
    if (!sound) return;
    if (sound.isPlaying) sound.stop();
    sound.setVolume(GENERATOR.volume * (this._place ?? 1));
    sound.play();
  }

  _stop(name) {
    const sound = this.sounds?.[name];
    if (sound?.isPlaying) sound.stop();
  }

  /** One THREE.Audio per clip from the preloaded buffers; the hum gets a
   *  click-free looping copy. Missing buffers are left out. */
  _buildSounds() {
    const engine = this.gameObject?.scene?.userData?.engine;
    const sounds = {};
    if (!engine?.audioListener || !engine.assets) return sounds;
    for (const [name, key] of Object.entries(GENERATOR_SOUNDS)) {
      if (engine.assets.has && !engine.assets.has(key)) continue;
      let buffer = engine.assets.get(key);
      if (!buffer) continue;
      if (name === 'running') buffer = loopable(buffer, engine.audioListener.context);
      const audio = new THREE.Audio(engine.audioListener);
      audio.setBuffer(buffer);
      sounds[name] = audio;
    }
    return sounds;
  }
}

/** A click-free looping copy of `buffer` — a copy, since the cached one is shared. */
function loopable(buffer, context) {
  const channels = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));
  const looped = seamlessLoop(channels, buffer.sampleRate, { fadeSeconds: 0.25 });
  if (looped === channels) return buffer;
  const out = context.createBuffer(looped.length, looped[0].length, buffer.sampleRate);
  looped.forEach((data, c) => out.copyToChannel(data, c));
  return out;
}
