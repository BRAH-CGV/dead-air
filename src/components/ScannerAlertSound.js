import * as THREE from 'three';
import { Component } from '../core/Component.js';

// ─────────────────────────────────────────────
// ScannerAlertSound  –  the signal lamp's beep
// ─────────────────────────────────────────────
// Rides on the SignalAlertLight and beeps once with every light-up: each
// time the lamp's `lit` goes from false to true. So it keeps the lamp's
// time whatever is driving it — the steady blink of a signal waiting to be
// scanned, or the frantic bursts as the UFO closes in — and it is silent
// whenever the lamp is: nothing to scan, the power off, the bulb blown.
//
// A beep still sounding at the next light-up is started over from its top.
// The steady blink never does that (the clip is 0.34 s, the lamp lights
// every 0.8 s); the frantic one does every time, so it stutters.
//
// The steady blink is a machine: the same beep every time. A frantic lamp
// is one being driven by the UFO's field, and sounds it — every flash gets
// a pitch and a level of its own, picked at random. Only slightly: it is
// still plainly the same beeper, wavering, not a different sound.
//
// Going dark doesn't cut a beep: it rings out.
//
// Unlike the base's other sounds this one is placed in the world, on the
// lamp: it is a small beeper on the desk, and hearing where it is, and how
// far, is the point of it — it calls you back to the terminal.
// ─────────────────────────────────────────────

/** Tuning. Metres unless stated. */
export const SCANNER_ALERT = {
  key: 'sfx:scanner-alert',
  /** Of the clip's own level, within `refDistance` of the lamp. */
  volume: 0.5,
  /** Full volume within this of the lamp; beyond it, inverse falloff
   *  (half at twice the distance with `rolloff` 1). The chair is ~1 m off. */
  refDistance: 2,
  rolloff: 1,
  /** What a beep may vary by, picked afresh for each one: `detune` in
   *  cents either side of the clip's own pitch (100 to a semitone), and
   *  `volume` as a share of `volume` above. */
  steady:  { detune: [0, 0],      volume: [1, 1] },
  /** While the lamp is frantic: about a semitone either side, and from a
   *  little over half as loud to a touch louder. Much wider than this and
   *  it stops sounding like the lamp's own beep. */
  frantic: { detune: [-120, 120], volume: [0.6, 1.1] },
};

/** A value from `[low, high]`, `roll` (0..1) of the way up it. */
const within = ([low, high], roll) => low + (high - low) * roll;

export class ScannerAlertSound extends Component {
  /**
   * @param {object} [opts]
   * @param {{ lit: boolean, frantic?: boolean }} [opts.light]  Left out,
   *        the GameObject this rides on.
   * @param {THREE.Audio|null} [opts.sound]  Built from SCANNER_ALERT.key
   *        when left out. Null: silent.
   * @param {() => number} [opts.random]  0..1, for the frantic beeps.
   */
  constructor({ light = null, sound, random = Math.random } = {}) {
    super();
    this.light = light;
    this.sound = sound;
    this.random = random;
    this._wasLit = false;
  }

  onStart() {
    this.light ??= this.gameObject;
    if (this.sound === undefined) this.sound = this._buildSound();
  }

  onUpdate(_dt) {
    const lit = !!this.light?.lit;
    if (lit && !this._wasLit) this._beep();
    this._wasLit = lit;
  }

  onDestroy() {
    const sound = this.sound;
    if (!sound) return;
    if (sound.isPlaying) sound.stop();
    try { sound.disconnect?.(); } catch (_) { /* never connected */ }
    sound.removeFromParent?.();
  }

  // ── Internals ─────────────────────────────

  /** The beep, from its top, at this light-up's pitch and level. */
  _beep() {
    const sound = this.sound;
    if (!sound) return;
    if (sound.isPlaying) sound.stop();
    const vary = this.light?.frantic ? SCANNER_ALERT.frantic : SCANNER_ALERT.steady;
    sound.setDetune(within(vary.detune, this.random()));
    sound.setVolume(SCANNER_ALERT.volume * within(vary.volume, this.random()));
    sound.play();
  }

  /** The clip from its preloaded buffer, as a point source on the lamp.
   *  Null without audio. */
  _buildSound() {
    const engine = this.gameObject?.scene?.userData?.engine;
    if (!engine?.audioListener || !engine.assets?.has?.(SCANNER_ALERT.key)) return null;
    const audio = new THREE.PositionalAudio(engine.audioListener);
    audio.setBuffer(engine.assets.get(SCANNER_ALERT.key));
    audio.setRefDistance(SCANNER_ALERT.refDistance);
    audio.setRolloffFactor(SCANNER_ALERT.rolloff);
    this.gameObject.object3d.add(audio);
    return audio;
  }
}
