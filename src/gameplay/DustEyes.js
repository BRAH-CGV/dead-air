import * as THREE from 'three';
import { Component } from '../core/Component.js';
import { synthGrowl } from './Growl.js';

// ─────────────────────────────────────────────
// DustEyes  –  the things that watch from the storm
// ─────────────────────────────────────────────
// From night 2, while a sandstorm is blowing hard, pairs of yellow eyes
// in a dark-dust silhouette surface in the murk. Two places, each with its
// own cap (maxEyes):
//
//   yard     ('fence') just beyond the chain-link round the yard — the
//            common ones: a roll every checkSeconds (spawnChance: 8 % on
//            night 2, 20 % from night 3), whether the player is in or
//            out (they wait out there), up to 3 (night 2) or 4. From night
//            3, stepping out into the storm always brings one within
//            guaranteeDelay.
//   window   ('window') out past the office window, deep in the fog and
//            fainter (windowIntensity, windowDim) — the rare ones: rolled
//            only while the player is indoors, 1 (night 2) or 2 at most, and
//            windowCooldown between them. One that is stared at shows its
//            snarl, backs off into the fog — and comes round to the yard,
//            agitated: darker orange, far quicker to turn, and there until
//            the storm ends.
//
// Neither kind leaves when the player goes in or out; they drift off in
// their own time.
//
// Halfway through every storm (midwayAt) comes a check that always brings
// some: one to the yard (two from night 3), and one to the window unless one
// is there already — past the caps and the window's cooldown.
//
// Noise draws them too: finishing the generator's panel in a storm (on or
// off — generatorNoise) has an even chance (generatorChance) of setting a
// yard eye on the player — one watching turns, or one comes already turned.
//
// Staying out is the other danger. From graceSeconds after the airlock
// hatch opens, every aggroRollSeconds each watching yard eye rolls
// aggroChance (agitatedAggroChance if agitated) to turn on its own, growling
// passiveGrowlSeconds before it leaps. Only one turns that way at a time —
// but looking at another during the chase brings that one too.
//
// While they watch, they drift slowly from side to side. A yard eye is
// never put in the trees, nor where a tree or something solid (the buggy,
// the generator) stands between it and the player (sightBlocked), and it
// mostly comes in front of them (inViewChance — always, for the J key), and a chasing or
// leaping eye goes round the solid things in the yard — the buggy, the
// generator (`obstacles`, steerAround) — never through them.
//
// Each one hangs there, passive, for a while and drifts off again — or
// goes when the storm drops. Looking is the danger:
//
//   passive ──stared at (stareSeconds)──▶ growling ──growlSeconds──▶ leaping ──▶ chasing
//      │                 (still, red eyes, jaws shut,      (jaws open, a hop
//      │                  a low growl)                      that closes the gap
//      │                                                    — never onto you)
//      │                                                         │
//      │                       caught (catchDistance) ◀──────────┤──▶ gone: the player
//      │                       eaten: a red screen, [E] retries  │   is indoors with the
//      │                                                         │   airlock hatch shut
//      └──seen through the window (windowStareSeconds)──▶ retreating ──retreatSeconds──▶ gone
//                       (jaws shut, a growl you can barely hear, backing off into the fog)
//
// A glance is fine: the stare builds while the eyes sit near the middle of
// the view and drains when you look away.
//
// The leap covers at most leapDistance and always stops leapMinGap short of
// the player, so there is time to turn and run: the chase is slower than a
// running player.
//
// From the growl to the end of the chase it holds the storm
// (sandstorm.held), so the dust can't clear until the player has got away.
// The attack sound runs from the leap through the chase — quietly, louder as
// it closes — and it bites when it catches you. The growl is synthesised
// (Growl.js), not a file.
//
// The eyes are a pool of DustEye objects built with the scene, so their
// shaders are compiled behind the loading screen; hidden ones cost nothing.
// For testing, summon() — the J key — brings one to the yard and one to the
// window now; summon('fence') or summon('window') brings just one (and a storm, if none
// is blowing). The scene hands it hooks for the camera, whether the player
// is outside, and whether the airlock hatch is shut; the fence and the
// window come in as plain rectangles, so the geometry here is pure.
// ─────────────────────────────────────────────

