import * as THREE from 'three';
import { GameObject } from '../core/GameObject.js';
import { Component } from '../core/Component.js';
import { makeRandom, randRange } from '../core/Random.js';
import { TERRAIN, terrainHeightAt } from './MarsTerrain.js';

// ─────────────────────────────────────────────
// CommTowers  –  masts on the crater rim, blinking red
// ─────────────────────────────────────────────
// Five lattice masts standing on the ridge that closes the valley, each
// carrying an aviation-style obstruction beacon. They are the only human thing
// visible past the treeline, and the only moving light in the landscape — the
// belt closed the horizon, so these are what give the far distance a reason to
// be looked at, and a sense of how big the bowl you are standing in is.
//
//   this._outside.addChild(createCommTowers({ heightAt }));
//
// ── Why they read at 400 m ──
// Three numbers decide whether these are visible at all, and all three are
// easy to get wrong:
//
//   The masts sit at CREST_RADIUS, and the camera's far plane is 1000 — fine.
//   But FogExp2 at the outdoor density puts roughly half the fog colour over
//   anything that far out, so the STRUCTURE is meant to be a faint silhouette
//   and the BEACON is not: its material sets `fog: false`, or the one thing
//   that is supposed to punch through the haze is the thing the haze eats.
//   (The moons learned this the hard way — a MeshBasicMaterial fogs by
//   default and renders as a flat blob of fog colour.)
//
//   A 1.2 m lamp at 400 m subtends about a fifth of a degree: two or three
//   pixels, which reads as a dead pixel rather than a light. The lamp is
//   therefore paired with an additive sprite an order of magnitude wider,
//   which is what actually carries the glow. The sprite is the light; the
//   sphere just gives it somewhere to sit.
//
//   Each mast is raised to the local high point of the ridge rather than
//   dropped at its nominal bearing, so an intervening hill cannot swallow it.
//
// ── Not instanced per tower ──
// Five towers is too few for instancing to pay for itself, but the masts and
// arms still share one geometry and one material each, so the whole field is
// four draw calls plus a sprite per tower. Geometry hangs straight on the
// group's Object3D, so — as with the rocks, the belt and the sky — the level
// editor never lists it and the frame loop never walks it.
// ─────────────────────────────────────────────

export const COMM_TOWERS = {
  seed: 20260922,
  /** One per clearing. The belt cuts five lanes, but the one running out to
   *  the dish is left alone — the dish is what you are meant to see down it,
   *  and a mast there would stand directly behind the tower it belongs to. */
  count: 4,
  /** Along the crest itself, give or take — the ridge is not a perfect circle
   *  and neither should the line of masts be. */
  radius: TERRAIN.CREST_RADIUS,
  radiusJitter: 22,
  /** Metres. Bounded at both ends by what you can actually see. The rim they
   *  stand on is already 50-60 m up, which puts their feet near 8 degrees of
   *  elevation from the base — so a short mast is lost behind the nearer
   *  hills, and a tall one climbs past the top of the office window (about
   *  14 degrees from mid-room) and is only visible with your nose against the
   *  glass. This range keeps every tip in the window and clear of the ridge. */
  height: [26, 38],
  /** How far around its nominal spot a mast may move to find high ground, and
   *  how many places it looks. Masts go on ridge tops: that is where you would
   *  put an antenna, and it keeps them from hiding behind the next hill. */
  siteSpread: 26,
  siteSamples: 24,
  beacon: {
    /** The lamp housing. Deliberately tiny: at this range it is barely more
     *  than a point, and it is meant to be — the glow sprite is what you
     *  actually see, and a large sphere reads as a ball stuck on a pole. */
    radius: 0.55,
    color: 0xff2a18,
    /** Seconds per flash, and the fraction of that the lamp is lit. A real
     *  obstruction beacon sits dark and punches a short flash — fifteen a
     *  minute here, about a fifth of a second each, so the lamp is off for
     *  94% of the cycle and the gap between flashes is long enough that you
     *  notice it. The
     *  darkness is the effect: a light that is merely pulsing reads as a
     *  decoration, where one that vanishes and snaps back reads as a machine
     *  running out there on its own. */
    period: 4.0,
    duty: 0.055,
    /** Sprite width in metres. Twenty-odd metres at 400 m is about two
     *  degrees, which is a legible point of light rather than a dead pixel. */
    glowSize: 22,
  },
};

/**
 * Build the line of masts.
 *
 * @param {Object} [opts]
 * @param {number} [opts.seed]
 * @param {number} [opts.count]
 * @param {(x: number, z: number) => number} [opts.heightAt]
 *        ground height; pass the same one the terrain uses
 * @param {number[]} [opts.alignTo]
 *        lane bearings, atan2(z, x) in radians. Each mast is swung onto one of
 *        them, nearest first and one apiece, so every clearing ends on a tower
 *        instead of on bare ridge. Also sets the default count: one per lane.
 * @returns {GameObject} a group carrying the masts, arms, lamps and glows
 */
