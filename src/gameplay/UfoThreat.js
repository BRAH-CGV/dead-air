import * as THREE from 'three';
import { Component } from '../core/Component.js';
import { NIGHT_SECONDS } from './NightClock.js';

// ─────────────────────────────────────────────
// UfoThreat  –  the visitor that comes once a night
// ─────────────────────────────────────────────
// On its nights (UFO.nights — night 3), guaranteed, something comes for
// the base: it flashes into the sky beside the dish, in view of the office
// window, at a random time between 1:00 and 4:30 on the night clock. (For
// testing, summon() — the U key — brings it at once, on any night.)
//
//   waiting ─▶ approaching ─▶ expanding ─▶ lethal ─▶ gone
//                                              │
//                                              └─▶ caught (white-out, game over)
//
//   approaching  A big distorting blob crawls in on the radar, toward its
//                centre (overhead), and the signal lamp goes frantic. Out of
//                sight, `radarLead` seconds; then the flight sound starts and
//                the UFO is in the sky — far off and high, a thin searchlight
//                shaft under it — slowing all the way in. It is timed to stop
//                on the clip's loudest moment, measured off the decoded audio
//                itself. Over the last stretch every lamp in the base surges
//                and flickers.
//   expanding    Directly over the office, the shaft widens until it covers
//                the whole facility, and light floods in through the office
//                window.
//   lethal       Once it covers the base, it looks. If the grid is lit the
//                bulbs blow and the generator trips (PowerGrid.breakLights).
//                Anyone it can see is taken: everyone outside, and anyone in
//                view of the window — unless the power was cut first, because
//                a dark office has nothing to see in it. Caught with the
//                power on, the window's rooms stay deadly for the whole
//                visit, blown bulbs or not; stepping outside while it
//                holds is fatal either way.
//   gone         It teleports away. Bulbs stay broken until the next night;
//                the generator brings back the vital functions.
//
// Rooms don't know about gameplay, and this doesn't know about rooms: the
// scene hands it hooks for where the player's eye is, whether they are
// outside, and whether they are in view of the window (in the office).
// ─────────────────────────────────────────────

/** Tuning. Seconds and metres unless stated. */
export const UFO = {
  /** The nights it comes on — once each. */
  nights: [3],
  /** When it spawns (flashes into the sky), in night-clock hours after
   *  midnight: a random time between these. The radar warning comes
   *  radarLead seconds before. */
  spawnHours: [1, 4.5],
  /** Radar-only approach before the flight sound starts and it shows up. */
  radarLead: 20,
  /** Where the flight clip is loudest, if it can't be measured. */
  fallbackArrival: 23,
  /** The shaft widening to cover the base, before it turns lethal. */
  expandSeconds: 1.5,
  /** Lethal time over the base before teleporting away. */
  hoverSeconds: 5,
  /** The lamps surge over this long before it turns lethal. */
  surgeSeconds: 12,
  /** Where the approach starts: metres out along the ground and metres up.
   *  It flies a straight line down to the hover point, so it is never lower
   *  than that, and 800 m up keeps it ~45 m over the valley ridge (56 m
   *  high, 360 m out) — clear of the comm masts standing on it — from any
   *  bearing. */
  startDistance: 4000,
  startAltitude: 800,
  /** Where it spawns: always in plain view of the office window, between
   *  inViewFrom and inViewTo (radians) either side of the window's bearing
   *  — the open sky beside the dish tower, which fills the view straight
   *  out — far off near the edge of the valley. */
  inViewFrom: 0.2,
  inViewTo: 0.55,
  /** Metres out (along its path) when the sound starts and it appears —
   *  inside the camera's far plane, and through the haze. */
  visibleDistance: 700,
  /** The shaft's radius on the ground on the way in, and when it covers the
   *  facility. */
  thinRadius: 1.5,
  coverRadius: 32,
  /** Seconds the flight sound takes to die after the teleport. */
  soundFadeOut: 1.2,
};