/** Tuning. Seconds and metres unless stated. */
export const DUST_EYES = {
  /** How often a spawn is rolled for, while the storm is up. */
  checkSeconds: 5,
  /** The storm must be at least this strong for one to come… */
  spawnLevel: 0.8,
  /** …and they leave once it drops under this. */
  leaveLevel: 0.5,
  /** How long a passive one lingers. */
  lifeSeconds: [18, 32],
  /** Fade in and out. */
  fadeSeconds: 1.5,
  /** How long it must be stared at before it turns — outside… */
  stareSeconds: 0.8,
  /** …and through the window. */
  windowStareSeconds: 0.7,
  /** Degrees off the middle of the view that still counts as looking at it. */
  gazeAngle: 8,
  /** Farthest it can be seen (and spawn) from, outside. */
  sightRange: 30,
  /** It growls, still, jaws shut, this long before it leaps. */
  growlSeconds: 1.2,
  /** The leap: how long, how far at most, how near it may land, and how
   *  high it arcs. */
  leapSeconds: 0.42,
  leapDistance: 12,
  leapMinGap: 4,
  leapHeight: 0.9,
  /** Chase speed, m/s — the player runs at 5. */
  chaseSpeed: 3.6,
  /** It has you at this distance. */
  catchDistance: 1,
  /** Seen through the window: it backs off into the fog over this long, at
   *  this speed (m/s). */
  retreatSeconds: 1.6,
  retreatSpeed: 3,
  /** Beyond the wire, and how far along it from the player — close by it. */
  beyondFence: [6, 9],
  alongFence: 8,
  /** Out past the window — deep in the storm, toward the dish (~20 m), but
   *  still to be made out. */
  windowDistance: [22, 30],
  /** Height above the ground — above the tallest grass beyond the fence
   *  (1.45 m), so the eyes are never lost in it; the body rises out of it. */
  height: [1.9, 2.6],
  /** How far round a solid thing a chasing eye keeps (metres). */
  obstacleMargin: 0.8,
  /** Tries at a clear spot beyond the fence before settling for the wire. */
  spawnTries: 24,
  /** A yard eye "in view" is within this many degrees of where the player
   *  is looking. The J key always puts one there; a natural one is there
   *  inViewChance of the time, and anywhere in sight otherwise. */
  inViewAngle: 35,
  inViewChance: 0.6,
  /** Where it settles if every try was in the trees: this close to the wire,
   *  inside the band kept clear of them. */
  fallbackBeyond: 1.2,
  /** How the eyes dim with distance — gentler than the fog, so they glow
   *  from deep in it. exp(−(d · dim)²). */
  dimDensity: 0.02,
  /** From night 3: stepping out into the storm brings this many, this soon. */
  stepOutEyes: 2,
  guaranteeDelay: 3,
  /** Through the window: at least this long between one and the next. */
  windowCooldown: 45,
  /** Through the window: how bright they burn (of the yard ones'), and how
   *  fast they dim with distance — in the fog, easy to miss. */
  windowIntensity: 0.5,
  windowDim: 0.025,
  /** Out in the yard after the hatch opens: this long safe, then a roll
   *  every aggroRollSeconds per watching yard eye to turn on its own… */
  graceSeconds: 6,
  aggroRollSeconds: 2,
  aggroChance: 0.05,
  /** …far likelier for an agitated one (seen through the window). */
  agitatedAggroChance: 0.25,
  /** Turned on its own, it growls this long before it leaps. */
  passiveGrowlSeconds: 2,
  /** How far through a storm the sure check comes. */
  midwayAt: 0.5,
  /** The generator's noise, switched on or off at its panel in a storm:
   *  the chance it sets an eye on the player. */
  generatorChance: 0.5,
  /** The slow side-to-side drift while they watch: metres either way, and
   *  radians per second. */
  swayAmplitude: 1.5,
  swayRate: 0.35,
  /** The silhouette: the fog's own colour, times this. */
  silhouetteShade: 0.6,
  /** The chase sound: its loudest (it is never jarring), the distance it
   *  reaches that at, and the quietest it gets when far. */
  attackVolume: 0.25,
  attackRefDistance: 5,
  attackFloor: 0.4,
  /** The bite, when it catches you. */
  biteVolume: 0.8,
  /** The growl before it leaps — low, not loud — and the one heard
   *  through the window, barely there. */
  growlVolume: 0.35,
  windowGrowlVolume: 0.05,
};

/** Manifest keys behind each sound. */
export const DUST_EYES_SOUNDS = {
  attack: 'sfx:tiger-attack',
  bite:   'sfx:monster-bite',
};

const CAUGHT_PROMPT = 'You have been eaten. Press [E] to try again';
/** The death screen: black at once, slowly turning red; the prompt — and
 *  the retry — once it has. */
const CAUGHT_SCREEN = { tone: 'blood', fadeMs: 0, redMs: 2500, messageDelayMs: 2200 };

// ── Pure helpers ──────────────────────────────────────────

/** Chance a roll brings one, on `night`. */
export function spawnChance(night) {
  if (night < 2) return 0;
  return night === 2 ? 0.08 : 0.2;
}

/** Most at once, on `night`, in the yard ('fence') or through the window ('window'). */
export function maxEyes(night, kind) {
  if (night < 2) return 0;
  if (kind === 'window') return night === 2 ? 1 : 2;
  return night === 2 ? 3 : 4;
}

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (x, a, b) => Math.min(Math.max(x, a), b);

/**
 * A point just beyond the fence, near the player and in plain sight of them:
 * out of the trees, with none between. The fence runs round three sides of
 * `rect` — the far side (maxZ) and the two ends; the minZ side is the
 * building. Tries `spawnTries` spots; if the trees take every one, settles
 * right by the wire (fallbackBeyond), inside the band kept clear of them.
 * @param {{minX:number, maxX:number, minZ:number, maxZ:number}} rect
 * @param {THREE.Vector3} player
 * @param {() => number} random
 * @param {THREE.Vector3} out
 * @param {{ trees?: Array<{x:number, z:number, reach:number}> }} [opts]
 */
export function fenceSpawnPoint(rect, player, random, out, { trees = [], obstacles = [], facing = null, inView = false } = {}) {
  const clear = () => !sightBlocked(player, out, trees, obstacles)
    && Math.hypot(out.x - player.x, out.z - player.z) < DUST_EYES.sightRange;
  // In front of the player first, if asked: along their view, a little
  // either side, out to where that meets the fence.
  if (inView && facing) {
    const cone = Math.cos(THREE.MathUtils.degToRad(DUST_EYES.inViewAngle));
    for (let i = 0; i < DUST_EYES.spawnTries; i++) {
      const turn = (random() * 2 - 1) * THREE.MathUtils.degToRad(DUST_EYES.inViewAngle) * 0.85;
      if (!fenceAlong(rect, player, facing, turn, lerp(...DUST_EYES.beyondFence, random()), random, out)) continue;
      if (clear() && inCone(player, facing, out, cone)) return out;
    }
  }
  for (let i = 0; i < DUST_EYES.spawnTries; i++) {
    fencePoint(rect, player, random, lerp(...DUST_EYES.beyondFence, random()), out);
    if (clear()) return out;
  }
  fencePoint(rect, player, random, DUST_EYES.fallbackBeyond, out);
  return out;
}

