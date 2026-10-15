import * as THREE from 'three';
import { CCDIKSolver } from 'three/examples/jsm/animation/CCDIKSolver.js';
import { GameObject } from '../core/GameObject.js';
import { RagnoGait } from '../gameplay/RagnoGait.js';

// ─────────────────────────────────────────────
// RagnoFigure  –  the camera entity's body, walked by IK
// ─────────────────────────────────────────────
// The download ("Ragno (Monster)", see ATTRIBUTIONS.md) is rigged but ships
// only a breathing idle. Its legs were driven by IK in Blender, and the
// constraints did not survive the export: each leg's upper chain runs from
// the body up to the knee, and the shin that hangs from there to the foot is
// a loose bone on the root joint, as are the spikes on the knees and the
// tail. So at load:
//
//   1. every loose bone is reattached where it belongs (Object3D.attach keeps
//      its world transform, so the skinning is unchanged): the shin to its
//      knee, a spike to the nearest bone of its leg, the tail to the body.
//      Each leg is then one chain, hip → knee → shin → foot.
//   2. one CCDIKSolver entry per leg brings each foot to a target the gait
//      (RagnoGait) places, every frame, after the idle clip has played.
//
// The figure is posed by the surface it stands on — floor, slope or wall —
// with that surface's normal as its up (setPose). Without the model (a
// test's stub assets) a placeholder stands in, with no rig.
// ─────────────────────────────────────────────

/** Bone names as the download has them; GLTFLoader strips the dots
 *  (boneKey) as it loads. Legs in the gait's order: front-left, back-left,
 *  front-right, back-right. The model faces +z, so its left is +x. */
export const RAGNO_RIG = {
  body: 'Bone_00',
  head: 'Bone.003_03',
  tail: 'Bone.039_039',
  legs: [
    { chain: ['Bone.005_04', 'Bone.006_05', 'Bone.007_06', 'Bone.008_07', 'Bone.009_08'], knee: 'Bone.009_end_041', shin: 'Bone.010_031', foot: 'Bone.010_end_047' },
    { chain: ['Bone.011_09', 'Bone.012_010', 'Bone.013_011', 'Bone.014_012', 'Bone.015_013'], knee: 'Bone.015_end_042', shin: 'Bone.016_032', foot: 'Bone.016_end_048' },
    { chain: ['Bone.017_014', 'Bone.018_015', 'Bone.019_016', 'Bone.020_017', 'Bone.021_018'], knee: 'Bone.021_end_043', shin: 'Bone.022_033', foot: 'Bone.022_end_049' },
    { chain: ['Bone.023_019', 'Bone.024_020', 'Bone.025_021', 'Bone.026_022', 'Bone.027_023'], knee: 'Bone.027_end_044', shin: 'Bone.028_034', foot: 'Bone.028_end_050' },
  ],
  /** The knee spikes, one per leg in the same order. */
  spikes: ['Bone.035_035', 'Bone.037_036', 'Bone.036_038', 'Bone.038_037'],
  /** The two palps at the front. */
  arms: ['Bone.029_025', 'Bone.032_028'],
};

/** CCD passes per leg per frame. */
const IK_ITERATIONS = 8;

/** Share of the way back to the rig's own pose each leg relaxes per frame
 *  before it is solved, so a long walk never drifts the knees. */
const RELAX = 0.12;

/** Radians each hip turns its knee up and in at the thin stance: the knees
 *  are the widest part of him, and a doorway is 1.2 m. */
const THIN_HIP = 0.9;

/**
 * The head, put back together (assembleHead). The export dropped the head's
 * own nodes, so its three meshes — the face, the hair and the eyes — come
 * out of the shared skin at the wrong size and in the wrong place: a
 * centimetre-high face on the floor, a hair 1.6 m long and the eyes behind
 * it. As the creator's thumbnail has it, the face hangs at the front of the
 * body where the spine ends, inside a fall of hair down to about knee
 * height, its two eyes glowing in its sockets. In the model's space at rest,
 * metres: each part's middle (`at`) and size (`scale` of its own, as it
 * comes out of the skin). Keyed by material name.
 */
