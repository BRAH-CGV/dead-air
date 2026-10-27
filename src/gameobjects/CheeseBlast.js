import * as THREE from 'three';
import { makeRandom, randRange } from '../core/Random.js';
import { CHEESE } from './CheeseBall.js';

// ─────────────────────────────────────────────
// CheeseBlast  –  the ball of cheese going off, and the room with it
// ─────────────────────────────────────────────
// An explosion that fills a room from a point in it:
//
//   • a shockwave, a shell that tears out past the walls in a quarter of a
//     second and fades;
//   • fire, puffs flung out to the walls and the ceiling, white-hot to
//     orange to soot, heaped where they hit;
//   • sparks, thousands of them, flung fast, slowed by the air, falling,
//     bouncing off the floor, the walls and the ceiling, cooling to nothing;
//   • debris, rind and charred shrapnel, tumbling and bouncing round the room
//     until it lies on the floor;
//   • smoke, dark puffs that swell and climb after the fire, and stay;
//   • the room's light (`light`, borrowed for it: no new light, so no shader
//     recompiles) flaring orange and flickering, put back when it is done.
//
//   const blast = createCheeseBlast();
//   scene.add(blast);
//   blast.play(worldPoint, { bounds, light: office.ceilingLight });   // bounds: the room's inside, world space
//   blast.update(dt);                       // each frame; hides itself when done
//   blast.dispose();
//
// It is placed in world space: add it to the scene, not to anything that
// moves or turns. Without `bounds` nothing stops it. Five draw calls: the
// shockwave, the fire, the smoke and the debris are InstancedMeshes or a
// mesh; the sparks are Points. The fire, the sparks and the shockwave are
// unlit and drawn from both sides, so a view caught inside them is filled.
// Built hidden. No shadow, no fog. Seeded: the same blast every time.
// ─────────────────────────────────────────────

/** The blast's numbers: metres, seconds. */
export const BLAST = Object.freeze({
  /** Until the last of it (the smoke) is gone. */
  seconds: 4,
  shock: { radius: 7, seconds: 0.3, color: 0xffe2a0, opacity: 0.85 },
  fire: {
    count: 56, size: [0.35, 1.3], travel: [0.8, 5], delay: [0, 0.3], life: [0.9, 1.8],
    /** Of a puff's life: at its biggest here, then shrinking to nothing. */
    peak: 0.3,
    /** Through its life, hottest first. */
    colors: [0xffffff, 0xfff0a0, 0xffb030, 0xff6a10, 0xb02808, 0x2a1a14],
  },
  sparks: {
    count: 3000, speed: [3, 20], life: [0.6, 2.4], size: 0.05,
    /** Air drag, 1/s, and the share of its speed a spark keeps off a bounce. */
    drag: 1.6, bounce: 0.45,
    colors: [0xffffff, 0xfff2b0, 0xffa020, 0xff4a08, 0x000000],
  },
  debris: {
    count: 110, size: [0.03, 0.14], speed: [3, 13], spin: [6, 30],
    drag: 0.4, bounce: 0.4, friction: 6,
    /** Every `rindEvery`th piece is cheese rind; the rest is charred. */
    rindEvery: 3, char: 0x241a14,
  },
  smoke: {
    count: 26, size: [0.6, 1.6], travel: [0.5, 3.5], delay: [0.25, 0.9], life: [2.2, 3.1],
    rise: 0.5, color: 0x1c1714,
  },
  light: { color: 0xff8a30, flare: 420, seconds: 2.2, flicker: 23 },
  gravity: 9.8,
  seed: 6669,
});

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _c2 = new THREE.Color();

/** A random direction, `up` biased upward (0 even). */
function direction(rand, up = 0) {
  const y = randRange(rand, -1 + up, 1);
  const a = randRange(rand, 0, Math.PI * 2);
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  return new THREE.Vector3(r * Math.cos(a), y, r * Math.sin(a));
}

/** Along a ramp of colours, t from 0 to 1, into `out`. */
function ramp(colors, t, out) {
  const x = Math.min(0.9999, Math.max(0, t)) * (colors.length - 1);
  const i = Math.floor(x);
  return out.setHex(colors[i]).lerp(_c2.setHex(colors[i + 1]), x - i);
}

