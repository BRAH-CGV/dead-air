import * as THREE from 'three';
import { Component } from '../core/Component.js';

// ─────────────────────────────────────────────
// StormOutage  –  every sandstorm takes the power out, once
// ─────────────────────────────────────────────
// Each storm (sandstorm.stormId) chokes the generator once, at a random
// point through it (STORM_OUTAGE.at, a fraction of the way through —
// sandstorm.stormProgress):
//
//   steady ──its moment──▶ flickering ──flickerSeconds──▶ cut
//                             (the lamps gutter and dim —      (cutPower: the
//                              grid.brownout — and buzz)        generator winds down)
//
// It is an ordinary shut-down, not a blow-out: nothing is tripped or broken,
// so flipping the switches on the generator's panel brings it back — and it
// stays on for the rest of that storm. A grid already off or tripped when
// the moment comes is waited for; the shift ending (or a new night) puts the
// lamps steady again.
//
// The scene hands it `cutPower` — GeneratorSound.switchOff, so the
// generator's wind-down plays — and the grid it watches.
// ─────────────────────────────────────────────

/** Tuning. Seconds unless stated. */
export const STORM_OUTAGE = {
  /** Where in the storm the power goes: a random fraction of the way
   *  through, between these — in its strong middle. */
  at: [0.25, 0.75],
  /** The lamps flicker this long before they die. */
  flickerSeconds: 2.2,
  /** The buzz of the failing lamps. */
  flickerVolume: 0.45,
};

/** Manifest keys behind each sound. */
export const STORM_OUTAGE_SOUNDS = {
  flicker: 'sfx:flickering-light',
};

export class StormOutage extends Component {
  /**
   * @param {object} opts
   * @param {import('./GameController.js').GameController} opts.controller
   * @param {{ level: number }} opts.sandstorm
   * @param {import('../systems/PowerGrid.js').PowerGrid} opts.grid
   * @param {() => void} opts.cutPower
   * @param {Record<string, THREE.Audio>} [opts.sounds]  Built from STORM_OUTAGE_SOUNDS when left out.
   * @param {() => number} [opts.random]
   */
  constructor({ controller, sandstorm, grid, cutPower, sounds = null, random = Math.random }) {
    super();
    Object.assign(this, { controller, sandstorm, grid, cutPower, sounds, random });
    this._flickering = null;   // seconds into the flicker, or null
    this._stormId = null;      // the storm the moment below belongs to
    this._at = null;           // when in it the power goes, or null once it has
    this._off = null;
  }

  onStart() {
    if (!this.sounds) this.sounds = this._buildSounds();
    this._off = this.controller.onNightStart?.(() => this.reset()) ?? null;
    this.reset();
  }

  onDestroy() {
    this._off?.();
    this._off = null;
    this._settle();
    for (const sound of Object.values(this.sounds ?? {})) {
      try { sound?.disconnect?.(); } catch (_) { /* never connected */ }
    }
  }

  reset() {
    this._stormId = null;
    this._at = null;
    this._settle();
  }

  onUpdate(dt) {
    if (this.controller.state !== 'playing') {
      if (this._flickering !== null) this._settle();
      return;
    }

    if (this._flickering !== null) {
      // Someone got there first (the switch, the UFO): stop flickering.
      if (!this.grid.on || this.grid.tripped) { this._settle(); return; }
      this._flickering += dt;
      // Worse as it goes.
      this.grid.brownout = Math.min(1, 0.5 + this._flickering / STORM_OUTAGE.flickerSeconds);
      if (this._flickering >= STORM_OUTAGE.flickerSeconds) {
        this._settle();
        this.cutPower();
      }
      return;
    }

    const progress = this.sandstorm.stormProgress;
    if (progress === null || progress === undefined) return;
    // A new storm: pick its moment.
    if (this.sandstorm.stormId !== this._stormId) {
      this._stormId = this.sandstorm.stormId;
      const [a, b] = STORM_OUTAGE.at;
      this._at = a + this.random() * (b - a);
    }
    if (this._at === null || progress < this._at) return;
    // Its moment has come — but a dead grid is waited for.
    if (!this.grid.on || this.grid.tripped) return;
    this._at = null;   // once a storm

    this._flickering = 0;
    this.grid.brownout = 0.5;
    const flicker = this.sounds?.flicker;
    if (flicker) {
      if (flicker.isPlaying) flicker.stop();
      flicker.setVolume(STORM_OUTAGE.flickerVolume);
      flicker.play();
    }
  }

  /** Lamps steady, buzz off. */
  _settle() {
    this._flickering = null;
    if (this.grid) this.grid.brownout = 0;
    const flicker = this.sounds?.flicker;
    if (flicker?.isPlaying) flicker.stop();
  }

  _buildSounds() {
    const engine = this.gameObject?.scene?.userData?.engine;
    const sounds = {};
    if (!engine?.audioListener || !engine.assets) return sounds;
    for (const [name, key] of Object.entries(STORM_OUTAGE_SOUNDS)) {
      if (engine.assets.has && !engine.assets.has(key)) continue;
      const buffer = engine.assets.get(key);
      if (!buffer) continue;
      const audio = new THREE.Audio(engine.audioListener);
      audio.setBuffer(buffer);
      sounds[name] = audio;
    }
    return sounds;
  }
}
