import * as THREE from 'three';
import { makeRandom, randRange } from '../core/Random.js';
import { toonRamp, CHEESE } from './CheeseBall.js';

// ─────────────────────────────────────────────
// CheeseBlast  –  the ball of cheese going off
// ─────────────────────────────────────────────
// A fireball that tears out of a ball's middle, far past it, with chunks
// of cheese rind flung out of it, falling and tumbling, over
// `BLAST.seconds`.
//
//   const blast = createCheeseBlast({ radius: 0.143 });
//   globe.object3d.add(blast);
//   blast.play();
//   blast.update(dt);                      // each frame; hides itself when done
//   blast.dispose();
//
// The fire is unlit and drawn from both sides, so a view caught inside it
// is filled with it. Two InstancedMeshes (the fire and the chunks): two
// draw calls. Built hidden, so its shaders compile with the scene. No
// shadow, no fog. Seeded: the same blast every time.
// ─────────────────────────────────────────────

/** The blast's numbers. Sizes and distances are shares of the ball's radius. */
export const BLAST = Object.freeze({
  seconds: 0.9,
  fire: 16,
  /** A fire puff's radius at its biggest, and how far out it is flung. */
  fireSize: [2.5, 4.5],
  fireTravel: [3, 8],
  /** Of the blast's time: the fire is at its biggest here, then shrinks. */
  fireUntil: 0.35,
  /** White-hot at the core to orange at the edge. */
  fireColors: [0xfff6c8, 0xffc040, 0xff7a18, 0xe8400c],
  chunks: 14,
  chunkSize: [0.25, 0.5],
  /** Metres a second out of the blast, and what pulls them down. */
  chunkSpeed: [3, 7],
  gravity: 9.8,
  seed: 6669,
});

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

/** Spread round a ball (golden-angle spiral, jittered), `up` more upward. */
function spread(i, n, rand, up) {
  const y = 1 - ((i + 0.5) / n) * (2 - up);
  const a = i * 2.39996 + randRange(rand, -0.4, 0.4);
  const s = Math.sqrt(Math.max(0, 1 - y * y));
  return new THREE.Vector3(s * Math.cos(a), y, s * Math.sin(a)).normalize();
}

/**
 * Build the blast. A THREE.Group named `CheeseBlast`, with `fire` and
 * `chunks` meshes, `play()`, `update(dt)`, `playing` and `dispose()`.
 * @param {object} [opts]
 * @param {number} [opts.radius=0.143]  Metres: the ball it goes off from.
 * @param {number} [opts.seed]
 */
export function createCheeseBlast({ radius = 0.143, seed = BLAST.seed } = {}) {
  const rand = makeRandom(seed);
  const fires = Array.from({ length: BLAST.fire }, (_, i) => ({
    dir: spread(i, BLAST.fire, rand, 0.4),
    size: randRange(rand, ...BLAST.fireSize) * radius,
    travel: randRange(rand, ...BLAST.fireTravel) * radius,
  }));
  const chunks = Array.from({ length: BLAST.chunks }, (_, i) => ({
    vel: spread(i, BLAST.chunks, rand, 0.6).multiplyScalar(randRange(rand, ...BLAST.chunkSpeed)),
    size: randRange(rand, ...BLAST.chunkSize) * radius,
    axis: new THREE.Vector3(randRange(rand, -1, 1), randRange(rand, -1, 1), randRange(rand, -1, 1)).normalize(),
    spin: randRange(rand, 8, 20),
  }));

  const fireGeometry = new THREE.IcosahedronGeometry(1, 2);
  const fire = new THREE.InstancedMesh(fireGeometry, new THREE.MeshBasicMaterial({
    side: THREE.DoubleSide, fog: false, toneMapped: false,
  }), BLAST.fire);
  // The hottest puffs go nearest the middle.
  fires.sort((a, b) => a.travel - b.travel);
  fires.forEach((_, i) => {
    const band = Math.min(BLAST.fireColors.length - 1, Math.floor(i / BLAST.fire * BLAST.fireColors.length));
    fire.setColorAt(i, _c.setHex(BLAST.fireColors[band]));
  });

  const chunkGeometry = new THREE.BoxGeometry(1, 0.7, 0.8);
  const gradientMap = new THREE.DataTexture(toonRamp(CHEESE.bands), CHEESE.bands * 2, 1, THREE.RedFormat);
  gradientMap.minFilter = gradientMap.magFilter = THREE.NearestFilter;
  gradientMap.generateMipmaps = false;
  gradientMap.needsUpdate = true;
  const chunk = new THREE.InstancedMesh(chunkGeometry, new THREE.MeshToonMaterial({
    color: CHEESE.rind, emissive: 0x4a2a08, gradientMap, fog: false,
  }), BLAST.chunks);

  for (const mesh of [fire, chunk]) {
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = mesh.receiveShadow = false;
    mesh.frustumCulled = false;                   // its instances move far from the geometry's bounds
  }
  fire.name = 'BlastFire';
  chunk.name = 'BlastChunks';

  const blast = new THREE.Group();
  blast.name = 'CheeseBlast';
  blast.add(fire, chunk);
  blast.visible = false;
  blast.fire = fire;
  blast.chunks = chunk;
  blast.playing = false;
  let elapsed = 0;

  const place = () => {
    const t = Math.min(1, elapsed / BLAST.seconds);
    // Out at once, then easing; at its biggest by `fireUntil`, then gone.
    const out = 1 - (1 - t) ** 4;
    const k = t < BLAST.fireUntil
      ? 1 - (1 - t / BLAST.fireUntil) ** 3
      : 1 - ((t - BLAST.fireUntil) / (1 - BLAST.fireUntil)) ** 2;
    for (let i = 0; i < fires.length; i++) {
      const f = fires[i];
      _p.copy(f.dir).multiplyScalar(f.travel * out);
      _m.compose(_p, _q.identity(), _s.setScalar(Math.max(0, f.size * k)));
      fire.setMatrixAt(i, _m);
    }
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      _p.copy(c.vel).multiplyScalar(elapsed);
      _p.y -= 0.5 * BLAST.gravity * elapsed * elapsed;
      _q.setFromAxisAngle(c.axis, c.spin * elapsed);
      _m.compose(_p, _q, _s.setScalar(c.size));
      chunk.setMatrixAt(i, _m);
    }
    fire.instanceMatrix.needsUpdate = true;
    chunk.instanceMatrix.needsUpdate = true;
  };
  place();

  blast.play = () => {
    elapsed = 0;
    blast.playing = true;
    blast.visible = true;
    place();
  };
  blast.update = (dt) => {
    if (!blast.playing) return;
    elapsed += dt;
    place();
    if (elapsed >= BLAST.seconds) {
      blast.playing = false;
      blast.visible = false;
    }
  };
  blast.dispose = () => {
    fireGeometry.dispose();
    chunkGeometry.dispose();
    fire.material.dispose();
    chunk.material.dispose();
    gradientMap.dispose();
    fire.dispose();
    chunk.dispose();
  };
  return blast;
}