const VOLUME = { flight: 0.5, flicker: 0.5, bulbBreak: 0.9, powerDown: 0.8, whoosh: 0.375, ringing: 0.7 };

/** Manifest keys behind each sound. */
export const UFO_SOUNDS = {
  flight:    'sfx:ufo-flight',
  flicker:   'sfx:flickering-light',
  bulbBreak: 'sfx:lightbulb-break',
  powerDown: 'sfx:power-down',
  whoosh:    'sfx:teleport-whoosh',
  ringing:   'sfx:ear-ringing',
};

const CAUGHT_PROMPT = 'You were taken. [E] to retry';

/** Seconds of drift from the flight sound that are corrected onto it. */
const AUDIO_SYNC_WINDOW = 0.5;

// ── Pure helpers ──────────────────────────────────────────

/**
 * When a clip is loudest: the peak of its loudness envelope, averaged over
 * `window` seconds so a click can't beat a long roar.
 * @param {{ rate: number, values: ArrayLike<number> }|null} envelope
 * @param {number} [fallback]
 * @param {number} [window=1]
 */
export function loudestTime(envelope, fallback = UFO.fallbackArrival, window = 1) {
  if (!envelope?.values?.length) return fallback;
  const { rate, values } = envelope;
  const n = Math.max(1, Math.round(window * rate));
  let sum = 0, best = -Infinity, first = 0, last = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= n) sum -= values[i - n];
    if (i < n - 1) continue;
    if (sum > best + 1e-6) { best = sum; first = last = i; }
    else if (sum >= best - 1e-6) last = i;
  }
  // Centre of the winning windows — the middle of a loud plateau, not its edge.
  return ((first + last) / 2 - (n - 1) / 2) / rate;
}

/** The night's beats, in seconds from the moment the blob shows up. */
export function ufoTimeline({
  radarLead = UFO.radarLead, soundArrival = UFO.fallbackArrival,
  expandSeconds = UFO.expandSeconds, hoverSeconds = UFO.hoverSeconds,
} = {}) {
  const soundStart = radarLead;
  const arrival = soundStart + soundArrival;
  const lethal = arrival + expandSeconds;
  return { soundStart, arrival, lethal, departure: lethal + hoverSeconds };
}

/**
 * Seconds into the night the approach begins — its radar warning — so that
 * it spawns (flashes into the sky, as its sound starts) at a random time in
 * UFO.spawnHours on the night clock. Infinity — never — on a night that
 * isn't one of UFO.nights.
 * @param {object} opts
 * @param {number} opts.night
 * @param {number} opts.nightDuration  Real seconds in the shift.
 * @param {number} [opts.nightHours=6] Clock hours in it (12:00 → 6:00 AM).
 * @param {() => number} [opts.random]
 */
export function scheduleApproach({ night, nightDuration, nightHours = 6, random = Math.random }) {
  if (!UFO.nights.includes(night)) return Infinity;   // not one of its nights
  const [from, to] = UFO.spawnHours;
  const hour = from + random() * (to - from);
  return Math.max(0, hour * (nightDuration / nightHours) - UFO.radarLead);
}

/**
 * Which way it comes from, as a bearing off the window's (0 = straight out
 * of it): always in the window's open sky, either side of the dish tower.
 * @returns {number} radians
 */
export function spawnBearing(random = Math.random) {
  const side = random() < 0.5 ? -1 : 1;
  return side * (UFO.inViewFrom + random() * (UFO.inViewTo - UFO.inViewFrom));
}

/**
 * Metres left to fly, along its path, at `t` seconds into the approach:
 * steady and unseen through the radar lead, then — once it is in the sky
 * with the sound — slowing all the way in, so the last stretch is a crawl.
 * @param {number} t
 * @param {{ soundStart: number, arrival: number }} timeline
 * @param {number} total  Path length.
 */
