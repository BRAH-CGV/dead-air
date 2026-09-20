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
  count: 5,
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
    /** The lamp itself. Small — the sprite is what you actually see. */
    radius: 1.2,
    color: 0xff2a18,
    /** Seconds per flash, and the fraction of that the lamp is lit. */
    period: 2.4,
    duty: 0.22,
    /** The lamp never goes fully dark: a dim red point between flashes reads
     *  as a light that is still there, where a true zero reads as a glitch. */
    floor: 0.12,
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
 * @returns {GameObject} a group carrying the masts, arms, lamps and glows
 */
export function createCommTowers(opts = {}) {
  const {
    seed     = COMM_TOWERS.seed,
    count    = COMM_TOWERS.count,
    heightAt = terrainHeightAt,
  } = opts;

  const rand = makeRandom(seed);
  const towers = new GameObject('CommTowers');
  // A group, so the editor neither lists the masts nor measures a bounding box
  // the width of the whole valley.
  towers.makeGroup();

  const sites = layOutTowers(rand, count, heightAt);
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
    // haze rather than as a disc hanging in it.
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
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
    const { period, duty, floor } = COMM_TOWERS.beacon;

    for (let i = 0; i < this.sites.length; i++) {
      // Phase-offset per tower. Real beacons on one installation are often
      // synchronised; these deliberately are not, because five lights blinking
      // in lockstep reads as one mechanism, and five out of step reads as five
      // separate things out there.
      const t = (this.time / period + this.sites[i].phase) % 1;
      // A smooth hump over the lit window rather than a square wave, which at
      // this size would alias into a harsh strobe.
      const lit = t < duty ? Math.sin((Math.PI * t) / duty) : 0;
      const level = floor + (1 - floor) * lit;

      this._color.copy(this._base).multiplyScalar(level);
      this.lamps.setColorAt(i, this._color);

      const glow = this.glows[i];
      glow.material.opacity = 0.15 + 0.85 * lit;
      glow.scale.setScalar(COMM_TOWERS.beacon.glowSize * (0.7 + 0.45 * lit));
    }

    if (this.lamps.instanceColor) this.lamps.instanceColor.needsUpdate = true;
  }
}

/** Space the masts around the rim, then walk each one onto the high ground
 *  near its bearing. */
function layOutTowers(rand, count, heightAt) {
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

  return sites;
}