/** Is `p` within the cone (cos of its half-angle) round `facing`, on the ground plan? */
function inCone(player, facing, p, cosHalf) {
  const fx = facing.x, fz = facing.z, fl = Math.hypot(fx, fz) || 1;
  const dx = p.x - player.x, dz = p.z - player.z, dl = Math.hypot(dx, dz) || 1;
  return (fx * dx + fz * dz) / (fl * dl) >= cosHalf - 1e-9;
}

/**
 * Where the player's view, turned `turn` radians, meets the fence — then
 * `beyond` metres out past it. False if it meets no fenced run (it points at
 * the building).
 */
function fenceAlong(rect, player, facing, turn, beyond, random, out) {
  const fl = Math.hypot(facing.x, facing.z) || 1;
  const fx = facing.x / fl, fz = facing.z / fl;
  const c = Math.cos(turn), s = Math.sin(turn);
  const dx = fx * c - fz * s, dz = fx * s + fz * c;
  let best = Infinity, nx = 0, nz = 0;
  const hit = (t, x, z, ox, oz) => {
    if (t > 1e-6 && t < best && x >= rect.minX - 1e-6 && x <= rect.maxX + 1e-6 && z >= rect.minZ - 1e-6 && z <= rect.maxZ + 1e-6) {
      best = t; nx = ox; nz = oz;
    }
  };
  if (dx < 0) { const t = (rect.minX - player.x) / dx; hit(t, rect.minX, player.z + dz * t, -1, 0); }
  if (dx > 0) { const t = (rect.maxX - player.x) / dx; hit(t, rect.maxX, player.z + dz * t, 1, 0); }
  if (dz > 0) { const t = (rect.maxZ - player.z) / dz; hit(t, player.x + dx * t, rect.maxZ, 0, 1); }
  if (best === Infinity) return false;
  out.set(player.x + dx * best + nx * beyond, lerp(...DUST_EYES.height, random()), player.z + dz * best + nz * beyond);
  return true;
}

/** One spot `beyond` metres past the wire, near the player. */
function fencePoint(rect, player, random, beyond, out) {
  const along = (random() * 2 - 1) * DUST_EYES.alongFence;
  const y = lerp(...DUST_EYES.height, random());
  const sides = [
    { x: rect.minX - beyond, z: clamp(player.z + along, rect.minZ, rect.maxZ) },
    { x: rect.maxX + beyond, z: clamp(player.z + along, rect.minZ, rect.maxZ) },
    { x: clamp(player.x + along, rect.minX, rect.maxX), z: rect.maxZ + beyond },
  ];
  const dist = s => Math.hypot(s.x - player.x, s.z - player.z);
  const inSight = sides.filter(s => dist(s) < DUST_EYES.sightRange - 1);
  const pick = inSight.length
    ? inSight[Math.min(Math.floor(random() * inSight.length), inSight.length - 1)]
    : sides.reduce((a, b) => (dist(a) <= dist(b) ? a : b));
  return out.set(pick.x, y, pick.z);
}

/**
 * Is the line from `from` to `to` (on the ground plan) blocked — by a tree
 * standing across it (or `to` inside a canopy), or by something solid
 * (`boxes`: the buggy, the generator)?
 * @param {Array<{x:number, z:number, reach:number}>} trees
 * @param {Array<{minX:number, maxX:number, minZ:number, maxZ:number}>} [boxes]
 */
export function sightBlocked(from, to, trees, boxes = []) {
  for (const b of boxes) if (entry(from, to, b) !== null) return true;
  const dx = to.x - from.x, dz = to.z - from.z;
  const len2 = dx * dx + dz * dz || 1e-9;
  for (const t of trees) {
    // Nearest point of the segment to the trunk.
    const u = Math.min(1, Math.max(0, ((t.x - from.x) * dx + (t.z - from.z) * dz) / len2));
    const d = Math.hypot(from.x + dx * u - t.x, from.z + dz * u - t.z);
    if (d < t.reach) return true;
  }
  return false;
}

/** Where along from→to (0 … 1) the segment first enters `box` (ground plan), or null. */
function entry(from, to, box) {
  let t0 = 0, t1 = 1;
  for (const [p, d, lo, hi] of [[from.x, to.x - from.x, box.minX, box.maxX], [from.z, to.z - from.z, box.minZ, box.maxZ]]) {
    if (Math.abs(d) < 1e-9) {
      if (p <= lo || p >= hi) return null;
      continue;
    }
    let a = (lo - p) / d, b = (hi - p) / d;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    if (t0 >= t1) return null;
  }
  return t0;
}

const _corner = new THREE.Vector3();

/**
 * Seconds of near-silence at the head of a clip, so it can be started where
 * the sound does. 0 if it never gets loud.
 * @param {Float32Array[]} channels
 * @param {number} sampleRate
 * @param {number} [threshold=0.02]  Loudest sample that still counts as quiet.
 */
export function leadingSilence(channels, sampleRate, threshold = 0.02) {
  const n = channels[0]?.length ?? 0;
  for (let i = 0; i < n; i++) {
    for (const data of channels) if (Math.abs(data[i]) > threshold) return i / sampleRate;
  }
  return 0;
}

/** Is `p` inside `box` (ground plan), grown by `m`? */
function insideBox(p, box, m) {
  return p.x > box.minX - m && p.x < box.maxX + m && p.z > box.minZ - m && p.z < box.maxZ + m;
}

