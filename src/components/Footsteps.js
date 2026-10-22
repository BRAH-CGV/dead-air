import * as THREE from 'three';
import { Component } from '../core/Component.js';
import { FootstepLogic } from '../gameplay/FootstepLogic.js';
import { EVASuit } from './EVASuit.js';

// ─────────────────────────────────────────────
// Footsteps  –  the player's own feet
// ─────────────────────────────────────────────
// On the player beside its FirstPersonController. FootstepLogic says when a
// foot comes down (a step every stride, a jump's push-off, a landing); this
// plays it from sfx:steps, one recording cut by hand (STEP_SOUNDS):
//
//   • indoors, one of three interior steps, never the same twice running;
//   • outside, one of two outdoor thumps (`thump`), the sand's crunch,
//     with the interior step under it turned well down (`outsideShare`);
//   • indoors on a desk or a table (`surfaceUnder` 'wood'), one of two
//     wood thuds (sfx:steps-wood), as quiet as a step on the floor;
//   • on the bed, an interior step heard through the mattress: quieter,
//     low-passed hard (`bed`, `bedLowpass`).
//
// Each is pitched and levelled a touch apart. The recording is hot, so
// every level is well under its own, and the interior steps' hiss is
// filtered off (`lowpass`); in the EVA suit lower still (`suitLowpass`),
// muffled, heard from inside the helmet. The outdoor thumps keep their
// crunch: unfiltered, and only lightly muffled in the suit. Not while the controller is off (the
// fly camera, a cutscene). From the player, not placed in the world.
// ─────────────────────────────────────────────

/** Tuning. */
export const STEP_SOUNDS = {
  key: 'sfx:steps',
  /** [start, length] in seconds: three interior steps, two outdoor thumps. */
  interior: [[0, 0.47], [0.91, 0.5], [1.85, 0.47]],
  exterior: [[2.46, 0.38], [3.09, 0.49]],
  /** On wood (a desk, a table): two thuds of their own, in sfx:steps-wood,
   *  cut from a trapdoor recording and normalised to the interior steps. */
  woodKey: 'sfx:steps-wood',
  wood: [[0, 0.4], [0.7, 0.42]],
  woodVoices: 2,
  /** On the bed: an interior step at this share of its level, low-passed
   *  at `bedLowpass` Hz: through the mattress. */
  bed: 0.6,
  bedLowpass: 400,
  /** An ordinary step's level indoors (the clips peak over full scale). */
  volume: 0.045,
  /** Outside: the interior step's share, and the thump's level under it. */
  outsideShare: 0.3,
  thump: 0.11,
  /** Hz: the interior steps' hiss, which hangs on after the thud, filtered
   *  off; and lower in the EVA suit, heard from inside the helmet. */
  lowpass: 3000,
  suitLowpass: 1200,
  /** Hz for the outdoor thumps: their crunch is the point, so nothing off
   *  them out of the suit and only a light muffle in it (always, outside). */
  thumpLowpass: 20000,
  thumpSuitLowpass: 5000,
  /** Each step between `jitter` and all of its level, and ± this many cents. */
  jitter: 0.8,
  detune: 80,
  /** Voices, so a step and a thump (and a landing on a step) overlap. */
  voices: 4,
};

/** The whole of the footsteps' level in the dreams: quieter than at the base. */
export const DREAM_FOOTSTEPS = 0.3;

export class Footsteps extends Component {
  /**
   * @param {object} opts
   * @param {object} [opts.controller]  Left out, the GameObject's FirstPersonController
   *        (grounded, groundSpeed, vertVel, crouched, enabled).
   * @param {() => boolean} [opts.isOutside]
   * @param {() => 'floor'|'wood'|'bed'} [opts.surfaceUnder]  What the feet
   *        are on, asked as each foot comes down.
   * @param {{ worn: boolean }} [opts.suit]  The EVA suit: muffled while worn.
   *        Left out, the GameObject's EVASuit, found when first wanted (the
   *        scene puts it on the player after the footsteps).
   * @param {THREE.Audio[]|null} [opts.voices]  Built from STEP_SOUNDS.key when left out.
   * @param {THREE.Audio[]|null} [opts.woodVoices]  Built from STEP_SOUNDS.woodKey when left out.
   * @param {() => number} [opts.random]
   * @param {number} [opts.level=1]  The whole of it, on top of STEP_SOUNDS
   *        (the dreams: DREAM_FOOTSTEPS).
   */
  constructor({
    controller = null, isOutside = () => false, surfaceUnder = () => 'floor', suit = null,
    voices, woodVoices, random = Math.random, level = 1,
  } = {}) {
    super();
    this.level = level;
    this.controller = controller;
    this.isOutside = isOutside;
    this.surfaceUnder = surfaceUnder;
    this.suit = suit;
    this.woodVoices = woodVoices;
    this._filters = new Map();
    this.voices = voices;
    this.random = random;
    this.logic = new FootstepLogic();
    this._next = { steps: 0, wood: 0 };
    this._last = { interior: -1, exterior: -1, bed: -1, wood: -1 };
  }

