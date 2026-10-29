import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { PortalCulling, doorPortal } from './PortalCulling.js';

// ─────────────────────────────────────────────
// Three rooms in a row along x, 10 m each, joined by 1.2 × 2.2 m doorways
// at z = 0 in the walls at x = 5 and x = 15 — the base's quarters, office
// and server room, in miniature.
//
//     A (−5…5)  |door x=5|  B (5…15)  |door x=15|  C (15…25)
// ─────────────────────────────────────────────

const box = (x0, x1) => new THREE.Box3(new THREE.Vector3(x0, 0, -5), new THREE.Vector3(x1, 3, 5));
const NODES = [{ name: 'A', box: box(-5, 5) }, { name: 'B', box: box(5, 15) }, { name: 'C', box: box(15, 25) }];

/** A doorway in a wall across x, its centre at (x, 1.1, z). */
function doorway(x, z = 0) {
  const o = new THREE.Object3D();
  o.position.set(x, 1.1, z);
  o.rotation.y = Math.PI / 2;
  o.updateMatrixWorld(true);
  return doorPortal(o, [1.2, 2.2, 0.2], NODES);
}

function world() {
  const roots = [];
  const at = (name, x, z, y = 1) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), new THREE.MeshBasicMaterial());
    mesh.name = name;
    mesh.position.set(x, y, z);
    const root = new THREE.Group();
    root.add(mesh);
    roots.push(root);
    root.updateMatrixWorld(true);
    return mesh;
  };
  return { roots, at };
}

function camera(position, target) {
  const cam = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 500);
  cam.position.set(...position);
  cam.lookAt(...target);
  cam.updateMatrixWorld(true);
  return cam;
}

function culling(roots, portals = [doorway(5), doorway(15)]) {
  return new PortalCulling({ nodes: NODES, portals, roots });
}

describe('doorPortal', () => {
  it('joins the two rooms either side of a doorway, its corners the opening', () => {
    const portal = doorway(5);
    expect([portal.a, portal.b].sort()).toEqual([0, 1]);
    const xs = portal.corners.map(c => c.x);
    const ys = portal.corners.map(c => c.y).sort((p, q) => p - q);
    const zs = portal.corners.map(c => c.z).sort((p, q) => p - q);
    expect(xs.every(x => Math.abs(x - 5) < 1e-6)).toBe(true);
    expect(ys[0]).toBeCloseTo(0 - 0.05);
    expect(ys[3]).toBeCloseTo(2.2 + 0.05);
    expect(zs[0]).toBeCloseTo(-0.65);
    expect(zs[3]).toBeCloseTo(0.65);
  });

  it('is null for a doorway with a room on one side only (the hatch to the yard)', () => {
    expect(doorway(-5)).toBeNull();
  });
});

describe('PortalCulling', () => {
  it('hides what is in another room and out of sight through every doorway', () => {
    const { roots, at } = world();
    const inLine = at('inLine', 20, 0);          // C, straight through both doorways
    const offLine = at('offLine', 22, 4);        // C, round the corner of the far doorway
    const nextRoom = at('nextRoom', 10, 1);      // B, seen through the near doorway
    const behindWall = at('behindWall', 8, -4.5); // B, tucked beside the near doorway
    const here = at('here', 0, 4);               // A, the camera's own room: three's own culling
    const cull = culling(roots);

    cull.hide(camera([0, 1.2, 0], [10, 1.2, 0]));
    expect(inLine.visible).toBe(true);
    expect(nextRoom.visible).toBe(true);
    expect(here.visible).toBe(true);
    expect(offLine.visible).toBe(false);
    expect(behindWall.visible).toBe(false);
  });

  it('hides a whole room the camera looks away from', () => {
    const { roots, at } = world();
    const inB = at('inB', 10, 0);
    const cull = culling(roots);
    cull.hide(camera([0, 1.2, 0], [-10, 1.2, 0]));
    expect(inB.visible).toBe(false);
  });

  it('restore puts back exactly what it hid, and nothing else', () => {
    const { roots, at } = world();
    const shown = at('shown', 22, 4);
    const alreadyHidden = at('alreadyHidden', 22, 3);
    alreadyHidden.visible = false;
    const cull = culling(roots);
    cull.hide(camera([0, 1.2, 0], [10, 1.2, 0]));
    expect(shown.visible).toBe(false);
    cull.restore();
    expect(shown.visible).toBe(true);
    expect(alreadyHidden.visible).toBe(false);
    cull.restore();   // twice is harmless
    expect(shown.visible).toBe(true);
  });

  it('goes by where a thing is, not which room it hangs under (a carried drive)', () => {
    const { roots, at } = world();
    const carried = at('carried', 1, 0);   // hangs under the same kind of root, but stands in A
    const cull = culling(roots);
    cull.hide(camera([0, 1.2, -1], [0, 1.2, 4]));
    expect(carried.visible).toBe(true);
  });

  it('hides nothing while the camera is in no room (the yard)', () => {
    const { roots, at } = world();
    const inC = at('inC', 22, 4);
    const cull = culling(roots);
    cull.hide(camera([0, 1.2, 30], [0, 1.2, 0]));
    expect(inC.visible).toBe(true);
  });

  it('standing in a doorway, sees the whole of the next room', () => {
    const { roots, at } = world();
    const corner = at('corner', 13, -4.5);
    const cull = culling(roots);
    cull.hide(camera([5, 1.2, 0], [13, 1.2, -4.5]));
    expect(corner.visible).toBe(true);
  });

  it('never hides what three would never cull, nor anything while switched off', () => {
    const { roots, at } = world();
    const unculled = at('unculled', 22, 4);
    unculled.frustumCulled = false;
    const other = at('other', 22, 3);
    const cull = culling(roots);
    cull.enabled = false;
    cull.hide(camera([0, 1.2, 0], [10, 1.2, 0]));
    expect(other.visible).toBe(true);
    cull.enabled = true;
    cull.hide(camera([0, 1.2, 0], [10, 1.2, 0]));
    expect(unculled.visible).toBe(true);
    expect(other.visible).toBe(false);
  });

  it('never hides a light, and counts what it hid', () => {
    const { roots, at } = world();
    at('a', 22, 4);
    const lamp = new THREE.PointLight();
    lamp.position.set(22, 2, 4);
    roots[0].add(lamp);
    roots[0].updateMatrixWorld(true);
    const cull = culling(roots);
    cull.hide(camera([0, 1.2, 0], [10, 1.2, 0]));
    expect(lamp.visible).toBe(true);
    expect(cull.hiddenCount).toBe(1);
  });
});
