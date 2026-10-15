import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import * as THREE from 'three';
import { RAGNO_RIG, RAGNO_HEAD, rigRagno, assembleHead, RagnoFigure, boneKey } from './RagnoFigure.js';

// ─────────────────────────────────────────────
// A small stand-in for the download's skeleton: the same names, the same
// shape (four legs up to a knee from the body, loose shins hanging from the
// root joint down to the feet, loose spikes and tail), skinned to one mesh.
// ─────────────────────────────────────────────

function bone(name, parent, [x, y, z]) {
  const b = new THREE.Bone();
  b.name = boneKey(name);
  b.position.set(x, y, z);
  parent?.add(b);
  return b;
}

/** World positions (as the rig expects to find them), built parent-first. */
function makeSkeleton() {
  const root = new THREE.Group();
  const rootJoint = bone('_rootJoint', null, [0, 0, 0]);
  root.add(rootJoint);
  const body = bone(RAGNO_RIG.body, rootJoint, [0, 1, 0]);
  const sides = [[1, 0.1], [0.4, -0.8], [-1, 0.1], [-0.4, -0.8]];   // FL, BL, FR, BR (x sign, z)
  RAGNO_RIG.legs.forEach((leg, i) => {
    const [sx, z] = sides[i];
    const hip = new THREE.Vector3(0.15 * Math.sign(sx), 1, z);
    const knee = new THREE.Vector3(0.9 * sx, 1.6, z);
    let parent = body, prevWorld = new THREE.Vector3(0, 1, 0);
    leg.chain.forEach((name, j) => {
      const w = hip.clone().lerp(knee, j / leg.chain.length);
      parent = bone(name, parent, w.clone().sub(prevWorld).toArray());
      prevWorld = w;
    });
    const kneeBone = bone(leg.knee, parent, knee.clone().sub(prevWorld).toArray());
    void kneeBone;
    const shin = bone(leg.shin, rootJoint, knee.toArray());
    bone(leg.foot, shin, [0, 0.1 - 1.6, 0]);
  });
  RAGNO_RIG.spikes.forEach((name, i) => {
    const [sx, z] = sides[i];
    bone(name, rootJoint, [0.6 * sx, 1.5, z]);
  });
  bone(RAGNO_RIG.tail, rootJoint, [0, 0.8, -0.3]);
  bone(RAGNO_RIG.head, body, [0, -0.1, 0.4]);

  const bones = [];
  root.traverse(o => { if (o.isBone) bones.push(o); });
  const mesh = new THREE.SkinnedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
  root.add(mesh);
  root.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));
  return { root, bones, mesh };
}

const worldOf = o => o.getWorldPosition(new THREE.Vector3());

describe('rigRagno', () => {
  it('reattaches every loose bone without moving anything', () => {
    const { root, bones } = makeSkeleton();
    const before = new Map(bones.map(b => [b, worldOf(b)]));
    rigRagno(root);
    root.updateMatrixWorld(true);
    for (const b of bones) expect(worldOf(b).distanceTo(before.get(b))).toBeLessThan(1e-6);
  });

  it('hangs each shin from its knee, so a leg is one chain to its foot', () => {
    const { root } = makeSkeleton();
    const rig = rigRagno(root);
    rig.legs.forEach((leg, i) => {
      expect(leg.shin.parent.name).toBe(boneKey(RAGNO_RIG.legs[i].knee));
      expect(leg.foot.parent).toBe(leg.shin);
    });
  });

  it('hangs each spike on its own leg, and the tail on the body', () => {
    const { root } = makeSkeleton();
    rigRagno(root);
    const legBones = RAGNO_RIG.legs.map(l => new Set([...l.chain, l.knee].map(boneKey)));
    RAGNO_RIG.spikes.forEach((name, i) => {
      const spike = root.getObjectByName(boneKey(name));
      expect(legBones[i].has(spike.parent.name)).toBe(true);
    });
    expect(root.getObjectByName(boneKey(RAGNO_RIG.tail)).parent.name).toBe(boneKey(RAGNO_RIG.body));
  });

  it('reads the feet at rest as homes, in the model root\'s space', () => {
    const { root } = makeSkeleton();
    const rig = rigRagno(root);
    expect(rig.homes[0][0]).toBeCloseTo(0.9);
    expect(rig.homes[0][1]).toBeCloseTo(0.1);
    expect(rig.homes[2][0]).toBeCloseTo(-0.9);
  });

  it('the IK puts each foot on a reachable target', () => {
    const { root } = makeSkeleton();
    const rig = rigRagno(root);
    const goals = rig.homes.map(([x, y, z]) => new THREE.Vector3(x + 0.15 * Math.sign(x), y, z + 0.25));
    for (let frame = 0; frame < 3; frame++) {
      rig.reset();
      root.updateMatrixWorld(true);
      goals.forEach((g, i) => rig.setTarget(i, g));
      rig.solve();
    }
    root.updateMatrixWorld(true);
    rig.legs.forEach((leg, i) => expect(worldOf(leg.foot).distanceTo(goals[i])).toBeLessThan(0.03));
  });

  it('reset puts the legs back as rigged', () => {
    const { root } = makeSkeleton();
    const rig = rigRagno(root);
    const rest = rig.legs.map(l => worldOf(l.foot));
    rig.setTarget(0, new THREE.Vector3(0.3, 0.1, 0.6));
    rig.solve();
    rig.reset();
    root.updateMatrixWorld(true);
    rig.legs.forEach((l, i) => expect(worldOf(l.foot).distanceTo(rest[i])).toBeLessThan(1e-6));
  });
});

