import * as THREE from 'three';
import { makeRandom, randRange } from '../core/Random.js';
import { toonRamp, CHEESE } from './CheeseBall.js';

// ─────────────────────────────────────────────
// CloudPoof  –  the cartoon puff of cloud the globe turns to cheese in (#169)
// ─────────────────────────────────────────────
// A handful of round puffs that burst out from a ball's surface, swell,
// and shrink away to nothing, over `POOF.seconds`. Toon like the cheese
// (the same stepped-Lambert ramp, a dark back-face outline), and opaque:
// it goes by shrinking, never fading, so nothing is transparent.
//
//   const poof = createCloudPoof({ radius: 0.143 });
//   globe.object3d.add(poof);
//   poof.play();
//   poof.update(dt);                       // each frame; hides itself when done
//   poof.dispose();
//
// Two InstancedMeshes (the puffs and their outlines) on one shared
// icosphere: two draw calls. Built hidden, so its shaders compile with the
// scene. It casts no shadow (it comes and goes, and the shadow maps are
// frozen) and takes no fog (indoors). Seeded: the same burst every time.
// ─────────────────────────────────────────────

/** The poof's numbers. Sizes and distances are shares of the ball's radius. */
export const POOF = Object.freeze({
  count: 11,
  seconds: 0.6,
  /** Each puff's radius at its biggest. */
  size: [0.35, 0.6],
  /** Where a puff starts, out from the middle, and how far it goes. */
  from: 0.65,
  travel: [1.1, 1.7],
  /** How late each puff may start, seconds. */
  stagger: 0.06,
  /** Of a puff's own time: growing until this, shrinking from `shrinkFrom`. */
  growUntil: 0.25,
  shrinkFrom: 0.45,
  color: 0xefe6d4,
  /** A little glow of its own, so a dim room doesn't swallow it. */
  emissive: 0x2a2620,
  outline: 0x5e4e3e,
  /** The outline puff, as a share of the puff. */
  outlineScale: 1.1,
  seed: 1690,
});

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();

/**
 * Build the poof. A THREE.Group named `CloudPoof`, with `puffs` and
 * `outline` meshes, `play()`, `update(dt)`, `playing` and `dispose()`.
 * @param {object} [opts]
 * @param {number} [opts.radius=0.143]  Metres: the ball it bursts from.
 * @param {number} [opts.seed]
 */
export function createCloudPoof({ radius = 0.143, seed = POOF.seed } = {}) {
  const rand = makeRandom(seed);
  const specs = Array.from({ length: POOF.count }, (_, i) => {
    // Spread round the ball (golden-angle spiral, jittered), a little more upward.
    const y = 1 - ((i + 0.5) / POOF.count) * 1.6;
    const a = i * 2.39996 + randRange(rand, -0.4, 0.4);
    const s = Math.sqrt(Math.max(0, 1 - y * y));
    return {
      dir: new THREE.Vector3(s * Math.cos(a), y, s * Math.sin(a)).normalize(),
      size: randRange(rand, ...POOF.size) * radius,
      travel: randRange(rand, ...POOF.travel) * radius,
      delay: randRange(rand, 0, POOF.stagger),
    };
  });

  const geometry = new THREE.IcosahedronGeometry(1, 3);
  const gradientMap = new THREE.DataTexture(toonRamp(CHEESE.bands), CHEESE.bands * 2, 1, THREE.RedFormat);
  gradientMap.minFilter = gradientMap.magFilter = THREE.NearestFilter;
  gradientMap.generateMipmaps = false;
  gradientMap.needsUpdate = true;

  const puffs = new THREE.InstancedMesh(geometry, new THREE.MeshToonMaterial({
    color: POOF.color, emissive: POOF.emissive, gradientMap, fog: false,
  }), POOF.count);
  const outline = new THREE.InstancedMesh(geometry, new THREE.MeshBasicMaterial({
    color: POOF.outline, side: THREE.BackSide, fog: false,
  }), POOF.count);
  for (const mesh of [puffs, outline]) {
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = mesh.receiveShadow = false;
    mesh.frustumCulled = false;                   // its instances move far from the geometry's bounds
  }
  puffs.name = 'CloudPuffs';
  outline.name = 'CloudPuffOutline';

  const poof = new THREE.Group();
  poof.name = 'CloudPoof';
  poof.add(puffs, outline);
  poof.visible = false;
  poof.puffs = puffs;
  poof.outline = outline;
  poof.playing = false;
  let elapsed = 0;

  const place = () => {
    for (let i = 0; i < specs.length; i++) {
      const spec = specs[i];
      const t = Math.min(1, Math.max(0, (elapsed - spec.delay) / (POOF.seconds - spec.delay)));
      const out = POOF.from * radius + spec.travel * (1 - (1 - t) ** 3);   // fast, then easing
      let k;
      if (t < POOF.growUntil) {
        const g = t / POOF.growUntil;
        k = 1 - (1 - g) ** 2;
      } else if (t < POOF.shrinkFrom) k = 1;
      else {
        const g = (t - POOF.shrinkFrom) / (1 - POOF.shrinkFrom);
        k = 1 - g * g;
      }
      const size = spec.size * Math.max(0, k);
      _p.copy(spec.dir).multiplyScalar(out);
      _m.compose(_p, _q.identity(), _s.setScalar(size));
      puffs.setMatrixAt(i, _m);
      _m.compose(_p, _q, _s.setScalar(size * POOF.outlineScale));
      outline.setMatrixAt(i, _m);
    }
    puffs.instanceMatrix.needsUpdate = true;
    outline.instanceMatrix.needsUpdate = true;
  };
  place();

  poof.play = () => {
    elapsed = 0;
    poof.playing = true;
    poof.visible = true;
    place();
  };
  poof.update = (dt) => {
    if (!poof.playing) return;
    elapsed += dt;
    place();
    if (elapsed >= POOF.seconds) {
      poof.playing = false;
      poof.visible = false;
    }
  };
  poof.dispose = () => {
    geometry.dispose();
    puffs.material.dispose();
    outline.material.dispose();
    gradientMap.dispose();
    puffs.dispose();
    outline.dispose();
  };
  return poof;
}