export function createCommTowers(opts = {}) {
  const {
    seed     = COMM_TOWERS.seed,
    alignTo,
    count    = alignTo?.length ?? COMM_TOWERS.count,
    heightAt = terrainHeightAt,
  } = opts;

  const rand = makeRandom(seed);
  const towers = new GameObject('CommTowers');
  // A group, so the editor neither lists the masts nor measures a bounding box
  // the width of the whole valley.
  towers.makeGroup();

  const sites = layOutTowers(rand, count, heightAt, alignTo);
  towers.sites = sites;
  if (sites.length === 0) return towers;

  // One geometry and one material per part, shared across every tower.
  const mastGeometry = new THREE.CylinderGeometry(0.35, 1.5, 1, 6, 1, true);
  const armGeometry  = new THREE.BoxGeometry(1, 0.22, 0.22);
  const lampGeometry = new THREE.SphereGeometry(COMM_TOWERS.beacon.radius, 8, 6);

  // Dark, and lit by the moon like everything else out there — the silhouette
  // is the point, so it wants to stay darker than the ridge behind it.
  const steel = new THREE.MeshStandardMaterial({
    color: 0x1c1f26, roughness: 0.85, metalness: 0.6,
  });
  const lampMaterial = new THREE.MeshBasicMaterial({
    color: COMM_TOWERS.beacon.color,
    // Without this the lamp is fogged to the horizon colour at this range and
    // stops being a light at all. See the header.
    fog: false,
    toneMapped: false,
  });

  const masts = new THREE.InstancedMesh(mastGeometry, steel, sites.length);
  const arms  = new THREE.InstancedMesh(armGeometry, steel, sites.length * 2);
  const lamps = new THREE.InstancedMesh(lampGeometry, lampMaterial, sites.length);
  for (const mesh of [masts, arms, lamps]) {
    // Nothing out here is inside the moonlight's shadow camera, so shadows
    // would be pure cost.
    mesh.castShadow = false;
    mesh.receiveShadow = false;
  }

  const matrix = new THREE.Matrix4();
  const glows = [];
  // One texture for every beacon — it is the same soft dot five times over.
  const glowTexture = makeGlowTexture();

  sites.forEach((site, i) => {
    const { x, z, ground, height } = site;

    matrix.makeScale(1, height, 1).setPosition(x, ground + height / 2, z);
    masts.setMatrixAt(i, matrix);

    // Two crossarms near the top, which is what makes the silhouette read as a
    // mast rather than a pole.
    [0.78, 0.9].forEach((frac, j) => {
      const span = 7.5 * (1 - frac * 0.45);
      matrix.makeRotationY(site.spin + j * 0.6);
      matrix.scale(new THREE.Vector3(span, 1, 1));
      matrix.setPosition(x, ground + height * frac, z);
      arms.setMatrixAt(i * 2 + j, matrix);
    });

    const tip = ground + height + COMM_TOWERS.beacon.radius;
    matrix.makeTranslation(x, tip, z);
    lamps.setMatrixAt(i, matrix);
    lamps.setColorAt(i, new THREE.Color(COMM_TOWERS.beacon.color));

    // The glow. Additive and unfogged, so it reads as light scattering in the
    // haze rather than as a disc hanging in it. The texture is what makes it a
    // light: an untextured sprite is a flat quad, and additive blending draws
    // that as a hard-edged square that pulses.
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture,
      color: COMM_TOWERS.beacon.color,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    }));
    glow.position.set(x, tip, z);
    glow.scale.setScalar(COMM_TOWERS.beacon.glowSize);
    towers.object3d.add(glow);
    glows.push(glow);
  });

  for (const mesh of [masts, arms, lamps]) {
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }
  if (lamps.instanceColor) lamps.instanceColor.needsUpdate = true;

  towers.object3d.add(masts, arms, lamps);
  towers.addComponent(new BeaconFlash(lamps, glows, sites));
  return towers;
}

/**
 * A soft round dot, as raw pixels.
 *
 * The same falloff MarsSky uses for the moon halos, and for the same reason:
 * a quad with no falloff shows its corners, so the "light" reads as a square.
 * Built as a DataTexture rather than drawn on a canvas so it costs nothing at
 * startup and works headless, where there is no 2D context to draw into.
 */