export const RAGNO_HEAD = {
  bone: 'Bone.003_03',
  parts: {
    Hair: { at: [0, 0.74, 0.41], scale: 0.52 },
    Head: { at: [0, 0.84, 0.49], scale: 4.3 },
    ayez: { at: [0, 0.89, 0.58], scale: 0.9 },
  },
};

/**
 * Put the head back together (RAGNO_HEAD), on copies of its meshes'
 * geometry: each part bound wholly to the spine's tip, so the three move as
 * one, then moved and scaled where it belongs. Run on the model at rest,
 * before anything poses it. Returns the geometries made, for the caller to
 * free (the cached ones are never touched).
 * @param {THREE.Object3D} model
 */
export function assembleHead(model, spec = RAGNO_HEAD) {
  const made = [];
  const bone = model.getObjectByName(boneKey(spec.bone));
  if (!bone) return made;
  model.updateMatrixWorld(true);
  const toModel = model.matrixWorld.clone().invert();
  const meshes = [];
  model.traverse((o) => { if (o.isSkinnedMesh && spec.parts[o.material?.name]) meshes.push(o); });
  for (const mesh of meshes) {
    const part = spec.parts[mesh.material.name];
    const index = mesh.skeleton.bones.indexOf(bone);
    if (index < 0) continue;
    // Bound to the one bone first, so what is measured is what will be drawn.
    const geo = mesh.geometry.clone();
    made.push(geo);
    const n = geo.attributes.position.count;
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(n * 4).map((_, i) => (i % 4 === 0 ? index : 0)), 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Float32Array(n * 4).map((_, i) => (i % 4 === 0 ? 1 : 0)), 4));
    mesh.geometry = geo;
    // Where it comes out of the skin now (model space), against its own
    // vertices: the skin at rest is a scale and an offset.
    const drawn = new THREE.Box3().setFromObject(mesh, true).applyMatrix4(toModel);
    geo.computeBoundingBox();
    const raw = geo.boundingBox;
    const k = drawn.getSize(new THREE.Vector3()).divide(raw.getSize(new THREE.Vector3()));
    const t = drawn.min.clone().sub(raw.min.clone().multiply(k));
    const c = drawn.getCenter(new THREE.Vector3());
    // Drawn at `at`, `scale` times the size: v → s·v + (at + s·(t − c) − t) / k.
    const s = part.scale;
    const at = new THREE.Vector3(...part.at);
    const offset = at.add(t.clone().sub(c).multiplyScalar(s)).sub(t).divide(k);
    geo.applyMatrix4(new THREE.Matrix4().makeScale(s, s, s).setPosition(offset));
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
  }
  return made;
}

/** A bone's name as GLTFLoader leaves it. */
export const boneKey = name => THREE.PropertyBinding.sanitizeNodeName(name);

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

/**
 * Reattach the loose bones and build the IK. `root` is the model's root,
 * already scaled; the homes are read in its space.
 * @param {THREE.Object3D} root
 */