/** How far from `p` along unit `dir` the box's side is. Infinity without one. */
function reach(box, p, dir) {
  if (!box) return Infinity;
  let t = Infinity;
  for (const k of ['x', 'y', 'z']) {
    if (dir[k] > 1e-6) t = Math.min(t, (box.max[k] - p[k]) / dir[k]);
    else if (dir[k] < -1e-6) t = Math.min(t, (box.min[k] - p[k]) / dir[k]);
  }
  return Math.max(0, t);
}

/** Keep a moving point inside the box, bouncing its velocity off each side
 *  it crosses. Returns whether it hit the floor. */
function bounceIn(box, p, v, keep) {
  if (!box) return false;
  let floor = false;
  for (const k of ['x', 'y', 'z']) {
    if (p[k] < box.min[k]) { p[k] = box.min[k]; v[k] = Math.abs(v[k]) * keep; if (k === 'y') floor = true; }
    else if (p[k] > box.max[k]) { p[k] = box.max[k]; v[k] = -Math.abs(v[k]) * keep; }
  }
  return floor;
}

/**
 * Build the blast. A THREE.Group named `CheeseBlast`, with `shock`, `fire`,
 * `smoke`, `debris` and `sparks`, `play(at, { bounds, light })`,
 * `update(dt)`, `playing`, `elapsed` and `dispose()`.
 * @param {object} [opts]
 * @param {number} [opts.seed]
 */
