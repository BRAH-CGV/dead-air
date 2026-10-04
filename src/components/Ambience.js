import * as THREE from 'three';
import { Component } from '../core/Component.js';

// ─────────────────────────────────────────────
// Ambience  –  the base's room tone, and the music under a scare
// ─────────────────────────────────────────────
// Two layers of looping sound, neither tied to a place in the stereo field:
//
//   rooms   one loop per room, and the wind outside. Which are heard, and
//           how loud, comes from an AmbienceMix read at the listener's
//           position every frame: the room you stand in, or a blend of
//           two down a corridor. The gains then ease toward that, so a
//           teleport fades too — and so does the airlock, whose sound
//           switches from the office to the wind as its hatch opens.
//
//   music   one loop that follows the tension, 0..1. Whatever is hunting the
//           player raises it under a name of its own —
//
//               ambience.setTension(1, 'window-entity');   // it is here
//               ambience.setTension(0, 'window-entity');   // it has gone
//
//           — and the music follows the most tense of them, creeping in and
//           out over several seconds rather than starting and stopping.
//
// Volumes are the clips' own: each was mixed to the loudest it should ever
// be. The exception is a per-track trim in AMBIENCE.volumes, for balancing
// one room against the others without re-exporting its clip.
//
// A loop at zero is stopped, not left running silent, and starts again from
// its top the next time it is wanted.
//
// The clips are fetched when the scene starts, not preloaded (see the
// manifest), and each fades in as it arrives.
// ─────────────────────────────────────────────

/** Tuning. Seconds unless stated. */
export const AMBIENCE = {
  /** Manifest key of the loop for each room, by room name. The airlock has
   *  none: it hears the office or the wind, by which door last stood open
   *  (BaseScene._addAmbience). */
  rooms: {
    MainOffice:     'sfx:interior-base-ambience-centre-room',
    ServerRoom:     'sfx:interior-base-ambience-server-room',
    LivingQuarters: 'sfx:interior-base-ambience-bed-room',
  },
  /** Trim per track, by manifest key: a multiplier on the clip's own level.
   *  Left out is 1. The office loop is lifted about 1.6 dB. */
  volumes: {
    'sfx:interior-base-ambience-centre-room': 1.2,
    // Its file is ~23 dB hotter than the spooky track; this brings it down
    // to the same loudness.
    'sfx:interior-base-ambient-music': 0.07,
  },
  /** The loop heard everywhere that isn't the base: the wind. */
  outside: 'sfx:exterior-base-ambience-wind',
  /** The tension music. */
  music: 'sfx:interior-base-spooky-music',
  /** A second, calmer music track. Nothing in the game raises it yet; it is
   *  on a test key (BaseScene._addAmbience). */
  ambientMusic: 'sfx:interior-base-ambient-music',
  /** Rate (per second) the room gains ease toward the mix at. */
  blendRate: 4,
  /** Time for the music to creep from silence to full… */
  musicFadeIn: 4,
  /** …and from full back to silence. */
  musicFadeOut: 6,
  /** Length of the crossfade over each loop's seam. */
  seamSeconds: 0.25,
};

/** The tension source the test key holds. */
const TEST_SOURCE = 'test-key';

/** Below this a gain counts as having arrived. */
const SETTLED = 1e-3;

/** Buffers whose seam is already blended — they are cached, and the scene
 *  can be rebuilt around them. */
const _seamed = new WeakMap();

const _ear = new THREE.Vector3();

/**
 * Make a clip loop without a click, in place.
 *
 * A clip cut from a longer recording ends mid-wave, a jump away from where
 * it starts. This rewrites the last `fadeSeconds` as the tail fading out
 * under a copy of the head fading in, so the clip now ends on the sample
 * just before the returned time — loop from there (`setLoopStart`) and the
 * wrap is continuous.
 *
 * In place, unlike SuitVisor's seamlessLoop, because these loops are long:
 * a copy of them all would cost another ~195 MB.
 *
 * @param {Float32Array[]} channels  One array per channel, equal lengths.
 * @param {number} sampleRate
 * @param {number} [fadeSeconds]
 * @returns {number}  Loop start in seconds; 0 if the clip is too short to fade.
 */