  onStart() {
    const engine = this.gameObject?.scene?.userData?.engine;
    this.controller ??= engine?.playerController ?? null;
    if (this.voices === undefined) this.voices = this._build(engine, STEP_SOUNDS.key, STEP_SOUNDS.voices);
    if (this.woodVoices === undefined) this.woodVoices = this._build(engine, STEP_SOUNDS.woodKey, STEP_SOUNDS.woodVoices);
    this.voices ??= [];
    this.woodVoices ??= [];
  }

  onUpdate(dt) {
    const c = this.controller;
    if (!c || c.enabled === false) return;
    const events = this.logic.update(dt, {
      grounded: !!c.grounded, speed: c.groundSpeed ?? 0, vertVel: c.vertVel ?? 0, crouched: !!c.crouched,
    });
    if (!events.length || !this.voices.length) return;
    const outside = this.isOutside();
    for (const e of events) {
      const level = STEP_SOUNDS.volume * e.weight;
      if (outside) {
        this._play('interior', level * STEP_SOUNDS.outsideShare);
        this._play('exterior', STEP_SOUNDS.thump * e.weight);
        continue;
      }
      const surface = this.surfaceUnder();
      if (surface === 'wood' && this.woodVoices.length) this._play('wood', level);
      else if (surface === 'bed') this._play('bed', level * STEP_SOUNDS.bed);
      else this._play('interior', level);
    }
  }

  /** Hz a kind of step ('interior' | 'exterior') is low-passed at now:
   *  lower in the suit. */
  cutoff(kind) {
    this.suit ??= this.gameObject?.getComponent?.(EVASuit) ?? null;
    const worn = !!this.suit?.worn;
    if (kind === 'exterior') return worn ? STEP_SOUNDS.thumpSuitLowpass : STEP_SOUNDS.thumpLowpass;
    if (kind === 'bed') return Math.min(STEP_SOUNDS.bedLowpass, worn ? STEP_SOUNDS.suitLowpass : Infinity);
    return worn ? STEP_SOUNDS.suitLowpass : STEP_SOUNDS.lowpass;
  }

  onDestroy() {
    for (const v of [...(this.voices ?? []), ...(this.woodVoices ?? [])]) {
      if (v.isPlaying) v.stop();
      try { v.disconnect?.(); } catch (_) { /* never connected */ }
    }
  }

  /** One of a kind's clips ('interior' | 'exterior' | 'bed' | 'wood'),
   *  never the one it played last, on the next voice of its pool. */
  _play(kind, level) {
    const clips = kind === 'bed' ? STEP_SOUNDS.interior : STEP_SOUNDS[kind];
    let i = Math.floor(this.random() * (clips.length - 1));
    if (i >= this._last[kind]) i++;
    if (this._last[kind] < 0) i = Math.floor(this.random() * clips.length);
    this._last[kind] = i;
    const pool = kind === 'wood' ? 'wood' : 'steps';
    const voices = pool === 'wood' ? this.woodVoices : this.voices;
    const v = voices[this._next[pool]];
    this._next[pool] = (this._next[pool] + 1) % voices.length;
    const filter = this._filters.get(v);
    if (filter) filter.frequency.value = this.cutoff(kind);
    if (v.isPlaying) v.stop();
    v.offset = clips[i][0];
    v.duration = clips[i][1];
    v.setVolume(this.level * level * (STEP_SOUNDS.jitter + (1 - STEP_SOUNDS.jitter) * this.random()));
    v.setDetune(STEP_SOUNDS.detune * (this.random() * 2 - 1));
    v.play();
  }

  _build(engine, key, count) {
    if (!engine?.audioListener || !engine.assets?.has?.(key)) return null;
    const buffer = engine.assets.get(key);
    return Array.from({ length: count }, () => {
      const audio = new THREE.Audio(engine.audioListener);
      audio.setBuffer(buffer);
      const filter = audio.context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = STEP_SOUNDS.lowpass;
      audio.setFilter(filter);
      this._filters.set(audio, filter);
      return audio;
    });
  }
}