export function createCheeseBlast({ seed = BLAST.seed } = {}) {
  const rand = makeRandom(seed);
  const { shock: SH, fire: F, sparks: S, debris: D, smoke: K } = BLAST;

  // ── Who goes where, fixed by the seed ──
  const fires = Array.from({ length: F.count }, (_, i) => ({
    // The first is the core: no delay, at the middle, the biggest.
    dir: direction(rand, 0.3).normalize(),
    travel: i === 0 ? 0 : randRange(rand, ...F.travel),
    size: i === 0 ? F.size[1] * 1.3 : randRange(rand, ...F.size),
    delay: i === 0 ? 0 : randRange(rand, ...F.delay),
    life: randRange(rand, ...F.life),
    reach: Infinity,
  }));
  const smokes = Array.from({ length: K.count }, () => ({
    dir: direction(rand, 0.5).normalize(),
    travel: randRange(rand, ...K.travel),
    size: randRange(rand, ...K.size),
    delay: randRange(rand, ...K.delay),
    life: randRange(rand, ...K.life),
    reach: Infinity,
  }));
  const sparkSpec = Array.from({ length: S.count }, () => ({
    vel: direction(rand, 0.2).normalize().multiplyScalar(randRange(rand, ...S.speed)),
    life: randRange(rand, ...S.life),
  }));
  const debrisSpec = Array.from({ length: D.count }, (_, i) => ({
    vel: direction(rand, 0.3).normalize().multiplyScalar(randRange(rand, ...D.speed)),
    size: randRange(rand, ...D.size),
    axis: direction(rand).normalize(),
    spin: randRange(rand, ...D.spin),
    rind: i % D.rindEvery === 0,
  }));

  // ── The meshes ──
  const shockGeometry = new THREE.IcosahedronGeometry(1, 3);
  const shock = new THREE.Mesh(shockGeometry, new THREE.MeshBasicMaterial({
    color: SH.color, transparent: true, opacity: 0, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false,
  }));
  shock.name = 'BlastShock';

  const puffGeometry = new THREE.IcosahedronGeometry(1, 2);
  const fire = new THREE.InstancedMesh(puffGeometry, new THREE.MeshBasicMaterial({
    side: THREE.DoubleSide, fog: false, toneMapped: false,
  }), F.count);
  fire.name = 'BlastFire';
  const smoke = new THREE.InstancedMesh(puffGeometry, new THREE.MeshLambertMaterial({
    color: K.color, side: THREE.DoubleSide, fog: false,
  }), K.count);
  smoke.name = 'BlastSmoke';

  const debrisGeometry = new THREE.BoxGeometry(1, 0.6, 0.8);
  const debris = new THREE.InstancedMesh(debrisGeometry, new THREE.MeshLambertMaterial({ fog: false }), D.count);
  debris.name = 'BlastDebris';
  debrisSpec.forEach((d, i) => debris.setColorAt(i, _c.setHex(d.rind ? CHEESE.rind : D.char)));

  const sparkPositions = new Float32Array(S.count * 3);
  const sparkColors = new Float32Array(S.count * 3);
  const sparkGeometry = new THREE.BufferGeometry();
  sparkGeometry.setAttribute('position', new THREE.BufferAttribute(sparkPositions, 3).setUsage(THREE.DynamicDrawUsage));
  sparkGeometry.setAttribute('color', new THREE.BufferAttribute(sparkColors, 3).setUsage(THREE.DynamicDrawUsage));
  const sparks = new THREE.Points(sparkGeometry, new THREE.PointsMaterial({
    size: S.size, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending,
    depthWrite: false, fog: false, toneMapped: false,
  }));
  sparks.name = 'BlastSparks';

  for (const mesh of [shock, fire, smoke, debris, sparks]) {
    if (mesh.instanceMatrix) mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = mesh.receiveShadow = false;
    mesh.frustumCulled = false;                   // they move far from the geometry's bounds
  }

  const blast = new THREE.Group();
  blast.name = 'CheeseBlast';
  blast.add(shock, fire, smoke, debris, sparks);
  blast.visible = false;
  Object.assign(blast, { shock, fire, smoke, debris, sparks, playing: false, elapsed: 0 });

  // ── Moving state, reset on play ──
  /** The room's inside, in the blast's own space (it sits at `at`). */
  let box = null;
  const sparkPos = Array.from({ length: S.count }, () => new THREE.Vector3());
  const sparkVel = Array.from({ length: S.count }, () => new THREE.Vector3());
  const debrisPos = Array.from({ length: D.count }, () => new THREE.Vector3());
  const debrisVel = Array.from({ length: D.count }, () => new THREE.Vector3());
  const debrisSpin = new Float32Array(D.count);
  const debrisTurn = Array.from({ length: D.count }, () => new THREE.Quaternion());
  const _dq = new THREE.Quaternion();
  let light = null, lightWas = null;

  /** A puff's scale, 0 to 1, at its own time t (0 to 1). */
  const puffScale = (t, peak) => (t <= 0 || t >= 1 ? 0
    : t < peak ? 1 - (1 - t / peak) ** 3
    : 1 - ((t - peak) / (1 - peak)) ** 2);

  /** Puffs flung out fast, easing, to their reach; `colors` through their
   *  life, or climbing at `rise` m/s. */
  const placePuffs = (mesh, specs, { peak, colors = null, rise = 0 }) => {
    for (let i = 0; i < specs.length; i++) {
      const f = specs[i];
      const age = Math.max(0, blast.elapsed - f.delay);
      const t = (blast.elapsed - f.delay) / f.life;
      const out = Math.min(f.reach, f.travel * (1 - (1 - Math.min(1, Math.max(0, t * 2.5))) ** 3));
      _p.copy(f.dir).multiplyScalar(out);
      _p.y += rise * age;
      if (box) _p.y = Math.min(_p.y, box.max.y);
      _m.compose(_p, _q.identity(), _s.setScalar(Math.max(0, f.size * puffScale(t, peak))));
      mesh.setMatrixAt(i, _m);
      if (colors) mesh.setColorAt(i, ramp(colors, Math.max(0, t), _c));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  };

  const place = (dt) => {
    const e = blast.elapsed;

    const ts = e / SH.seconds;
    shock.visible = ts < 1;
    shock.scale.setScalar(Math.max(1e-3, SH.radius * (1 - (1 - Math.min(1, ts)) ** 2)));
    shock.material.opacity = SH.opacity * Math.max(0, 1 - ts);

    placePuffs(fire, fires, { peak: F.peak, colors: F.colors });
    placePuffs(smoke, smokes, { peak: 0.4, rise: K.rise });

    const drag = Math.exp(-S.drag * dt);
    for (let i = 0; i < S.count; i++) {
      const p = sparkPos[i], v = sparkVel[i];
      if (dt > 0) {
        v.multiplyScalar(drag);
        v.y -= BLAST.gravity * dt;
        p.addScaledVector(v, dt);
        bounceIn(box, p, v, S.bounce);
      }
      sparkPositions[i * 3] = p.x;
      sparkPositions[i * 3 + 1] = p.y;
      sparkPositions[i * 3 + 2] = p.z;
      ramp(S.colors, e / sparkSpec[i].life, _c);
      sparkColors[i * 3] = _c.r;
      sparkColors[i * 3 + 1] = _c.g;
      sparkColors[i * 3 + 2] = _c.b;
    }
    sparkGeometry.attributes.position.needsUpdate = true;
    sparkGeometry.attributes.color.needsUpdate = true;

    const airDrag = Math.exp(-D.drag * dt);
    for (let i = 0; i < D.count; i++) {
      const p = debrisPos[i], v = debrisVel[i];
      if (dt > 0) {
        v.multiplyScalar(airDrag);
        v.y -= BLAST.gravity * dt;
        p.addScaledVector(v, dt);
        if (bounceIn(box, p, v, D.bounce)) {
          // On the floor: it skids to a stop and stops turning.
          const k = Math.exp(-D.friction * dt);
          v.x *= k; v.z *= k;
          debrisSpin[i] *= k;
          if (Math.abs(v.y) < 0.4) v.y = 0;
        }
        _dq.setFromAxisAngle(debrisSpec[i].axis, debrisSpin[i] * dt);
        debrisTurn[i].premultiply(_dq);
      }
      _m.compose(p, debrisTurn[i], _s.setScalar(debrisSpec[i].size));
      debris.setMatrixAt(i, _m);
    }
    debris.instanceMatrix.needsUpdate = true;

    if (light && lightWas) {
      const L = BLAST.light;
      const tl = e / L.seconds;
      if (tl >= 1) restoreLight();
      else {
        const k = (1 - tl) ** 2 * (0.75 + 0.25 * Math.sin(e * L.flicker * 6.283) * Math.sin(e * L.flicker * 2.7));
        light.intensity = lightWas.intensity + L.flare * Math.max(0, k);
        light.color.copy(lightWas.color).lerp(_c.setHex(L.color), Math.min(1, k * 2));
      }
    }
  };

  const restoreLight = () => {
    if (light && lightWas) {
      light.intensity = lightWas.intensity;
      light.color.copy(lightWas.color);
    }
    light = lightWas = null;
  };

  /**
   * Go off at world point `at`.
   * @param {THREE.Vector3} at
   * @param {{ bounds?: THREE.Box3|null, light?: THREE.Light|null }} [opts]
   *        bounds: the room's inside, world space, that it bounces round;
   *        light: flared for the blast and put back.
   */
  blast.play = (at, { bounds = null, light: borrowed = null } = {}) => {
    restoreLight();
    blast.position.copy(at);
    blast.updateMatrixWorld();
    box = bounds ? bounds.clone().translate(_p.copy(at).negate()) : null;
    const origin = new THREE.Vector3();
    // Puffs stop at the walls and the ceiling, short by a little of their size.
    for (const f of [...fires, ...smokes]) f.reach = Math.max(0, reach(box, origin, f.dir) - f.size * 0.3);
    for (let i = 0; i < S.count; i++) {
      sparkPos[i].set(0, 0, 0);
      sparkVel[i].copy(sparkSpec[i].vel);
    }
    for (let i = 0; i < D.count; i++) {
      debrisPos[i].set(0, 0, 0);
      debrisVel[i].copy(debrisSpec[i].vel);
      debrisSpin[i] = debrisSpec[i].spin;
      debrisTurn[i].identity();
    }
    if (borrowed) {
      light = borrowed;
      lightWas = { intensity: borrowed.intensity, color: borrowed.color.clone() };
    }
    blast.elapsed = 0;
    blast.playing = true;
    blast.visible = true;
    place(0);
  };

  blast.update = (dt) => {
    if (!blast.playing) return;
    blast.elapsed += dt;
    place(dt);
    if (blast.elapsed >= BLAST.seconds) {
      restoreLight();
      blast.playing = false;
      blast.visible = false;
    }
  };

  blast.dispose = () => {
    restoreLight();
    for (const g of [shockGeometry, puffGeometry, debrisGeometry, sparkGeometry]) g.dispose();
    for (const mesh of [shock, fire, smoke, debris, sparks]) mesh.material.dispose();
    fire.dispose();
    smoke.dispose();
    debris.dispose();
  };

  place(0);
  return blast;
}