export function blendLoopSeam(channels, sampleRate, fadeSeconds = AMBIENCE.seamSeconds) {
  const n = channels[0]?.length ?? 0;
  const f = Math.floor(fadeSeconds * sampleRate);
  if (f < 1 || f * 2 > n) return 0;

  for (const data of channels) {
    for (let k = 0; k < f; k++) {
      const t = ((k + 1) / f) * Math.PI / 2;
      data[n - f + k] = data[n - f + k] * Math.cos(t) + data[k] * Math.sin(t);
    }
  }
  return f / sampleRate;
}

export class Ambience extends Component {
  /**
   * @param {object} opts
   * @param {import('../systems/AmbienceMix.js').AmbienceMix} opts.mix
   * @param {(out: THREE.Vector3) => THREE.Vector3} opts.listenerPosition
   * @param {string|null} [opts.music]  Manifest key of the tension music.
   * @param {Record<string, number>} [opts.volumes]  Trim by track key.
   * @param {Record<string, THREE.Audio>} [opts.sounds]  By track key. Left
   *        out, each is built on `engine.audioListener` as its clip loads.
   * @param {Record<string, string>|null} [opts.testKeys]  Testing only:
   *        KeyboardEvent.code → a music track. A press swings that track
   *        fully in; pressing it again swings it back out.
   */
  constructor({
    mix, listenerPosition, music = AMBIENCE.music, volumes = AMBIENCE.volumes,
    sounds = null, testKeys = null,
  }) {
    super();
    this.mix = mix;
    this.listenerPosition = listenerPosition;
    this.music = music;
    this.volumes = volumes ?? {};
    this.sounds = sounds;
    this.testKeys = testKeys;
    this._onKey = null;
    /** The track a threat's tension raises; a test key borrows `music`. */
    this._ownMusic = music;
    /** Every music track: the real one, and any on a test key. */
    this._musics = [...new Set([music, ...Object.values(testKeys ?? {})])].filter(Boolean);

    /** Where the mix wants each room track, and where each is now. */
    this._targets = {};
    this._gains = {};
    for (const track of mix.tracks) this._gains[track] = 0;

    /** Tension asked for, by who asked. */
    this._tensions = new Map();
    this._tension = 0;
    this._musicGains = {};
    for (const track of this._musics) this._musicGains[track] = 0;
    /** The volume last set on each sound, by track. */
    this._applied = {};

    this._destroyed = false;
  }

  /** The tension the music is heading for, 0..1: the highest anyone asked for. */
  get tension() {
    return this._tension;
  }

  /**
   * Raise or drop the tension. Each threat uses a `source` name of its own,
   * so one letting go doesn't silence another that still holds.
   * @param {number} level  0..1; 0 lets go.
   * @param {string} [source='default']
   */
  setTension(level, source = 'default') {
    const clamped = Math.min(Math.max(level, 0), 1);
    if (clamped > 0) this._tensions.set(source, clamped);
    else this._tensions.delete(source);

    let highest = 0;
    for (const value of this._tensions.values()) highest = Math.max(highest, value);
    this._tension = highest;
  }

  /** Every source lets go: a new night, a retry. */
  clearTension() {
    this._tensions.clear();
    this._tension = 0;
  }

  onStart() {
    if (this.testKeys && typeof addEventListener === 'function') {
      this._onKey = e => this.onKeyDown(e);
      addEventListener('keydown', this._onKey);
    }
    if (this.sounds) return;
    this.sounds = {};
    this._loadSounds();
  }

