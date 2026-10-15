import * as THREE from 'three';
import { GameObject } from '../core/GameObject.js';

// ─────────────────────────────────────────────
// WallVent  –  the air vent Ragno comes in by
// ─────────────────────────────────────────────
// One per wing (BaseScene._addVents). Outside, a steel duct hood stands off
// the end wall's slope near the roof: a box open at its face, dark inside.
// Inside, a grille high on the same wall: a frame and slats over black.
// Both are built in code, drawn only (no collider), and face +z in their own
// space: the caller turns them to face out of the wall.
//
//   const hood = createVentHood({ width, height, depth });
//   const grille = createVentGrille({ width, height });
//   …                        // place them; free hood.resources on dispose
// ─────────────────────────────────────────────

const STEEL = 0x3b3c3a;
const DARK = 0x050505;

/** Steel and the black of the duct, shared by everything one vent builds. */
function materials(resources) {
  const steel = new THREE.MeshStandardMaterial({ color: STEEL, roughness: 0.55, metalness: 0.7 });
  const dark = new THREE.MeshBasicMaterial({ color: DARK });
  resources.push(steel, dark);
  return { steel, dark };
}

/**
 * The hood outside: `depth` deep out of the wall, its open face at +z.
 * @returns {GameObject & { resources: Array<{ dispose(): void }> }}
 */
export function createVentHood({ width = 0.8, height = 0.55, depth = 0.45, name = 'VentHood' } = {}) {
  const go = new GameObject(name);
  const resources = [];
  const { steel, dark } = materials(resources);
  const t = 0.03;
  const box = (w, h, d, x, y, z, mat) => {
    const geo = new THREE.BoxGeometry(w, h, d);
    resources.push(geo);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.receiveShadow = true;
    go.object3d.add(mesh);
    return mesh;
  };
  // The sleeve: top, bottom and sides, open at the face.
  box(width, t, depth, 0, height / 2, depth / 2, steel);
  box(width, t, depth, 0, -height / 2, depth / 2, steel);
  box(t, height, depth, width / 2, 0, depth / 2, steel);
  box(t, height, depth, -width / 2, 0, depth / 2, steel);
  // The duct going in: black, a little back from the face.
  box(width - t, height - t, 0.02, 0, 0, depth * 0.25, dark);
  // A lip round the face.
  box(width + 0.08, 0.04, 0.04, 0, height / 2 + 0.02, depth, steel);
  // A grate across the mouth: upright bars and two cross rails, just in
  // from the face.
  const grate = new THREE.Group();
  grate.name = 'VentGrate';
  go.object3d.add(grate);
  const bar = new THREE.CylinderGeometry(0.012, 0.012, height - t, 6);
  const rail = new THREE.BoxGeometry(width - t, 0.025, 0.02);
  resources.push(bar, rail);
  const bars = 7, z = depth - 0.03;
  for (let i = 1; i < bars; i++) {
    const mesh = new THREE.Mesh(bar, steel);
    mesh.position.set(-width / 2 + (width * i) / bars, 0, z);
    mesh.receiveShadow = true;
    grate.add(mesh);
  }
  for (const y of [-height / 4, height / 4]) {
    const mesh = new THREE.Mesh(rail, steel);
    mesh.position.set(0, y, z + 0.005);
    mesh.receiveShadow = true;
    grate.add(mesh);
  }
  go.resources = resources;
  return go;
}

/**
 * The grille inside, flat on the wall, its face at +z.
 * @returns {GameObject & { resources: Array<{ dispose(): void }> }}
 */
export function createVentGrille({ width = 0.8, height = 0.55, slats = 6, name = 'VentGrille' } = {}) {
  const go = new GameObject(name);
  const resources = [];
  const { steel, dark } = materials(resources);
  const add = (geo, mat, x, y, z) => {
    resources.push(geo);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.receiveShadow = true;
    go.object3d.add(mesh);
  };
  add(new THREE.PlaneGeometry(width, height), dark, 0, 0, 0.005);
  const f = 0.04;
  add(new THREE.BoxGeometry(width + f, f, 0.03), steel, 0, height / 2, 0.015);
  add(new THREE.BoxGeometry(width + f, f, 0.03), steel, 0, -height / 2, 0.015);
  add(new THREE.BoxGeometry(f, height, 0.03), steel, width / 2, 0, 0.015);
  add(new THREE.BoxGeometry(f, height, 0.03), steel, -width / 2, 0, 0.015);
  const slat = new THREE.BoxGeometry(width, 0.025, 0.02);
  resources.push(slat);
  for (let i = 1; i < slats; i++) {
    const mesh = new THREE.Mesh(slat, steel);
    mesh.position.set(0, -height / 2 + (height * i) / slats, 0.02);
    mesh.rotation.x = -0.5;
    go.object3d.add(mesh);
  }
  go.resources = resources;
  return go;
}

/**
 * A CCTV pole for an outdoor camera: a steel post on a base plate, capped.
 * The camera's bracket is bolted flat to the post's face at `height`, facing
 * +z: `top` is where its plate goes, in the pole's space.
 * @returns {GameObject & { resources: Array<{ dispose(): void }>, top: THREE.Vector3 }}
 */
export function createCameraPole({ height = 3.6, name = 'CameraPole' } = {}) {
  const go = new GameObject(name);
  const resources = [];
  const steel = new THREE.MeshStandardMaterial({ color: 0x4a4b48, roughness: 0.6, metalness: 0.65 });
  resources.push(steel);
  const add = (geo, x, y, z, rx = 0) => {
    resources.push(geo);
    const mesh = new THREE.Mesh(geo, steel);
    mesh.position.set(x, y, z);
    mesh.rotation.x = rx;
    mesh.castShadow = mesh.receiveShadow = true;
    go.object3d.add(mesh);
  };
  const radius = 0.06;
  const post = height + 0.2;
  add(new THREE.CylinderGeometry(radius, 0.08, post, 12), 0, post / 2, 0);
  add(new THREE.BoxGeometry(0.4, 0.04, 0.4), 0, 0.02, 0);
  add(new THREE.CylinderGeometry(radius + 0.015, radius + 0.015, 0.03, 12), 0, post + 0.015, 0);
  // A collar the bracket's plate sits on.
  add(new THREE.BoxGeometry(0.16, 0.2, 0.03), 0, height, radius + 0.005);
  go.resources = resources;
  /** Where the camera's plate goes, in the pole's space: on the collar. */
  go.top = new THREE.Vector3(0, height, radius + 0.02);
  return go;
}