export function rigRagno(root, { iteration = IK_ITERATIONS } = {}) {
  const find = (name) => {
    const bone = root.getObjectByName(boneKey(name));
    if (!bone) throw new Error(`[RagnoFigure] no bone "${name}" in the model`);
    return bone;
  };
  root.updateMatrixWorld(true);
  const body = find(RAGNO_RIG.body);

  const bones = [];
  const index = (bone) => {
    let i = bones.indexOf(bone);
    if (i < 0) i = bones.push(bone) - 1;
    return i;
  };

  const legs = RAGNO_RIG.legs.map((spec) => {
    const chain = spec.chain.map(find);
    const knee = find(spec.knee);
    const shin = find(spec.shin);
    const foot = find(spec.foot);
    if (shin.parent !== knee) knee.attach(shin);
    const target = new THREE.Object3D();
    target.name = `${boneKey(spec.shin)}_target`;
    return { chain, knee, shin, foot, target };
  });

  // A spike rides on the bone of its leg nearest to it.
  RAGNO_RIG.spikes.forEach((name, i) => {
    const spike = root.getObjectByName(boneKey(name));
    if (!spike) return;
    spike.getWorldPosition(_a);
    let best = null, bestD = Infinity;
    for (const bone of [...legs[i].chain, legs[i].knee]) {
      const d = bone.getWorldPosition(_b).distanceTo(_a);
      if (d < bestD) { bestD = d; best = bone; }
    }
    if (best && spike.parent !== best) best.attach(spike);
  });
  const tail = root.getObjectByName(boneKey(RAGNO_RIG.tail));
  if (tail && tail.parent !== body) body.attach(tail);
  root.updateMatrixWorld(true);

  // Where each foot stands at rest, in the root's space: the gait's homes.
  const toRoot = root.matrixWorld.clone().invert();
  const homes = legs.map(l => l.foot.getWorldPosition(new THREE.Vector3()).applyMatrix4(toRoot).toArray());

  // Each link's rest rotation. The solve starts each frame from the last
  // frame's solution, eased a little back toward this (relax), so it
  // converges in a few passes and the knees keep bending the way they were
  // built. The idle clip is kept off the legs (legTracks): the IK owns them.
  const links = legs.flatMap(l => [l.shin, l.knee, ...l.chain]);
  const rest = links.map(b => b.quaternion.clone());
  const legNames = new Set(links.map(b => b.name));

  // The thin stance's rest: each hip turned about the body's long axis, its
  // knee swung up toward the spine. Worked out in the model's space, then
  // put back in the hip's parent's.
  const hips = legs.map(l => l.chain[0]);
  const thinRest = hips.map((hip, i) => {
    const side = Math.sign(homes[i][0]) || 1;
    const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), side * THIN_HIP);
    const rootQ = root.getWorldQuaternion(new THREE.Quaternion());
    const parentQ = hip.parent.getWorldQuaternion(new THREE.Quaternion());
    const worldQ = hip.getWorldQuaternion(new THREE.Quaternion());
    // In the root's frame: rootQ · turn · rootQ⁻¹ · world.
    const turned = rootQ.clone().multiply(turn).multiply(rootQ.clone().invert()).multiply(worldQ);
    return parentQ.invert().multiply(turned);
  });
  const hipIndex = hips.map(h => links.indexOf(h));
  const _q = new THREE.Quaternion();

  const iks = legs.map(l => ({
    target: index(l.target),
    effector: index(l.foot),
    links: [l.shin, l.knee, ...[...l.chain].reverse()].map(b => ({ index: index(b) })),
    iteration,
  }));
  // CCDIKSolver reads only `skeleton.bones`: the targets are plain objects
  // whose world matrices are set by hand, never skinned.
  const solver = new CCDIKSolver({ skeleton: { bones } }, iks);

  const arms = RAGNO_RIG.arms.map(n => root.getObjectByName(boneKey(n))).filter(Boolean);
  return {
    root, body, legs, homes, solver, arms,
    head: root.getObjectByName(boneKey(RAGNO_RIG.head)),
    /** The palps' rest rotations: the idle never writes them. */
    armRest: arms.map(a => a.quaternion.clone()),
    /** Every leg back as rigged. */
    reset() {
      for (let i = 0; i < links.length; i++) links[i].quaternion.copy(rest[i]);
    },
    /** Each leg eased `k` of the way back toward its rest pose — at a
     *  stance: thin, the hips' rest has the knees up and in. */
    relax(k = RELAX, stance = 0) {
      for (let i = 0; i < links.length; i++) {
        const h = hipIndex.indexOf(i);
        const goal = h < 0 || stance <= 0 ? rest[i] : _q.copy(rest[i]).slerp(thinRest[h], Math.min(stance, 1));
        links[i].quaternion.slerp(goal, k);
      }
    },
    /** Does an animation track drive a leg bone? */
    isLegTrack(track) {
      return legNames.has(track.name.slice(0, track.name.lastIndexOf('.')));
    },
    /** Foot `i`'s target, in world space. */
    setTarget(i, world) {
      legs[i].target.matrixWorld.makeTranslation(world.x, world.y, world.z);
    },
    solve() {
      root.updateMatrixWorld(true);
      solver.update();
    },
  };
}

const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _target = new THREE.Vector3();