export function approachDistance(t, { soundStart, arrival }, total) {
  const visible = Math.min(UFO.visibleDistance, total);
  if (t <= soundStart) {
    const u = Math.max(t, 0) / soundStart;
    return total + (visible - total) * u;
  }
  const u = Math.min((t - soundStart) / (arrival - soundStart), 1);
  return visible * (1 - u) * (1 - u);
}

/** Where it is with `remaining` metres to go on the straight line from
 *  `start` to `hover`. */
export function pathPoint(remaining, start, hover, out) {
  const total = start.distanceTo(hover);
  return out.copy(hover).lerp(start, total > 0 ? remaining / total : 0);
}

/** Radar angles of a direction or position from the base: yaw 0 out of the
 *  window (−Z), pitch negative up — the sky's own convention. */
export function skyAngles(v) {
  const len = v.length() || 1;
  return {
    yaw: Math.atan2(v.x, -v.z),
    pitch: -Math.asin(Math.min(Math.max(v.y / len, -1), 1)),
  };
}

const smooth = (a, b, x) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

// ── Component ─────────────────────────────────────────────

const _eye = new THREE.Vector3();
const _pos = new THREE.Vector3();

export class UfoThreat extends Component {
  /** @type {'waiting'|'approaching'|'expanding'|'lethal'|'gone'|'caught'} */
  phase = 'waiting';

  /**
   * @param {object} opts
   * @param {import('./GameController.js').GameController} opts.controller
   * @param {import('../systems/PowerGrid.js').PowerGrid} opts.grid
   * @param {import('../gameobjects/Ufo.js').Ufo} opts.ufo
   * @param {object} opts.hooks
   * @param {(out: THREE.Vector3) => THREE.Vector3} opts.hooks.eyePosition
   * @param {(p: THREE.Vector3) => boolean} opts.hooks.isOutside
   * @param {(eye: THREE.Vector3) => boolean} opts.hooks.exposedToBeam  In view of the
   *        office window (BaseScene: anywhere in the main office)
   * @param {(locked: boolean) => void} opts.hooks.setPlayerLocked
   * @param {THREE.Vector3} [opts.hoverPoint]  Over the office. Default (0, 35, 0).
   * @param {{ light: THREE.Light, intensity: number }} [opts.flood]  The light
   *        pouring in through the office window while the beam covers the base.
   * @param {{ frantic: boolean }} [opts.signalLight]
   * @param {{ threat: object|null }} [opts.radar]
   * @param {{ exit: () => void }} [opts.terminal]
   * @param {{ play: Function, clear: Function }} [opts.whiteOut]
   * @param {Record<string, THREE.Audio>} [opts.sounds]  Built from UFO_SOUNDS when left out.
   * @param {number} [opts.nightDuration=NIGHT_SECONDS]  Real seconds in a shift.
   * @param {number} [opts.nightHours=6]      Clock hours in it.
   * @param {number} [opts.soundArrival]  Seconds into the flight clip to arrive
   *        at. Left out, it is measured off the clip (loudestTime).
   * @param {() => number} [opts.random]
   */
  constructor({
    controller, grid, ufo, hooks, hoverPoint = new THREE.Vector3(0, 35, 0), flood = null,
    signalLight = null, radar = null, terminal = null, whiteOut = null, sounds = null,
    nightDuration = NIGHT_SECONDS, nightHours = 6, soundArrival, random = Math.random,
  }) {
    super();
    Object.assign(this, { controller, grid, ufo, hooks, flood, signalLight, radar, terminal, whiteOut, sounds, nightDuration, nightHours, random });
    this.hoverPoint = hoverPoint.clone();
    this._soundArrival = soundArrival;

    /** What the radar draws. Written in place each frame. */
    this.radarThreat = { active: false, yaw: 0, pitch: 0, size: 0, intensity: 0, time: 0 };

    this._elapsed = 0;     // seconds of 'playing' this night
    this._start = 0;       // when the approach begins, in _elapsed
    this._t = 0;           // seconds since the approach began
    this._startPoint = new THREE.Vector3();
    this._pathLength = 1;
    this._judged = false;
    this._locked = false;
    this._flightStartedAt = null;
    this._flightFade = 0;
    this._off = null;
  }

