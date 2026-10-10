import * as THREE from 'three';

// ─────────────────────────────────────────────
// ClipVoice  –  one of a few clips, at random, from a point in the world
// ─────────────────────────────────────────────
// What the props that are handled share: a drive box knocking on the floor
// (ImpactSound) and a drive going into a reader (SnapSocket) each have a
// handful of clips for the one event, and play a different one each time.
//
//   const inserts = clipSet(['sfx:drive-insert-1', 'sfx:drive-insert-2']);
//   const voice   = new ClipVoice();
//   voice.play(gameObject, inserts, 0.8);   // true if a clip was started
//
// Not a Component: it has no frame of its own. Its owner says when, and
// calls dispose() when the scene is torn down.
//
//   • The sound is a THREE.PositionalAudio on the GameObject it is first
//     played from, built then and not before: a prop that is never touched
//     costs nothing.
//   • A set's clips are read from the asset cache the first time it is
//     played. Asked before the scene has an engine (a drive seated in its
//     box as the room is built), nothing is built and nothing given up on.
//   • Nothing is started while the browser is still holding audio back
//     (Chrome, until a click): a clip started then is not dropped, it
//     sounds when the audio wakes, long after the moment.
// ─────────────────────────────────────────────

/**
 * A set of clips to pick from: their manifest keys, their buffers once read
 * from the asset cache, and the one last played.
 * @param {string[]} keys
 * @param {AudioBuffer[]} [buffers]  Read by `keys` when left out.
 */
export const clipSet = (keys, buffers) => ({ keys, buffers, last: -1 });

/**
 * Which of `count` clips to play: any but `last`, the one just played, each
 * as likely as the others. `roll` is 0..1.
 * @param {number} count
 * @param {number} last  Index of the clip just played; -1 for none.
 * @param {number} roll
 */
export function pickClip(count, last, roll) {
  if (count <= 1) return 0;
  const repeatable = last < 0 || last >= count;
  const choices = repeatable ? count : count - 1;
  const pick = Math.min(Math.floor(roll * choices), choices - 1);
  return !repeatable && pick >= last ? pick + 1 : pick;
}

export class ClipVoice {
  /**
   * @param {object} [opts]
   * @param {THREE.Audio|null} [opts.sound]  Built the first time it is
   *        wanted when left out. Null: silent.
   * @param {() => number} [opts.random]  0..1, for the choice of clip.
   * @param {number} [opts.refDistance=1.5]  Full volume within this many
   *        metres; inverse falloff beyond.
   * @param {number} [opts.rolloff=1]
   */
  constructor({ sound, random = Math.random, refDistance = 1.5, rolloff = 1 } = {}) {
    this.sound = sound;
    this.random = random;
    this.refDistance = refDistance;
    this.rolloff = rolloff;
  }

  /**
   * Play one of `set`'s clips from `gameObject`, cutting one still sounding.
   * @param {import('../core/GameObject.js').GameObject} gameObject
   * @param {ReturnType<typeof clipSet>} set
   * @param {number} [volume=1]  Of the clip's own level.
   * @returns {boolean} Whether a clip was started.
   */
  play(gameObject, set, volume = 1) {
    const sound = this._ready(gameObject, set);
    if (!sound || sound.context?.state === 'suspended') return false;
    const buffers = set.buffers;
    if (!buffers?.length) return false;

    set.last = pickClip(buffers.length, set.last, this.random());
    if (sound.isPlaying) sound.stop();
    sound.setBuffer(buffers[set.last]);
    sound.setVolume(volume);
    sound.play();
    return true;
  }

  /** Stop, and take the sound out of the audio graph and the scene. */
  dispose() {
    const sound = this.sound;
    if (!sound) return;
    if (sound.isPlaying) sound.stop();
    try { sound.disconnect?.(); } catch (_) { /* never connected */ }
    sound.removeFromParent?.();
  }

  // ── Internals ─────────────────────────────

  /** The sound, with `set`'s clips read. Null when there is none to be had
   *  (yet). */
  _ready(gameObject, set) {
    if (this.sound !== undefined && set.buffers) return this.sound;
    const engine = gameObject?.scene?.userData?.engine;
    if (!engine) return null;
    set.buffers ??= readBuffers(engine, set.keys);
    if (this.sound === undefined) this.sound = this._build(engine, gameObject);
    return this.sound;
  }

  /** A point source on the GameObject. Null without audio. */
  _build(engine, gameObject) {
    if (!engine.audioListener) return null;
    const audio = new THREE.PositionalAudio(engine.audioListener);
    audio.setRefDistance(this.refDistance);
    audio.setRolloffFactor(this.rolloff);
    gameObject.object3d.add(audio);
    return audio;
  }
}

/** Clips from the asset cache; any not loaded are left out. */
function readBuffers(engine, keys) {
  const assets = engine.assets;
  if (!assets?.has) return [];
  return keys.filter(key => assets.has(key)).map(key => assets.get(key));
}
