import * as THREE from 'three';
import { Component } from '../core/Component.js';
import { loopable } from './GeneratorSound.js';

// ─────────────────────────────────────────────
// WindowSand  –  a storm's sand hitting the office window
// ─────────────────────────────────────────────
// One loop, heard only in a storm and only in the room the window is in.
// How loud is how close you stand to the glass: full at the pane and gone
// 3 m back, so walking up to the window brings it in.
//
//   level = storm (0..1)  ×  sandLevel(distance to the glass)
//
// The level then eases, so stepping in from a corridor or a storm blowing
// up never switches it. At zero the loop is stopped.
//
// Rooms don't know about gameplay, and this doesn't know about rooms: the
// scene hands it the window as a plain rectangle, how hard the storm is
// blowing, where the ears are and whether they are in the room.
// ─────────────────────────────────────────────

/** Tuning. Metres unless stated. */
export const WINDOW_SAND = {
  key: 'sfx:window-sand',
  /** Of the clip's own level, at the glass in a full storm. */
  volume: 0.8,
  /** Full within `near` of the glass; silent from `far`. A close-up sound:
   *  it comes in over the last couple of steps to the window. */
  near: 0.5,
  far: 3,
  /** Rate (per second) the level eases at. */
  rate: 4,
};

/** Below this the level counts as having arrived. */
const SETTLED = 1e-3;

const _ear = new THREE.Vector3();

/**
 * Distance from `p` to a window: a rectangle in the plane `z`, from `x0` to
 * `x1` across and `sill` to `top` up. To the pane itself in front of it, and
 * to its nearest edge from off to one side, above or below.
 * @param {{x: number, y: number, z: number}} p
 * @param {{x0: number, x1: number, z: number, sill: number, top: number}} win
 */
export function windowDistance(p, win) {
  const dx = Math.max(win.x0 - p.x, 0, p.x - win.x1);
  const dy = Math.max(win.sill - p.y, 0, p.y - win.top);
  return Math.hypot(dx, dy, p.z - win.z);
}

/** How much of the sand is heard `distance` from the glass, 0..1: all of it
 *  within `near`, none from `far`, and a smooth rise between. */
export function sandLevel(distance) {
  const { near, far } = WINDOW_SAND;
  const t = Math.min(Math.max((far - distance) / (far - near), 0), 1);
  return t * t * (3 - 2 * t);
}

export class WindowSand extends Component {
  /**
   * @param {object} opts
   * @param {{x0: number, x1: number, z: number, sill: number, top: number}} opts.window
   * @param {() => number} opts.storm  How hard the storm is blowing, 0..1.
   * @param {(out: THREE.Vector3) => THREE.Vector3} opts.listenerPosition
   * @param {(p: THREE.Vector3) => boolean} opts.isInside  Is that point in the window's room?
   * @param {THREE.Audio|null} [opts.sound]  Built from WINDOW_SAND.key when left out.
   */
  constructor({ window, storm, listenerPosition, isInside, sound }) {
    super();
    this.window = window;
    this.storm = storm;
    this.listenerPosition = listenerPosition;
    this.isInside = isInside;
    this.sound = sound;
    this._level = 0;
  }

  onStart() {
    if (this.sound === undefined) this.sound = this._buildSound();
  }

  onUpdate(dt) {
    const sound = this.sound;
    if (!sound) return;

    const ear = this.listenerPosition(_ear);
    const storm = Math.min(Math.max(this.storm() ?? 0, 0), 1);
    const target = storm > 0 && this.isInside(ear) ? storm * sandLevel(windowDistance(ear, this.window)) : 0;

    let level = this._level + (target - this._level) * (1 - Math.exp(-WINDOW_SAND.rate * dt));
    if (Math.abs(target - level) < SETTLED) level = target;
    this._level = level;

    if (level > 0) {
      sound.setVolume(WINDOW_SAND.volume * level);
      if (!sound.isPlaying) sound.play();
    } else if (sound.isPlaying) {
      sound.stop();
    }
  }

  onDestroy() {
    const sound = this.sound;
    if (!sound) return;
    if (sound.isPlaying) sound.stop();
    try { sound.disconnect?.(); } catch (_) { /* never connected */ }
  }

  /** The loop from its preloaded buffer, made click-free. Null without audio. */
  _buildSound() {
    const engine = this.gameObject?.scene?.userData?.engine;
    if (!engine?.audioListener || !engine.assets?.has?.(WINDOW_SAND.key)) return null;
    const audio = new THREE.Audio(engine.audioListener);
    audio.setBuffer(loopable(engine.assets.get(WINDOW_SAND.key), engine.audioListener.context));
    audio.setLoop(true);
    audio.setVolume(0);
    return audio;
  }
}