function makeGlowTexture(size = 64) {
  const data = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // 0 at the centre, 1 at the inscribed circle. Past that it is zero, so
      // the corners of the quad never show.
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.5;
      const d = Math.min(1, Math.hypot(dx, dy) * 2);

      const smooth = d * d * (3 - 2 * d);
      const falloff = Math.pow(1 - smooth, 2.5);
      const value = Math.round(falloff * 255);

      const i = (y * size + x) * 4;
      data[i] = value;
      data[i + 1] = value;
      data[i + 2] = value;
      data[i + 3] = value;
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** Drives the beacons. One component for the whole field rather than one per
 *  tower: it is a handful of numbers a frame, and the scene only has to add
 *  the group. */
class BeaconFlash extends Component {
  constructor(lamps, glows, sites) {
    super();
    this.lamps = lamps;
    this.glows = glows;
    this.sites = sites;
    this.time = 0;
    this._color = new THREE.Color();
    this._base = new THREE.Color(COMM_TOWERS.beacon.color);
  }

  onUpdate(dt) {
    this.time += dt;
    const { period, duty } = COMM_TOWERS.beacon;

    for (let i = 0; i < this.sites.length; i++) {
      // Phase-offset per tower. Real beacons on one installation are often
      // synchronised; these deliberately are not, because five lights blinking
      // in lockstep reads as one mechanism, and five out of step reads as five
      // separate things out there.
      const t = (this.time / period + this.sites[i].phase) % 1;
      // A hump over the lit window rather than a square edge. The window is
      // short enough to read as a snap, and the ramp keeps it from aliasing
      // into a hard strobe at this size.
      const lit = t < duty ? Math.sin((Math.PI * t) / duty) : 0;

      this._color.copy(this._base).multiplyScalar(lit);
      this.lamps.setColorAt(i, this._color);

      const glow = this.glows[i];
      // Dark between flashes, not merely dim.
      glow.material.opacity = lit;
      glow.scale.setScalar(COMM_TOWERS.beacon.glowSize * (0.72 + 0.4 * lit));
    }

    if (this.lamps.instanceColor) this.lamps.instanceColor.needsUpdate = true;
  }
}

/** Space the masts around the rim, then walk each one onto the high ground
 *  near its bearing. */
function layOutTowers(rand, count, heightAt, alignTo) {
  const { radius, radiusJitter, height, siteSpread, siteSamples } = COMM_TOWERS;
  const sites = [];

  for (let i = 0; i < count; i++) {
    // Stratified, so five towers cannot bunch on one side of the rim.
    const bearing = (i + randRange(rand, 0.15, 0.85)) * ((Math.PI * 2) / count);
    const nominal = radius + randRange(rand, -radiusJitter, radiusJitter);

    let best = null;
    for (let s = 0; s < siteSamples; s++) {
      const dBearing = randRange(rand, -siteSpread, siteSpread) / nominal;
      const dRadius  = randRange(rand, -siteSpread, siteSpread);
      const a = bearing + dBearing;
      const r = nominal + dRadius;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const ground = heightAt(x, z);
      if (!best || ground > best.ground) best = { x, z, ground };
    }

    sites.push({
      ...best,
      height: randRange(rand, height[0], height[1]),
      phase: rand(),
      spin: rand() * Math.PI,
    });
  }

  if (alignTo?.length) swingOntoBearings(sites, alignTo, heightAt);
  return sites;
}

/**
 * Swing each mast around onto a lane bearing, one lane apiece.
 *
 * Nearest pair first, so no mast is dragged across the rim past another that
 * wanted the same lane — that would cross two towers over and undo the even
 * spacing the stratification gave them.
 *
 * Done after the fact rather than by seeding the bearings differently: picking
 * them up front would shift every later draw from the same generator and move
 * the whole line, including the masts that were already where they should be.
 */
function swingOntoBearings(sites, bearings, heightAt) {
  const pairs = [];
  sites.forEach((site, s) => {
    bearings.forEach((bearing, b) => {
      pairs.push({ s, b, gap: angleBetween(Math.atan2(site.z, site.x), bearing) });
    });
  });
  pairs.sort((a, b) => a.gap - b.gap);

  const takenSite = new Set();
  const takenLane = new Set();
  for (const { s, b } of pairs) {
    if (takenSite.has(s) || takenLane.has(b)) continue;
    takenSite.add(s);
    takenLane.add(b);

    const site = sites[s];
    const r = Math.hypot(site.x, site.z);
    site.x = Math.cos(bearings[b]) * r;
    site.z = Math.sin(bearings[b]) * r;
    // It has moved, so it is standing on different ground.
    site.ground = heightAt(site.x, site.z);
    site.lane = bearings[b];
  }
}

/** Smallest angle between two bearings, either way round the circle. */
function angleBetween(a, b) {
  const gap = Math.abs(a - b) % (Math.PI * 2);
  return gap > Math.PI ? Math.PI * 2 - gap : gap;
}