  /** A test key: its track at full tension on one press, let go on the
   *  next. Another key's track crossfades in over the one playing. The keys
   *  hold a tension source of their own, so a real threat's is left alone,
   *  and letting go hands the music back to the real track. */
  onKeyDown(e) {
    const track = this.testKeys?.[e.code];
    if (!track || e.repeat) return;
    const release = this._tensions.has(TEST_SOURCE) && this.music === track;
    this.music = release ? this._ownMusic : track;
    this.setTension(release ? 0 : 1, TEST_SOURCE);
    console.log(`[DEBUG] Tension music ${track} fading ${release ? 'out' : 'in'}`);
  }

  onUpdate(dt) {
    // ── Rooms: ease each loop toward the mix where the ears are ──
    const targets = this.mix.weightsAt(this.listenerPosition(_ear), this._targets);
    const k = 1 - Math.exp(-AMBIENCE.blendRate * dt);
    for (const track of this.mix.tracks) {
      const target = targets[track];
      let gain = this._gains[track];
      gain += (target - gain) * k;
      if (Math.abs(target - gain) < SETTLED) gain = target;
      this._gains[track] = gain;
      this._drive(track, gain);
    }

    // ── Music: a steady creep toward the tension ──
    // Only `music` follows it; a track a test key has let go of creeps out.
    for (const track of this._musics) {
      const target = track === this.music ? this._tension : 0;
      const gain = this._musicGains[track];
      this._musicGains[track] = target > gain
        ? Math.min(target, gain + dt / AMBIENCE.musicFadeIn)
        : Math.max(target, gain - dt / AMBIENCE.musicFadeOut);
      this._drive(track, this._musicGains[track]);
    }
  }

  onDestroy() {
    this._destroyed = true;
    if (this._onKey) removeEventListener('keydown', this._onKey);
    this._onKey = null;
    for (const sound of Object.values(this.sounds ?? {})) {
      if (sound.isPlaying) sound.stop();
      // THREE.Audio connects itself to the listener on construction; unhook
      // it so a restart doesn't leave dead nodes in the audio graph.
      try { sound.disconnect?.(); } catch (_) { /* never connected */ }
    }
  }

  // ── Internals ─────────────────────────────

  /** Play `track` at `gain` times its trim; at zero, stop it. */
  _drive(track, gain) {
    const sound = this.sounds?.[track];
    if (!sound) return;
    gain *= this.volumes[track] ?? 1;
    if (gain > 0) {
      // Only on a change: a settled loop schedules nothing on the audio clock.
      if (this._applied[track] !== gain) {
        sound.setVolume(gain);
        this._applied[track] = gain;
      }
      if (!sound.isPlaying) sound.play();
    } else if (sound.isPlaying) {
      sound.stop();
      this._applied[track] = 0;
    }
  }

  /** Fetch every clip and build its looping THREE.Audio as it arrives. A clip
   *  that fails to load is left out, and its room is silent. */
  _loadSounds() {
    const engine = this.gameObject?.scene?.userData?.engine;
    if (!engine?.audioListener || !engine.assets?.load) return;

    const keys = [...this.mix.tracks, ...this._musics];
    for (const key of keys) {
      engine.assets.load(key).then((buffer) => {
        if (this._destroyed) return;
        const sound = new THREE.Audio(engine.audioListener);
        sound.setBuffer(buffer);
        sound.setLoop(true);
        sound.setLoopStart(seamOf(buffer));
        sound.setVolume(0);
        this.sounds[key] = sound;
      }).catch(err => console.warn(`[Ambience] no ${key} — ${err.message}`));
    }
  }
}

/** Blend `buffer`'s seam the first time it is seen; its loop start, always. */
function seamOf(buffer) {
  if (!_seamed.has(buffer)) {
    const channels = [];
    for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));
    _seamed.set(buffer, blendLoopSeam(channels, buffer.sampleRate));
  }
  return _seamed.get(buffer);
}