export class RagnoFigure extends GameObject {
  /**
   * @param {object} opts
   * @param {THREE.Object3D|null} opts.model  A clone of `model:ragno`; null for a placeholder.
   * @param {THREE.AnimationClip[]} [opts.animations]  The download's idle.
   * @param {THREE.Object3D|null} [opts.warm]  A second clone, kept hidden in
   *        the fog-free materials, so the boot's warm-up compiles them too
   *        and going indoors compiles nothing mid-game.
   */
  constructor({ model, animations = [], warm = null, name = 'Ragno' } = {}) {
    super(name);
    const root = this.object3d;
    root.visible = false;
    /** The surface's up, as last posed. */
    this.up = new THREE.Vector3(0, 1, 0);
    /** GPU resources made here (the fog-free materials, the placeholder). */
    this.resources = [];

    // The body is lifted inside the pose (a thin stance, a flinch).
    this.body = new THREE.Group();
    this.body.name = 'RagnoBody';
    root.add(this.body);

    this.rig = null;
    this.mixer = null;
    if (model) {
      this.model = model;
      // At rest, before anything poses it: the face, hair and eyes back
      // where they belong, on the spine's tip.
      this.resources.push(...assembleHead(model));
      this.body.add(model);
      model.traverse((o) => {
        if (!o.isMesh) return;
        // A skinned mesh's bounds don't follow its bones; it is small.
        o.frustumCulled = false;
        o.castShadow = false;
      });
      this.rig = rigRagno(model);
      if (animations.length) {
        // The breathing idle, on everything but the legs.
        const rig = this.rig;
        const idle = animations[0].clone();
        idle.tracks = idle.tracks.filter(t => !rig.isLegTrack(t));
        this.mixer = new THREE.AnimationMixer(model);
        this.mixer.clipAction(idle).play();
      }
      this._buildIndoorMaterials(model);
      if (warm) {
        const byMesh = new Map(this._swaps.map(sw => [sw.mesh.name, sw.indoor]));
        warm.traverse((o) => {
          if (!o.isMesh) return;
          o.frustumCulled = false;
          o.castShadow = false;
          if (byMesh.has(o.name)) o.material = byMesh.get(o.name);
        });
        warm.visible = false;
        warm.name = 'RagnoWarmUp';
        root.add(warm);
      }
    } else {
      this.model = this._placeholder();
      this.body.add(this.model);
    }

    const homes = this.rig?.homes ?? [[0.73, 0, 0.06], [0.26, 0, -0.69], [-0.73, 0, 0.06], [-0.26, 0, -0.69]];
    /** The model's own scale against the figure (its root is never scaled
     *  by the manifest, which bakes its scale in below the root). */
    this._scale = 1;
    // The gait plants feet on the surface; the homes' heights are where the
    // foot bones end above it (see update).
    this.gait = new RagnoGait({ homes: homes.map(([x, , z]) => [x, 0, z]) });
    this._indoors = false;
    this._t = 0;
  }

  show(on) {
    this.object3d.visible = on;
  }

  /**
   * Stand at `position` on a surface whose normal is `up`, facing `forward`
   * (any vector not along `up`; it is squared onto the surface).
   */
  setPose(position, up, forward) {
    const o = this.object3d;
    o.position.copy(position);
    _y.copy(up).normalize();
    _z.copy(forward).addScaledVector(_y, -forward.dot(_y));
    if (_z.lengthSq() < 1e-8) _z.set(0, 0, 1).addScaledVector(_y, -_y.z);
    _z.normalize();
    _x.crossVectors(_y, _z);
    o.quaternion.setFromRotationMatrix(_m.makeBasis(_x, _y, _z));
    this.up.copy(_y);
  }

  /** Every foot planted under it: on showing, or after a jump cut. */
  plant(cast, stance = 0) {
    this.object3d.updateMatrixWorld(true);
    this.gait.reset(this.object3d.matrixWorld, this.up, cast, stance);
  }