  /** Seconds from the blob appearing to the UFO leaving. */
  get timeline() {
    return ufoTimeline({ soundArrival: this._soundArrival ?? UFO.fallbackArrival });
  }

  onStart() {
    if (!this.sounds) this.sounds = this._buildSounds();
    if (this._soundArrival === undefined) {
      this._soundArrival = loudestTime(this._envelope(this.sounds.flight?.buffer));
    }
    if (this.radar) this.radar.threat = this.radarThreat;
    this._off = this.controller.onNightStart?.(night => this.reset(night)) ?? null;
    this.reset(this.controller.nightNumber || 1);
  }

  onDestroy() {
    this._off?.();
    this._off = null;
    for (const sound of Object.values(this.sounds ?? {})) {
      if (sound?.isPlaying) sound.stop();
      try { sound?.disconnect?.(); } catch (_) { /* never connected */ }
    }
  }

  /** A fresh night: new bulbs, the generator back on, and a new visit. */
  reset(night) {
    this._elapsed = 0;
    this._newVisit();
    this._start = scheduleApproach({ night, nightDuration: this.nightDuration, nightHours: this.nightHours, random: this.random });
    this._stop('ringing');

    this.grid.repair();
    this.grid.setOn(true);
    this.whiteOut?.clear();
    if (this._locked) {
      this._locked = false;
      this.hooks.setPlayerLocked(false);
    }
  }

  /**
   * Bring it now rather than at its random time — the U debug key. Starts a
   * visit if none is under way (waiting, or already gone tonight) during a
   * shift; the damage and the night are left as they are.
   * @returns {boolean} whether a visit started
   */
  summon() {
    if (this.controller.state !== 'playing') return false;
    if (this.phase !== 'waiting' && this.phase !== 'gone') return false;
    this._newVisit();
    this._start = this._elapsed;
    return true;
  }

  /** Back to before a visit: a new path in, sounds and lamps at rest. */
  _newVisit() {
    this.phase = 'waiting';
    this._t = 0;
    this._judged = false;
    this._sawLights = false;
    this._appeared = false;

    const bearing = spawnBearing(this.random);
    this._startPoint.set(
      this.hoverPoint.x + Math.sin(bearing) * UFO.startDistance,
      UFO.startAltitude,
      this.hoverPoint.z - Math.cos(bearing) * UFO.startDistance,
    );
    this._pathLength = this._startPoint.distanceTo(this.hoverPoint);

    this._stop('flight');
    this._stop('flicker');
    this._flightStartedAt = null;
    this._flightFade = 0;
    this._calm();
    this.ufo.setVisible(false);
  }

  onUpdate(dt) {
    this._fadeFlight(dt);
    this.ufo.tick?.(dt);
    if (this.phase === 'caught' || this.phase === 'gone') return;

    if (this.controller.state !== 'playing') {
      if (this.phase !== 'waiting') this._standDown();
      return;
    }

    this._elapsed += dt;
    if (this.phase === 'waiting') {
      if (this._elapsed < this._start) return;
      this.phase = 'approaching';
    }
    this._advance(dt);

    const tl = this.timeline;
    const t = this._t;

    if (t >= tl.soundStart && this._flightStartedAt === null) this._startFlight();

    if (t < tl.arrival) this._approach(t, tl);
    else if (t < tl.lethal) this._expand(t, tl);
    else if (t < tl.departure) this._hold(t, tl);
    else this._depart();
  }

  // ── Beats ───────────────────────────────