describe('the download', () => {
  // The .glb's own node names and rest pose, read straight from its JSON chunk.
  const glb = fs.readFileSync(new URL('../../public/assets/models/ragno.glb', import.meta.url));
  const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString());
  const parent = {};
  json.nodes.forEach((n, i) => (n.children ?? []).forEach(c => { parent[c] = i; }));
  const byName = new Map(json.nodes.map((n, i) => [boneKey(n.name ?? ''), i]));
  const local = n => new THREE.Matrix4().compose(
    new THREE.Vector3(...(n.translation ?? [0, 0, 0])),
    new THREE.Quaternion(...(n.rotation ?? [0, 0, 0, 1])),
    new THREE.Vector3(...(n.scale ?? [1, 1, 1])),
  );
  const world = (name) => {
    let i = byName.get(boneKey(name));
    const m = local(json.nodes[i]);
    while ((i = parent[i]) !== undefined) m.premultiply(local(json.nodes[i]));
    return new THREE.Vector3().setFromMatrixPosition(m);
  };

  it('has every bone the rig names', () => {
    const names = [RAGNO_RIG.body, RAGNO_RIG.head, RAGNO_RIG.tail, ...RAGNO_RIG.spikes,
      ...RAGNO_RIG.legs.flatMap(l => [...l.chain, l.knee, l.shin, l.foot])];
    for (const name of names) expect(byName.has(boneKey(name)), name).toBe(true);
  });

  it('starts each loose shin on its knee, so reattaching it bends nothing', () => {
    for (const leg of RAGNO_RIG.legs) expect(world(leg.shin).distanceTo(world(leg.knee))).toBeLessThan(0.01);
  });

  it('orders the legs front-left, back-left, front-right, back-right (it faces +z)', () => {
    const feet = RAGNO_RIG.legs.map(l => world(l.foot));
    expect(feet[0].x).toBeGreaterThan(0);
    expect(feet[1].x).toBeGreaterThan(0);
    expect(feet[2].x).toBeLessThan(0);
    expect(feet[3].x).toBeLessThan(0);
    expect(feet[0].z).toBeGreaterThan(feet[1].z);
    expect(feet[2].z).toBeGreaterThan(feet[3].z);
    expect(world(RAGNO_RIG.head).z).toBeGreaterThan(world(RAGNO_RIG.body).z);
  });
});