  /**
   * One frame: the gait moves the feet, the idle plays, the IK lands them.
   * @param {number} dt
   * @param {object} state
   * @param {THREE.Vector3} state.velocity  World m/s.
   * @param {(o: THREE.Vector3, d: THREE.Vector3, out: THREE.Vector3) => boolean} state.cast
   * @param {number} [state.stance=0]  0 wide … 1 thin.
   * @param {number} [state.flinch=0]  0..1: rearing back.
   * @param {number} [state.twitch=0]  0..1: how restless the palps are.
   */
  update(dt, { velocity, cast, stance = 0, flinch = 0, twitch = 0.3 }) {
    this._t += dt;
    const o = this.object3d;
    o.updateMatrixWorld(true);
    this.gait.update(dt, { matrix: o.matrixWorld, velocity, up: this.up, stance, cast });

    // The body rides higher thin, bobs as its feet go, and rears in a flinch.
    const bob = 0.025 * this.gait.lifted;
    this.body.position.set(0, this.gait.bodyLift(stance) + bob + 0.18 * flinch, -0.12 * flinch);
    this.body.rotation.x = -0.45 * flinch;

    const rig = this.rig;
    if (!rig) return;
    rig.relax(undefined, stance);
    this.mixer?.update(dt);
    // The palps never quite still.
    for (let i = 0; i < rig.arms.length; i++) {
      const arm = rig.arms[i];
      const w = twitch * (0.25 + 0.75 * flinch);
      arm.quaternion.copy(rig.armRest[i]);
      arm.rotateX(w * Math.sin(this._t * (17 + i * 6) + i) * 0.25);
      arm.rotateZ(w * Math.sin(this._t * (11 + i * 9)) * 0.15);
    }
    rig.root.updateMatrixWorld(true);
    // The foot bone ends a little above the tip that touches down: aim it
    // that far up off the spot the gait planted, as it stands at rest.
    for (let i = 0; i < rig.legs.length; i++) {
      rig.setTarget(i, _target.copy(this.gait.feet[i]).addScaledVector(this.up, rig.homes[i][1] * this._scale));
    }
    rig.solve();
  }

  /** Indoors nothing takes the storm's fog (BaseScene._keepFogOutside), so
   *  neither does it there: fog-free copies of its materials, made at build
   *  so the swap compiles nothing mid-game. */
  setIndoors(indoors) {
    if (indoors === this._indoors || !this._swaps) return;
    this._indoors = indoors;
    for (const { mesh, outdoor, indoor } of this._swaps) mesh.material = indoors ? indoor : outdoor;
  }

  /** The middle of its body, in the world. */
  bodyPosition(out) {
    const body = this.rig?.body ?? this.body;
    return body.getWorldPosition(out);
  }

  /** Its head, in the world. */
  headPosition(out) {
    return (this.rig?.head ?? this.body).getWorldPosition(out);
  }

  dispose() {
    this.mixer?.stopAllAction();
    for (const r of this.resources) r.dispose();
    this.resources.length = 0;
  }

  _buildIndoorMaterials(model) {
    const copies = new Map();
    this._swaps = [];
    model.traverse((o) => {
      if (!o.isMesh) return;
      const outdoor = o.material;
      const copy = (m) => {
        if (!m) return m;
        let c = copies.get(m);
        if (!c) {
          c = m.clone();
          c.fog = false;
          copies.set(m, c);
          this.resources.push(c);
        }
        return c;
      };
      const indoor = Array.isArray(outdoor) ? outdoor.map(copy) : copy(outdoor);
      this._swaps.push({ mesh: o, outdoor, indoor });
    });
  }

  /** A dark body on four legs, for tests and a missing download. */
  _placeholder() {
    const group = new THREE.Group();
    group.name = 'RagnoPlaceholder';
    const mat = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 });
    const bodyGeo = new THREE.SphereGeometry(0.35, 12, 8);
    const legGeo = new THREE.CylinderGeometry(0.03, 0.02, 1.2, 6);
    this.resources.push(mat, bodyGeo, legGeo);
    const torso = new THREE.Mesh(bodyGeo, mat);
    torso.position.y = 0.95;
    torso.scale.set(1, 0.7, 1.4);
    group.add(torso);
    for (const [x, z] of [[0.5, 0.05], [0.2, -0.5], [-0.5, 0.05], [-0.2, -0.5]]) {
      const leg = new THREE.Mesh(legGeo, mat);
      leg.position.set(x, 0.6, z);
      leg.rotation.z = -Math.sign(x) * 0.5;
      group.add(leg);
    }
    return group;
  }
}