  _approach(t, tl) {
    const remaining = approachDistance(t, tl, this._pathLength);
    pathPoint(remaining, this._startPoint, this.hoverPoint, _pos);
    this.ufo.setPose(_pos);

    // In the sky — and its searchlight on — from the moment it is heard,
    // bursting in as it appears.
    const inSky = t >= tl.soundStart;
    if (inSky && !this._appeared) {
      this._appeared = true;
      this.ufo.appear?.();
    }
    this.ufo.setVisible(inSky);
    this.ufo.setBeam(inSky ? 1 : 0, UFO.thinRadius);

    this._updateRadar(_pos, 1 - remaining / this._pathLength, t);
    if (this.signalLight) this.signalLight.frantic = true;
    this._surge(t, tl);
  }

  _expand(t, tl) {
    this.phase = 'expanding';
    this.ufo.setPose(this.hoverPoint);
    this.ufo.setVisible(true);
    const k = smooth(tl.arrival, tl.lethal, t);
    this.ufo.setBeam(1, UFO.thinRadius + (UFO.coverRadius - UFO.thinRadius) * k);
    this._setFlood(k);
    this._updateRadar(this.hoverPoint, 1, t);
    this._surge(t, tl);
  }

  _hold(t, tl) {
    if (!this._judged) {
      this._judged = true;
      this.phase = 'lethal';
      this.ufo.setPose(this.hoverPoint);
      this.ufo.setBeam(1, UFO.coverRadius);
      this._setFlood(1);
      this.grid.surge = 0;
      this._stop('flicker');
      // Judged before the bulbs go: the lit office is what gave you away —
      // and having seen it lit, it watches those rooms for the whole visit.
      this._sawLights = this.grid.lit;
      const caught = this._exposed();
      if (this.grid.lit) {
        this.grid.breakLights();
        this._play('bulbBreak');
        this._play('powerDown');
      }
      if (caught) { this._catch(); return; }
    } else if (this._exposed()) {
      this._catch();
      return;
    }
    this._updateRadar(this.hoverPoint, 1, t);
  }

  _depart() {
    this.phase = 'gone';
    this._play('whoosh');
    this.ufo.teleport?.();
    this.ufo.setVisible(false);
    this._fadeOutFlight();
    this._calm();
  }

  _catch() {
    this.phase = 'caught';
    this.controller.fail(CAUGHT_PROMPT);
    this.terminal?.exit();
    this.whiteOut?.play(CAUGHT_PROMPT);
    this._play('ringing');
    this._fadeOutFlight();
    this._locked = true;
    this.hooks.setPlayerLocked(true);
    // The beam stays on: it is the last thing seen as the screen burns white.
    this._calm({ keepBeam: true });
  }

  /** The shift ended mid-visit (quota, debug key). Call the whole thing off. */
  _standDown() {
    this.phase = 'gone';
    this.ufo.setVisible(false);
    this._fadeOutFlight();
    this._calm();
  }

  /** Is the player somewhere it can take them right now? */
  _exposed() {
    const eye = this.hooks.eyePosition(_eye);
    if (this.hooks.isOutside(eye)) return true;
    return (this._sawLights || this.grid.lit) && this.hooks.exposedToBeam(eye);
  }

  _surge(t, tl) {
    this.grid.surge = smooth(tl.arrival - UFO.surgeSeconds, tl.lethal, t);
    this._updateFlicker();
  }

  _setFlood(level) {
    if (this.flood?.light) this.flood.light.intensity = this.flood.intensity * level;
  }

  /** Lamps, radar, flood and beam back to rest. */
  _calm({ keepBeam = false } = {}) {
    this.grid.surge = 0;
    this._stop('flicker');
    if (this.signalLight) this.signalLight.frantic = false;
    this.radarThreat.active = false;
    if (!keepBeam) {
      this.ufo.setBeam(0);
      this._setFlood(0);
    }
  }

  _updateRadar(pos, closeness, t) {
    const r = this.radarThreat;
    const { yaw, pitch } = skyAngles(pos);
    r.active = true;
    r.yaw = yaw;
    r.pitch = pitch;
    r.size = 0.12 + 0.88 * closeness * closeness;
    r.intensity = Math.min(1, 0.25 + closeness);
    r.time = t;
  }