/** Distance on the ground plan. */
function flatDistance(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** The spot just outside `box`'s door — where to line up before going in —
 *  at height `y`. The door is on whichever face it is nearest. */
function doorStep(box, y, out) {
  const { x, z } = box.door;
  const out1 = DUST_EYES.obstacleMargin + 0.3;
  const faces = [
    [x - box.minX, -1, 0], [box.maxX - x, 1, 0],
    [z - box.minZ, 0, -1], [box.maxZ - z, 0, 1],
  ];
  faces.sort((a, b) => a[0] - b[0]);
  const [, nx, nz] = faces[0];
  const fx = nx < 0 ? box.minX : nx > 0 ? box.maxX : x;
  const fz = nz < 0 ? box.minZ : nz > 0 ? box.maxZ : z;
  return out.set(fx + nx * out1, y, fz + nz * out1);
}

/**
 * Where to head for, going from `from` to `to` without passing through any
 * of `boxes` (ground-plan rectangles, grown by obstacleMargin): `to` itself
 * if the way is clear; otherwise the corner of the first thing in the way
 * that makes the shortest way round. Out of a box it starts inside.
 * @param {Array<{minX:number, maxX:number, minZ:number, maxZ:number}>} boxes
 */
export function steerAround(from, to, boxes, out, skip = null) {
  const m = DUST_EYES.obstacleMargin;
  let first = null, firstT = Infinity;
  for (const b of boxes) {
    if (b === skip) continue;
    const g = { minX: b.minX - m, maxX: b.maxX + m, minZ: b.minZ - m, maxZ: b.maxZ + m };
    // Started inside (a leap landed in the margin): straight out the nearest side.
    if (from.x > g.minX && from.x < g.maxX && from.z > g.minZ && from.z < g.maxZ) {
      const exits = [[from.x - g.minX, g.minX - 0.05, from.z], [g.maxX - from.x, g.maxX + 0.05, from.z],
                     [from.z - g.minZ, from.x, g.minZ - 0.05], [g.maxZ - from.z, from.x, g.maxZ + 0.05]];
      exits.sort((a, c) => a[0] - c[0]);
      return out.set(exits[0][1], to.y, exits[0][2]);
    }
    const t = entry(from, to, g);
    if (t !== null && t < firstT) { firstT = t; first = g; }
  }
  if (!first) return out.copy(to);

  // The shortest way round: a corner reachable straight from here.
  const e = 0.05;
  let best = Infinity;
  out.copy(to);
  for (const [x, z] of [[first.minX - e, first.minZ - e], [first.maxX + e, first.minZ - e],
                        [first.minX - e, first.maxZ + e], [first.maxX + e, first.maxZ + e]]) {
    _corner.set(x, to.y, z);
    // Not the corner it is already standing on — on to the next one. Tighter
    // than the corner's own clearance (e), so it only moves on once it is
    // clear of the box's edge on both sides.
    if (Math.hypot(x - from.x, z - from.z) < e * 0.4) continue;
    if (entry(from, _corner, first) !== null) continue;
    const cost = Math.hypot(x - from.x, z - from.z) + Math.hypot(to.x - x, to.z - z);
    if (cost < best) { best = cost; out.copy(_corner); }
  }
  return out;
}

/**
 * A point out past the window, inside the view through it.
 * @param {{x0:number, x1:number, z:number, sill:number, top:number}} win
 *        The opening, in the back wall's plane at `z`; outside is −Z.
 */
export function windowSpawnPoint(win, random, out) {
  const d = lerp(...DUST_EYES.windowDistance, random());
  const centre = (win.x0 + win.x1) / 2;
  const spread = (win.x1 - win.x0) / 2 * 0.8 + d * 0.3;
  return out.set(
    centre + (random() * 2 - 1) * spread,
    lerp(...DUST_EYES.height, random()),
    win.z - d,
  );
}

/** Does the line from `from` (inside) to `to` (outside) pass through the
 *  window opening, rather than the wall round it? */
export function throughWindow(from, to, win) {
  if (!(from.z > win.z && to.z < win.z)) return false;
  const t = (from.z - win.z) / (from.z - to.z);
  const x = from.x + (to.x - from.x) * t;
  const y = from.y + (to.y - from.y) * t;
  return x >= win.x0 && x <= win.x1 && y >= win.sill && y <= win.top;
}

// ── The system ────────────────────────────────────────────

const _eye = new THREE.Vector3();
const _view = new THREE.Vector3();
const _to = new THREE.Vector3();
const _way = new THREE.Vector3();
const _door = new THREE.Vector3();
const _facing = new THREE.Vector3();

/** One eye from the pool, and what it is doing. */
class Slot {
  constructor(go) {
    this.go = go;
    this.phase = 'off';
    this.kind = 'fence';
    this.fade = 0;
    this.life = 0;
    this.gaze = 0;
    this.t = 0;
    /** Where it hangs; it sways either side of this along `side`. */
    this.anchor = new THREE.Vector3();
    this.side = new THREE.Vector3(1, 0, 0);
    this.swayPhase = 0;
    /** The leap, start to end. */
    this.leapFrom = new THREE.Vector3();
    this.leapTo = new THREE.Vector3();
    /** Which way it backs off, from the window. */
    this.away = new THREE.Vector3();
    /** Seen through the window and come round to the yard: quicker to turn. */
    this.agitated = false;
    /** How long it growls before it leaps, this time. */
    this.growlFor = 0;
  }
  get position() { return this.go.object3d.position; }
  get mode() { return this.go.mode; }
}

export class DustEyes extends Component {
  /**
   * @param {object} opts
   * @param {import('./GameController.js').GameController} opts.controller
   * @param {{ level: number, held: boolean, summon?: () => boolean }} opts.sandstorm
   * @param {import('../gameobjects/DustEye.js').DustEye[]} opts.pool  Built and parented by the scene.
   * @param {{minX:number, maxX:number, minZ:number, maxZ:number}} opts.fence
   * @param {{x0:number, x1:number, z:number, sill:number, top:number}} opts.window
   * @param {object} opts.hooks
   * @param {(out: THREE.Vector3) => THREE.Vector3} opts.hooks.eyePosition
   * @param {(out: THREE.Vector3) => THREE.Vector3} opts.hooks.viewDirection
   * @param {(p: THREE.Vector3) => boolean} opts.hooks.isOutside
   * @param {() => boolean} opts.hooks.hatchShut
   * @param {(locked: boolean) => void} opts.hooks.setPlayerLocked
   * @param {{ play: Function, clear: Function }} [opts.whiteOut]
   * @param {{ exit: () => void }} [opts.terminal]
   * @param {THREE.Fog|THREE.FogExp2} [opts.fog]  The silhouettes take its colour, darker.
   * @param {Array<{x:number, z:number, reach:number}>} [opts.trees]  Yard eyes keep out of (and clear of) these.
   * @param {Array<{minX:number, maxX:number, minZ:number, maxZ:number}>} [opts.obstacles]  Solid things it goes round.
   * @param {Record<string, THREE.Audio>} [opts.sounds]  Built from DUST_EYES_SOUNDS when left out.
   * @param {() => number} [opts.random]
   */
  constructor({
    controller, sandstorm, pool, fence, window, hooks, whiteOut = null, terminal = null,
    fog = null, sounds = null, trees = [], obstacles = [], random = Math.random,
  }) {
    super();
    Object.assign(this, { controller, sandstorm, fence, window, hooks, whiteOut, terminal, fog, sounds, trees, obstacles, random });
    this.slots = pool.map(go => new Slot(go));
    for (const slot of this.slots) this._hide(slot);
    this._night = 1;
    this._check = 0;
    this._forced = false;
    this._caught = false;
    this._locked = false;
    this._off = null;
    this._wasOutside = null;
    this._guaranteeAt = null;   // seconds left until tonight's promised eye, or null
    this._windowWait = 0;       // seconds until another may come to the window
    this._graceLeft = null;     // seconds of grace left since the hatch opened, or null while it is shut
    this._aggroClock = 0;       // seconds towards the next stay-out roll
    this._midwayFor = null;     // the storm whose midway check has run
    this._attack = 0;           // the chase sound's level, 0 … 1
    this._silhouette = new THREE.Color();
  }

  /** The eyes out there now. Allocates — for tests and debugging. */
  get active() { return this.slots.filter(s => s.phase !== 'off'); }

  onStart() {
    if (!this.sounds) this.sounds = this._buildSounds();
    this.sounds.attack?.setLoop?.(true);
    if (!this.sounds.growl) this.sounds.growl = this._buildGrowl();
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

  /** A fresh night, or a retry: nothing out there, and the player free. */
  reset(night) {
    this._night = night;
    this._check = 0;
    this._forced = false;
    this._caught = false;
    this._wasOutside = null;
    this._guaranteeAt = null;
    this._windowWait = 0;
    this._graceLeft = null;
    this._aggroClock = 0;
    this._attack = 0;
    this._stop('attack');
    for (const slot of this.slots) this._hide(slot);
    if (this.sandstorm) this.sandstorm.held = false;
    if (this._locked) {
      this._locked = false;
      this.hooks.setPlayerLocked(false);
      this.whiteOut?.clear();
    }
  }

  /**
   * Bring one now — the J debug key, which always brings one to the yard,
   * wherever the player is. `kind` 'window' brings one to the window instead
   * (cooldown ignored). With no storm up, starts one (the K key's summon) and
   * the eye comes as soon as it is strong enough.
   * @param {'both'|'fence'|'window'} [kind='both']
   * @returns {boolean} whether one is coming
   */
  summon(kind = 'both') {
    if (this.controller.state !== 'playing') return false;
    if (this.sandstorm.level >= DUST_EYES.spawnLevel) return this._summonNow(kind);
    const storm = this.sandstorm.level > 0 || this.sandstorm.summon?.();
    if (storm) this._forced = kind;
    return !!storm;
  }

  onUpdate(dt) {
    if (this.controller.state !== 'playing') {
      // Game over by its hand: its face stays in view as the screen goes.
      if (!this._caught) {
        for (const slot of this.slots) if (slot.phase !== 'off') this._hide(slot);
        this.sandstorm.held = false;
      }
      this._attack = 0;
      this._stop('attack');
      this._tickVisuals(dt);
      return;
    }

    const level = this.sandstorm.level;
    const eye = this.hooks.eyePosition(_eye);
    const outside = this.hooks.isOutside(eye);
    this._windowWait = Math.max(0, this._windowWait - dt);
    this._check += dt;
    if (this._check >= DUST_EYES.checkSeconds) {
      this._check = 0;
      if (level >= DUST_EYES.spawnLevel && !this._chasing()) {
        // The window — rarely: only with the player indoors to see it, and
        // only once the cooldown has run.
        if (!outside && this._windowWait === 0 && this.random() < spawnChance(this._night)) this._spawn('window');
        // The yard, in or out.
        if (this.random() < spawnChance(this._night)) this._spawn('fence');
      }
    }
    if (this._forced && level >= DUST_EYES.spawnLevel) {
      const kind = this._forced;
      this._forced = false;
      this._summonNow(kind);
    }

    this.hooks.viewDirection(_view);
    this._crossed(outside, level, dt);
    this._midway();
    this._staysOut(dt, outside, eye);

    for (const slot of this.slots) {
      if (slot.phase === 'off') continue;
      slot.t += dt;
      switch (slot.phase) {
        case 'in':
        case 'passive':
          this._linger(slot, dt, level, eye, outside);
          break;
        case 'out':
          this._sway(slot);
          slot.fade -= dt / DUST_EYES.fadeSeconds;
          if (slot.fade <= 0) this._hide(slot);
          break;
        case 'retreating':
          this._retreat(slot, dt);
          break;
        case 'growling':
          if (this._sheltered(outside)) slot.phase = 'out';
          else if (slot.t >= slot.growlFor) this._startLeap(slot, eye);
          break;
        case 'leaping':
          if (this._sheltered(outside)) slot.phase = 'out';
          else this._leap(slot);
          break;
        case 'chasing':
          this._chase(slot, dt, eye, outside);
          break;
      }
    }

    this.sandstorm.held = this._chasing();
    this._updateAttack(dt, eye);
    this._tickVisuals(dt);
  }

  /** The player went in or out: what is left on the other side can't be
   *  seen any more, so it goes. From night 3, going out into a strong storm
   *  brings one to the fence for certain — a little after the step out, or
   *  after the storm gets strong if they are already out there. */
  _crossed(outside, level, dt) {
    if (outside !== this._wasOutside) {
      this._guaranteeAt = outside && this._night >= 3 ? DUST_EYES.guaranteeDelay : null;
      this._wasOutside = outside;
    }
    if (this._guaranteeAt === null || level < DUST_EYES.spawnLevel) return;
    this._guaranteeAt -= dt;
    if (this._guaranteeAt > 0) return;
    this._guaranteeAt = null;
    if (this._chasing()) return;
    // Two out there for certain: brought up to two, past the cap.
    const there = this.slots.filter(s => s.kind === 'fence' && (s.phase === 'in' || s.phase === 'passive')).length;
    for (let i = there; i < DUST_EYES.stepOutEyes; i++) this._spawn('fence', { force: true });
  }

  /** The chase sound: in as it turns, louder as it closes, out when it is over. */
  _updateAttack(dt, eye) {
    const chaser = this.slots.find(s => s.phase === 'leaping' || s.phase === 'chasing');
    const target = chaser ? 1 : 0;
    this._attack = target > this._attack
      ? Math.min(1, this._attack + dt / 0.3)
      : Math.max(0, this._attack - dt / 0.8);
    const sound = this.sounds?.attack;
    if (!sound) return;
    if (this._attack <= 0) { this._stop('attack'); return; }
    if (!sound.isPlaying) sound.play();
    if (chaser) {
      const d = Math.max(eye.distanceTo(chaser.position), 1e-3);
      this._attackNear = Math.min(1, Math.max(DUST_EYES.attackFloor, DUST_EYES.attackRefDistance / d));
    }
    sound.setVolume(DUST_EYES.attackVolume * this._attack * (this._attackNear ?? DUST_EYES.attackFloor));
  }

  // ── Beats ───────────────────────────────

  /** Passive: fade in, hang there, watch for a stare; drift off in time. */
  _linger(slot, dt, level, eye, outside) {
    if (slot.phase === 'in') {
      slot.fade = Math.min(1, slot.fade + dt / DUST_EYES.fadeSeconds);
      if (slot.fade >= 1) slot.phase = 'passive';
    }
    // An agitated one doesn't drift off: it waits out the storm.
    if (!slot.agitated) slot.life -= dt;
    if (slot.life <= 0 || level < DUST_EYES.leaveLevel) {
      slot.phase = 'out';
      return;
    }
    this._sway(slot);

    const looking = this._seen(slot, eye, outside) && this._lookingAt(slot, eye);
    slot.gaze = looking ? slot.gaze + dt : Math.max(0, slot.gaze - dt);
    const throughGlass = slot.kind === 'window';
    if (slot.gaze < (throughGlass ? DUST_EYES.windowStareSeconds : DUST_EYES.stareSeconds)) return;

    if (throughGlass) {
      // Through the glass: it snarls, barely heard, and backs off into the fog.
      slot.go.setMode('growl');
      slot.fade = 1;
      slot.t = 0;
      slot.phase = 'retreating';
      slot.away.set(slot.position.x - eye.x, 0, slot.position.z - eye.z).normalize();
      this._growl(DUST_EYES.windowGrowlVolume);
      return;
    }
    this._turn(slot, DUST_EYES.growlSeconds);
  }

  /** It turns: red eyes, jaws shut, a growl — for `growlFor`, then the leap. */
  _turn(slot, growlFor) {
    slot.go.setMode('growl');
    slot.fade = 1;
    slot.t = 0;
    slot.growlFor = growlFor;
    slot.phase = 'growling';
    this._growl(DUST_EYES.growlVolume);
  }

  /**
   * The generator was just switched at its panel: in a strong storm, from
   * night 2, an even chance that the noise sets a yard eye on the player —
   * a watching one turns (growling passiveGrowlSeconds), or with none out
   * there, one comes already turned. Not while one is already after them.
   * @returns {boolean} whether one is coming
   */
  generatorNoise() {
    if (this.controller.state !== 'playing' || this._night < 2) return false;
    if (this.sandstorm.level < DUST_EYES.spawnLevel || this._chasing()) return false;
    if (this.random() >= DUST_EYES.generatorChance) return false;
    let slot = this.slots.find(s => s.kind === 'fence' && (s.phase === 'passive' || s.phase === 'in'));
    if (!slot) {
      if (!this._spawn('fence', { force: true })) return false;
      slot = this.slots.find(s => s.kind === 'fence' && s.phase === 'in');
    }
    this._turn(slot, DUST_EYES.passiveGrowlSeconds);
    return true;
  }

  /** The J key's spawn, now: 'both' brings one to the yard and one to the window. */
  _summonNow(kind) {
    if (kind !== 'both') return this._spawn(kind, { debug: true });
    const yard = this._spawn('fence', { debug: true });
    const win = this._spawn('window', { debug: true });
    return yard || win;
  }

  /** Halfway through each storm, for certain: one in the yard (two from
   *  night 3), and one at the window unless one is there already. Waits
   *  out a chase. */
  _midway() {
    if (this._night < 2) return;
    const progress = this.sandstorm.stormProgress;
    const id = this.sandstorm.stormId;
    if (progress === null || progress === undefined || id === this._midwayFor) return;
    if (progress < DUST_EYES.midwayAt || this._chasing()) return;
    this._midwayFor = id;
    const yard = this._night >= 3 ? 2 : 1;
    for (let i = 0; i < yard; i++) this._spawn('fence', { force: true });
    if (!this.slots.some(s => s.kind === 'window' && s.phase !== 'off')) this._spawn('window', { force: true });
  }

  /** Staying out: from graceSeconds after the hatch opens, every
   *  aggroRollSeconds each watching yard eye may turn on its own — one at a
   *  time, and never while one is already after the player. */
  _staysOut(dt, outside, eye) {
    if (this.hooks.hatchShut()) {
      this._graceLeft = null;
      this._aggroClock = 0;
      return;
    }
    if (this._graceLeft === null) this._graceLeft = DUST_EYES.graceSeconds;
    this._graceLeft = Math.max(0, this._graceLeft - dt);
    if (!outside || this._graceLeft > 0 || this._chasing()) {
      this._aggroClock = 0;
      return;
    }
    this._aggroClock += dt;
    if (this._aggroClock < DUST_EYES.aggroRollSeconds) return;
    this._aggroClock = 0;
    for (const slot of this.slots) {
      if (slot.kind !== 'fence' || slot.phase !== 'passive') continue;
      const chance = slot.agitated ? DUST_EYES.agitatedAggroChance : DUST_EYES.aggroChance;
      if (this.random() < chance) {
        this._turn(slot, DUST_EYES.passiveGrowlSeconds);
        return;
      }
    }
  }

  /** Jaws open, a hop toward the player — at most leapDistance, and never
   *  nearer than leapMinGap. */
  _startLeap(slot, eye) {
    slot.phase = 'leaping';
    slot.t = 0;
    slot.go.setMode('aggressive');
    slot.leapFrom.copy(slot.position);
    _to.copy(eye).sub(slot.position);
    const d = _to.length();
    const travel = Math.min(DUST_EYES.leapDistance, Math.max(0, d - DUST_EYES.leapMinGap));
    slot.leapTo.copy(slot.position).addScaledVector(_to, d > 0 ? travel / d : 0);
    // Never through something solid: land short of it.
    const m = DUST_EYES.obstacleMargin;
    for (const b of this.obstacles) {
      const t = entry(slot.leapFrom, slot.leapTo, { minX: b.minX - m, maxX: b.maxX + m, minZ: b.minZ - m, maxZ: b.maxZ + m });
      if (t !== null) slot.leapTo.lerpVectors(slot.leapFrom, slot.leapTo, Math.max(0, t - 0.02));
    }
  }

  _leap(slot) {
    const u = Math.min(slot.t / DUST_EYES.leapSeconds, 1);
    const ease = 1 - (1 - u) * (1 - u);
    slot.position.lerpVectors(slot.leapFrom, slot.leapTo, ease);
    slot.position.y += Math.sin(Math.PI * u) * DUST_EYES.leapHeight;
    if (u >= 1) { slot.phase = 'chasing'; slot.t = 0; }
  }

  /** Seen through the window: backing off into the fog, fading — then it
   *  comes round to the yard, agitated. */
  _retreat(slot, dt) {
    slot.position.addScaledVector(slot.away, DUST_EYES.retreatSpeed * dt);
    slot.fade = 1 - slot.t / DUST_EYES.retreatSeconds;
    if (slot.fade > 0) return;
    this._place(slot, 'fence', { inView: false });
    slot.agitated = true;
    slot.go.setAgitated(true);
  }

  _growl(volume) {
    const growl = this.sounds?.growl;
    if (!growl) return;
    if (growl.isPlaying) growl.stop();
    growl.setVolume(volume);
    growl.play();
  }

  /** Straight at the player's face. In and sealed — it gives up. */
  _chase(slot, dt, eye, outside) {
    if (this._sheltered(outside)) {
      slot.phase = 'out';
      return;
    }
    if (slot.position.distanceTo(eye) <= DUST_EYES.catchDistance) {
      this._catch(slot);
      return;
    }
    // Round anything solid in the way — and into something the player is
    // inside (the airlock) only through its door.
    let target = eye, skip = null;
    for (const b of this.obstacles) {
      if (!b.door || !insideBox(eye, b, 0)) continue;
      doorStep(b, eye.y, _door);
      if (insideBox(slot.position, b, DUST_EYES.obstacleMargin) || flatDistance(slot.position, _door) < 0.5) skip = b;
      else target = _door;
    }
    steerAround(slot.position, target, this.obstacles, _way, skip);
    _to.copy(_way).sub(slot.position);
    const d = _to.length();
    if (d > 1e-6) slot.position.addScaledVector(_to, Math.min(DUST_EYES.chaseSpeed * dt, d) / d);
  }

  _catch(slot) {
    slot.phase = 'caught';
    this._caught = true;
    this.sandstorm.held = false;
    this.controller.fail(CAUGHT_PROMPT, { retryAfter: CAUGHT_SCREEN.messageDelayMs / 1000 });
    this.terminal?.exit?.();
    this.whiteOut?.play(CAUGHT_PROMPT, CAUGHT_SCREEN);
    this._locked = true;
    this.hooks.setPlayerLocked(true);
    this._attack = 0;
    this._stop('attack');
    const bite = this.sounds?.bite;
    if (bite) {
      if (bite.isPlaying) bite.stop();
      bite.setVolume(DUST_EYES.biteVolume);
      bite.play();
    }
  }

  // ── Helpers ─────────────────────────────

  /**
   * Bring one out, in the yard ('fence') or through the window ('window'),
   * if there is room for that kind tonight.
   * @param {'fence'|'window'} kind
   * @param {{ debug?: boolean }} [opts]  debug: the J key — works on night 1,
   *        and ignores the window's cooldown.
   */
  _spawn(kind, { debug = false, force = false } = {}) {
    const live = this.slots.filter(s => s.phase !== 'off' && s.kind === kind).length;
    const cap = force ? Infinity : Math.max(maxEyes(this._night, kind), debug ? 1 : 0);
    const slot = this.slots.find(s => s.phase === 'off');
    if (!slot || live >= cap) return false;
    if (kind === 'window' && this._windowWait > 0 && !debug && !force) return false;

    if (kind === 'window') this._windowWait = DUST_EYES.windowCooldown;
    // In front of the player — always for the J key, mostly otherwise.
    this._place(slot, kind, { inView: debug || this.random() < DUST_EYES.inViewChance });
    return true;
  }

  /** Put `slot` out there as a fresh, watching eye of `kind`. */
  _place(slot, kind, { inView = false } = {}) {
    const eye = this.hooks.eyePosition(_eye);
    slot.kind = kind;
    slot.agitated = false;
    slot.go.setAgitated(false);
    slot.go.setIntensity(kind === 'window' ? DUST_EYES.windowIntensity : 1);
    if (slot.kind === 'fence') {
      fenceSpawnPoint(this.fence, eye, this.random, slot.anchor, {
        trees: this.trees, obstacles: this.obstacles, facing: this.hooks.viewDirection(_facing), inView,
      });
    }
    else windowSpawnPoint(this.window, this.random, slot.anchor);
    // Sway across the player's line of sight: sideways as they see it.
    if (slot.kind === 'fence') slot.side.set(-(slot.anchor.z - eye.z), 0, slot.anchor.x - eye.x).normalize();
    else slot.side.set(1, 0, 0);
    slot.swayPhase = this.random() * Math.PI * 2;
    slot.position.copy(slot.anchor);

    slot.phase = 'in';
    slot.fade = 0;
    slot.gaze = 0;
    slot.t = 0;
    slot.life = lerp(...DUST_EYES.lifeSeconds, this.random());
    slot.go.setMode('passive');
    slot.go.object3d.visible = true;
  }

  _hide(slot) {
    slot.phase = 'off';
    slot.fade = 0;
    slot.gaze = 0;
    slot.agitated = false;
    slot.go.setAgitated(false);
    slot.go.setMode('passive');
    slot.go.setFade(0);
    slot.go.object3d.visible = false;
  }

  /** Drift either side of where it hangs, slowly. */
  _sway(slot) {
    const s = Math.sin(slot.swayPhase + slot.t * DUST_EYES.swayRate) * DUST_EYES.swayAmplitude;
    slot.position.copy(slot.anchor).addScaledVector(slot.side, s);
  }

  _stop(name) {
    const sound = this.sounds?.[name];
    if (sound?.isPlaying) sound.stop();
  }

  /** One THREE.Audio per clip from the preloaded buffers. Missing ones are left out. */
  _buildSounds() {
    const engine = this.gameObject?.scene?.userData?.engine;
    const sounds = {};
    if (!engine?.audioListener || !engine.assets) return sounds;
    for (const [name, key] of Object.entries(DUST_EYES_SOUNDS)) {
      if (engine.assets.has && !engine.assets.has(key)) continue;
      const buffer = engine.assets.get(key);
      if (!buffer) continue;
      const audio = new THREE.Audio(engine.audioListener);
      audio.setBuffer(buffer);
      // The bite lands on the catch: skip the quiet at the clip's head.
      if (name === 'bite') {
        const channels = [];
        for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));
        audio.offset = leadingSilence(channels, buffer.sampleRate);
      }
      sounds[name] = audio;
    }
    return sounds;
  }

  /** Indoors with the airlock hatch shut: out of its reach. */
  _sheltered(outside) {
    return !outside && this.hooks.hatchShut();
  }

  /** The synthesised growl as a THREE.Audio, or null without audio. */
  _buildGrowl() {
    const engine = this.gameObject?.scene?.userData?.engine;
    const listener = engine?.audioListener;
    if (!listener) return null;
    const { context } = listener;
    const samples = synthGrowl({ sampleRate: context.sampleRate });
    const buffer = context.createBuffer(1, samples.length, context.sampleRate);
    buffer.copyToChannel(samples, 0);
    const audio = new THREE.Audio(listener);
    audio.setBuffer(buffer);
    return audio;
  }

  _chasing() {
    return this.slots.some(s => s.phase === 'growling' || s.phase === 'leaping' || s.phase === 'chasing');
  }

  /** Could the player see it from where they are? */
  _seen(slot, eye, outside) {
    if (slot.kind === 'fence') return outside && eye.distanceTo(slot.position) <= DUST_EYES.sightRange;
    return !outside && throughWindow(eye, slot.position, this.window);
  }

  /** Is it near the middle of the view? */
  _lookingAt(slot, eye) {
    _to.copy(slot.position).sub(eye).normalize();
    return _to.dot(_view) >= Math.cos(THREE.MathUtils.degToRad(DUST_EYES.gazeAngle));
  }

  /** Look at the player, dimmed by distance through the dust. */
  _tickVisuals(dt) {
    const eye = this.hooks.eyePosition(_eye);
    if (this.fog) this._silhouette.copy(this.fog.color).multiplyScalar(DUST_EYES.silhouetteShade);
    for (const slot of this.slots) {
      if (slot.phase === 'off') continue;
      const dim = slot.kind === 'window' ? DUST_EYES.windowDim : DUST_EYES.dimDensity;
      const d = eye.distanceTo(slot.position) * dim;
      slot.go.setFade(Math.max(slot.fade, 0) * Math.exp(-d * d));
      if (this.fog) slot.go.setSilhouetteColor(this._silhouette);
      slot.go.tick(dt, eye);
    }
  }
}