describe('RagnoFigure', () => {
  it('without the model (a test\'s stub assets), stands in with a placeholder and no rig', () => {
    const fig = new RagnoFigure({ model: null });
    expect(fig.rig).toBeNull();
    expect(fig.object3d.getObjectByName('RagnoPlaceholder')).toBeTruthy();
    expect(() => fig.update(1 / 60, { velocity: new THREE.Vector3(), cast: () => false })).not.toThrow();
  });

  it('starts hidden, and shows when asked', () => {
    const fig = new RagnoFigure({ model: null });
    expect(fig.object3d.visible).toBe(false);
    fig.show(true);
    expect(fig.object3d.visible).toBe(true);
  });

  it('stands on a surface: its pose puts the root there, with the surface\'s up as its up', () => {
    const fig = new RagnoFigure({ model: null });
    const up = new THREE.Vector3(1, 0, 0);
    fig.setPose(new THREE.Vector3(5, 2, 1), up, new THREE.Vector3(0, -1, 0));
    fig.object3d.updateMatrixWorld(true);
    expect(fig.object3d.position.toArray()).toEqual([5, 2, 1]);
    const yAxis = new THREE.Vector3(0, 1, 0).applyQuaternion(fig.object3d.quaternion);
    const zAxis = new THREE.Vector3(0, 0, 1).applyQuaternion(fig.object3d.quaternion);
    expect(yAxis.distanceTo(up)).toBeLessThan(1e-6);
    expect(zAxis.distanceTo(new THREE.Vector3(0, -1, 0))).toBeLessThan(1e-6);
  });

  it('with a rigged model, walks it: the feet follow the gait onto the floor', () => {
    const { root } = makeSkeleton();
    const fig = new RagnoFigure({ model: root });
    expect(fig.rig).not.toBeNull();
    const floor = (o, d, out) => (d.y < 0 ? (out.copy(o).addScaledVector(d, o.y / -d.y), true) : false);
    fig.setPose(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1));
    fig.plant(floor);
    const v = new THREE.Vector3(0, 0, 1);
    let z = 0;
    for (let i = 0; i < 120; i++) {
      z += 1 / 60;
      fig.setPose(new THREE.Vector3(0, 0, z), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1));
      fig.update(1 / 60, { velocity: v, cast: floor });
    }
    root.updateMatrixWorld(true);
    // Every planted foot is where the gait put it, at its rest height over the floor.
    fig.rig.legs.forEach((leg, i) => {
      if (fig.gait.legs[i].stepping) return;
      const goal = fig.gait.feet[i].clone().setY(fig.rig.homes[i][1]);
      expect(worldOf(leg.foot).distanceTo(goal)).toBeLessThan(0.05);
    });
  });
});

describe('assembleHead', () => {
  /** The export's fault in small: a part skinned to two bones, drawn at the
   *  wrong size in the wrong place (here, 1/50 scale near the floor). */
  function makeBrokenHead() {
    const root = new THREE.Group();
    const spineTip = bone(RAGNO_HEAD.bone, null, [0, 0.8, 0.3]);
    const other = bone('Bone.004_024', null, [0, 0.6, 0.4]);
    root.add(spineTip, other);
    const geo = new THREE.BoxGeometry(10, 20, 10).translate(0, 10, 0);
    const n = geo.attributes.position.count;
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(n * 4).map((_, i) => (i % 4 === 0 ? 1 : 0)), 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Float32Array(n * 4).map((_, i) => (i % 4 === 0 ? 1 : 0)), 4));
    const mat = new THREE.MeshStandardMaterial();
    mat.name = 'Hair';
    const mesh = new THREE.SkinnedMesh(geo, mat);
    mesh.scale.setScalar(0.02);
    root.add(mesh);
    root.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton([spineTip, other]));
    return { root, mesh, geo };
  }

  it('draws each part where RAGNO_HEAD puts it, at its scale of the size it came out at', () => {
    const { root, mesh } = makeBrokenHead();
    const before = new THREE.Box3().setFromObject(mesh, true).getSize(new THREE.Vector3());
    assembleHead(root);
    root.updateMatrixWorld(true);
    const after = new THREE.Box3().setFromObject(mesh, true);
    const part = RAGNO_HEAD.parts.Hair;
    expect(after.getCenter(new THREE.Vector3()).distanceTo(new THREE.Vector3(...part.at))).toBeLessThan(1e-4);
    expect(after.getSize(new THREE.Vector3()).y).toBeCloseTo(before.y * part.scale, 5);
  });

  it('binds the part wholly to the tip of the spine, so face, hair and eyes move as one', () => {
    const { root, mesh } = makeBrokenHead();
    assembleHead(root);
    const tip = mesh.skeleton.bones.findIndex(b => b.name === boneKey(RAGNO_HEAD.bone));
    const idx = mesh.geometry.attributes.skinIndex, w = mesh.geometry.attributes.skinWeight;
    for (let i = 0; i < idx.count; i++) {
      expect(idx.getX(i)).toBe(tip);
      expect(w.getX(i)).toBe(1);
    }
  });

  it('works on a copy: the cached geometry is left alone, and the copies are handed back to free', () => {
    const { root, mesh, geo } = makeBrokenHead();
    const made = assembleHead(root);
    expect(mesh.geometry).not.toBe(geo);
    expect(made).toContain(mesh.geometry);
    expect(geo.attributes.skinIndex.getX(0)).toBe(1);
  });

  it('leaves a model without the bone as it was', () => {
    expect(assembleHead(new THREE.Group())).toEqual([]);
  });
});