  _updateFlicker() {
    const flicker = this.sounds?.flicker;
    if (!flicker) return;
    const volume = this.grid.lit ? this.grid.surge * VOLUME.flicker : 0;
    if (volume > 0.01) {
      if (!flicker.isPlaying) { flicker.setLoop?.(true); flicker.setVolume(volume); flicker.play(); }
      flicker.setVolume(volume);
    } else {
      this._stop('flicker');
    }
  }

  // ── Time, synced to the flight sound ────

  /** Seconds since the approach began: summed frame time, pulled toward the
   *  audio clock while the flight sound plays, so the UFO lands on the
   *  clip's peak however the frames fall. The pull is bounded — time runs
   *  between half and one-and-a-half speed, never backwards or stopped — and
   *  only small drift is chased: a clock far off (a suspended audio context,
   *  a debug jump) is not the reference. */
  _advance(dt) {
    this._t += dt;
    const flight = this.sounds?.flight;
    const ctx = flight?.context;
    if (this._flightStartedAt === null || !flight?.isPlaying || ctx?.state !== 'running') return;
    const gap = this.timeline.soundStart + (ctx.currentTime - this._flightStartedAt) - this._t;
    if (Math.abs(gap) < AUDIO_SYNC_WINDOW) this._t += Math.min(Math.max(gap, -dt / 2), dt / 2);
  }

  _startFlight() {
    const flight = this.sounds?.flight;
    this._flightStartedAt = flight?.context?.currentTime ?? 0;
    this._play('flight');
  }

  _fadeOutFlight() {
    if (this.sounds?.flight?.isPlaying) this._flightFade = UFO.soundFadeOut;
  }

  _fadeFlight(dt) {
    if (this._flightFade <= 0) return;
    this._flightFade = Math.max(0, this._flightFade - dt);
    const flight = this.sounds?.flight;
    if (!flight) return;
    flight.setVolume(VOLUME.flight * (this._flightFade / UFO.soundFadeOut));
    if (this._flightFade === 0) this._stop('flight');
  }

  // ── Sound plumbing ──────────────────────

  _play(name) {
    const sound = this.sounds?.[name];
    if (!sound) return;
    if (sound.isPlaying) sound.stop();
    sound.setVolume(VOLUME[name] ?? 1);
    sound.play();
  }

  _stop(name) {
    const sound = this.sounds?.[name];
    if (sound?.isPlaying) sound.stop();
  }

  /** One THREE.Audio per sound, on the engine's listener, from the
   *  preloaded buffers. Missing buffers are left out — silence, not a crash. */
  _buildSounds() {
    const engine = this.gameObject?.scene?.userData?.engine;
    const sounds = {};
    if (!engine?.audioListener || !engine.assets) return sounds;
    for (const [name, key] of Object.entries(UFO_SOUNDS)) {
      if (engine.assets.has && !engine.assets.has(key)) continue;
      const buffer = engine.assets.get(key);
      if (!buffer) continue;
      const audio = new THREE.Audio(engine.audioListener);
      audio.setBuffer(buffer);
      if (name === 'flicker' || name === 'ringing') audio.setLoop(true);
      sounds[name] = audio;
    }
    return sounds;
  }

  /** Loudness envelope of an AudioBuffer, 20 samples a second. */
  _envelope(buffer) {
    if (!buffer?.getChannelData) return null;
    const data = buffer.getChannelData(0);
    const window = Math.max(1, Math.floor(buffer.sampleRate / 20));
    const values = new Float32Array(Math.ceil(data.length / window));
    for (let i = 0; i < values.length; i++) {
      let sum = 0;
      const end = Math.min((i + 1) * window, data.length);
      for (let j = i * window; j < end; j++) sum += data[j] * data[j];
      values[i] = Math.sqrt(sum / (end - i * window));
    }
    return { rate: buffer.sampleRate / window, values };
  }
}
