// ─────────────────────────────────────────────
// bake-sleep-demon  –  the Boiled One download → public/assets/models/sleep-demon.glb
// ─────────────────────────────────────────────
// The Sleep Demon is drawn with the shade shader (MonsterFigure.js): pitch
// black, only its outline and its own eyes and grin show. So all it needs of
// the download is the silhouette. This keeps the body and its details,
// drops the eyes, gums, teeth and the head's alpha card (inside the head, or
// drawn by our own shader), every texture, UV and the skin, and decimates
// what is left:
//
//   1. Bake the skinned bind pose into plain positions and normals (the rig
//      has no animations; the figure stands still and glides).
//   2. Scale to `HEIGHT` metres, feet on the origin, facing +Z.
//   3. Weld and simplify (meshoptimizer) to about `TARGET_TRIANGLES`.
//   4. Mark where its eyes and mouth were, as empty nodes MonsterFigure reads:
//      `EyeL`, `EyeR` (the centres of the model's eyeballs), `Mouth` (the
//      front of the face, between the teeth) and `MouthAxis` (straight
//      behind it, in the middle of the head: the grin wraps round it).
//
// Usage: node scripts/bake-sleep-demon.mjs <boiled_one.glb> [out.glb]
// The source is not in the repo (see ATTRIBUTIONS.md for where it is from).
// ─────────────────────────────────────────────
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, simplify, prune } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import * as THREE from 'three';

const HEIGHT = 1.8;
const TARGET_TRIANGLES = 3000;
const KEEP = ['BoiledOneBody', 'BoiledOneDetails'];

const [src, out = 'public/assets/models/sleep-demon.glb'] = process.argv.slice(2);
if (!src) throw new Error('usage: node scripts/bake-sleep-demon.mjs <boiled_one.glb> [out.glb]');

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const input = await io.read(src);
const worldOf = node => new THREE.Matrix4().fromArray(node.getWorldMatrix());

// 1. Every primitive's vertices in the bind pose, by material name.
const parts = {};
for (const node of input.getRoot().listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  const skin = node.getSkin();
  const ibm = skin.getInverseBindMatrices();
  const joints = skin.listJoints().map((j, i) =>
    worldOf(j).multiply(new THREE.Matrix4().fromArray(ibm.getElement(i, []))));
  for (const prim of mesh.listPrimitives()) {
    const P = prim.getAttribute('POSITION');
    const N = prim.getAttribute('NORMAL');
    const J = prim.getAttribute('JOINTS_0');
    const W = prim.getAttribute('WEIGHTS_0');
    const positions = [], normals = [];
    const v = new THREE.Vector3(), n = new THREE.Vector3(), t = new THREE.Vector3();
    const m = new THREE.Matrix4(), nm = new THREE.Matrix3();
    for (let i = 0; i < P.getCount(); i++) {
      const j = J.getElement(i, []), w = W.getElement(i, []);
      m.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
      for (let k = 0; k < 4; k++) {
        if (!w[k]) continue;
        const e = joints[j[k]].elements;
        for (let q = 0; q < 16; q++) m.elements[q] += e[q] * w[k];
      }
      positions.push(v.fromArray(P.getElement(i, [])).applyMatrix4(m).clone());
      normals.push(n.fromArray(N.getElement(i, [])).applyMatrix3(nm.getNormalMatrix(m)).normalize().clone());
    }
    parts[prim.getMaterial().getName()] = { positions, normals, indices: prim.getIndices().getArray() };
  }
}

// 2. Feet on the origin, HEIGHT tall.
const kept = KEEP.map(name => parts[name]);
const bounds = new THREE.Box3();
for (const p of kept) for (const v of p.positions) bounds.expandByPoint(v);
const feet = new THREE.Box3().setFromPoints(parts.BoiledOneBody.positions.filter(v => v.y < bounds.min.y + 0.12));
const origin = new THREE.Vector3(feet.getCenter(t3()).x, bounds.min.y, feet.getCenter(t3()).z);
const scale = HEIGHT / (bounds.max.y - bounds.min.y);
const place = v => v.clone().sub(origin).multiplyScalar(scale);
function t3() { return new THREE.Vector3(); }

// Merge the kept parts into one primitive.
const pos = [], nor = [], idx = [];
for (const p of kept) {
  const base = pos.length / 3;
  for (const v of p.positions) pos.push(...place(v).toArray());
  for (const n of p.normals) nor.push(...n.toArray());
  for (const i of p.indices) idx.push(base + i);
}

// 4. Where the eyes and mouth are.
const eyes = parts.BoiledOneEyes.positions;
const eyeMidX = eyes.reduce((s, v) => s + v.x, 0) / eyes.length;
const eyeAt = side => place(new THREE.Box3().setFromPoints(eyes.filter(v => Math.sign(v.x - eyeMidX) === side)).getCenter(t3()));
const teeth = new THREE.Box3().setFromPoints(parts.BoiledOneTeeth.positions);
const mouthY = teeth.getCenter(t3()).y, mouthX = teeth.getCenter(t3()).x;
const near = parts.BoiledOneBody.positions.filter(v => Math.abs(v.y - mouthY) < 0.015);
const front = near.filter(v => Math.abs(v.x - mouthX) < 0.02).reduce((z, v) => Math.max(z, v.z), -Infinity);
const slice = new THREE.Box3().setFromPoints(near.filter(v => Math.abs(v.x - mouthX) < 0.12));
const mouth = place(new THREE.Vector3(mouthX, mouthY, front));
const axis = place(new THREE.Vector3(mouthX, mouthY, slice.getCenter(t3()).z));

// The new file: one mesh, four markers, nothing else.
const doc = new Document();
const buffer = doc.createBuffer();
const prim = doc.createPrimitive()
  .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buffer))
  .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(nor)).setBuffer(buffer))
  .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(idx)).setBuffer(buffer))
  .setMaterial(doc.createMaterial('SleepDemon').setBaseColorFactor([0, 0, 0, 1]).setDoubleSided(true));
const scene = doc.createScene('SleepDemon');
scene.addChild(doc.createNode('Body').setMesh(doc.createMesh('Body').addPrimitive(prim)));
scene.addChild(doc.createNode('EyeL').setTranslation(eyeAt(-1).toArray()));
scene.addChild(doc.createNode('EyeR').setTranslation(eyeAt(1).toArray()));
scene.addChild(doc.createNode('Mouth').setTranslation(mouth.toArray()));
scene.addChild(doc.createNode('MouthAxis').setTranslation(axis.toArray()));
doc.getRoot().setDefaultScene(scene);

// 3. Decimate.
await MeshoptSimplifier.ready;
const before = idx.length / 3;
await doc.transform(
  weld(),
  simplify({ simplifier: MeshoptSimplifier, ratio: TARGET_TRIANGLES / before, error: 0.02 }),
  prune({ keepLeaves: true }),
);
const after = prim.getIndices().getCount() / 3;
await io.write(out, doc);
console.log(`${before} → ${after} triangles, scale ${scale.toFixed(4)}`);
console.log('EyeL', eyeAt(-1).toArray().map(x => +x.toFixed(3)), 'EyeR', eyeAt(1).toArray().map(x => +x.toFixed(3)));
console.log('Mouth', mouth.toArray().map(x => +x.toFixed(3)), 'MouthAxis', axis.toArray().map(x => +x.toFixed(3)));
