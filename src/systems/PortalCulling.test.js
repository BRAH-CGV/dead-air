import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { PortalCulling, doorPortal, outsidePortal } from './PortalCulling.js';

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

// ─────────────────────────────────────────────
// What a light can see (#175): the same walk, from a light's eye in every
// direction, so a shadow map is redrawn only for what it can show. A
// window in A's west wall (x = −5) opens on the outside.
// ─────────────────────────────────────────────

function westWindow() {
  const o = new THREE.Object3D();
  o.position.set(-5, 1.5, 0);
  o.rotation.y = Math.PI / 2;
  o.updateMatrixWorld(true);
  return outsidePortal(o, [2, 1.5, 0.2], NODES);
}
const sphere = (x, y, z, r = 0.2) => new THREE.Sphere(new THREE.Vector3(x, y, z), r);
const OUT = NODES.length;

describe('outsidePortal', () => {
  it('joins a room to the outside', () => {
    const w = westWindow();
    expect(w.a).toBe(0);
    expect(w.b).toBe(OUT);
  });

  it('is null for a doorway between two rooms', () => {
    const o = new THREE.Object3D();
    o.position.set(5, 1.1, 0);
    o.rotation.y = Math.PI / 2;
    o.updateMatrixWorld(true);
    expect(outsidePortal(o, [1.2, 2.2, 0.2], NODES)).toBeNull();
  });
});

describe('PortalCulling look / sees', () => {
  const culling = () => new PortalCulling({ nodes: NODES, portals: [doorway(5), doorway(15)], outside: [westWindow()], roots: [] });

  it('a light sees all of its own room, and through the doorways only what lines up', () => {
    const c = culling();
    c.look(new THREE.Vector3(0, 2.5, 0));
    expect(c.sees(sphere(-4, 1, 4))).toBe(true);     // its own room, anywhere
    expect(c.sees(sphere(20, 1, 0))).toBe(true);     // through both doors
    expect(c.sees(sphere(22, 1, 4))).toBe(false);    // round the far door's corner
    expect(c.sees(sphere(8, 1, -4.5))).toBe(false);  // beside the near door
  });

  it('from outside (the moon), only through the window', () => {
    const c = culling();
    c.look(new THREE.Vector3(-1000, 600, 0));        // far to the west and up
    expect(c.sees(sphere(-3, 0.3, 0))).toBe(true);   // the floor just inside the window
    expect(c.sees(sphere(3, 1, 4))).toBe(false);     // the room's far corner, under the roof
    expect(c.sees(sphere(10, 1, 0))).toBe(false);    // the next room
    expect(c.sees(sphere(-30, 0, 0))).toBe(true);    // outside: outside sees outside
  });

  it('from inside, outside only through the window', () => {
    const c = culling();
    c.look(new THREE.Vector3(0, 2.5, 0));
    expect(c.sees(sphere(-8, 0.5, 0))).toBe(true);   // out of the window, down
    expect(c.sees(sphere(-8, 0.5, 9))).toBe(false);  // round the outside of the wall
  });

  it('hideUnseenCasters hides only shadow casters the light cannot see, and restore puts them back', () => {
    const roots = [new THREE.Group()];
    const add = (x, z, cast) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), new THREE.MeshBasicMaterial());
      m.position.set(x, 1, z);
      m.castShadow = cast;
      roots[0].add(m);
      return m;
    };
    const unseen = add(22, 4, true);
    const seen = add(20, 0, true);
    const noShadow = add(22, 3, false);
    roots[0].updateMatrixWorld(true);
    const c = new PortalCulling({ nodes: NODES, portals: [doorway(5), doorway(15)], outside: [westWindow()], roots });
    c.look(new THREE.Vector3(0, 1.2, 0));
    c.hideUnseenCasters();
    expect(unseen.visible).toBe(false);
    expect(seen.visible).toBe(true);
    expect(noShadow.visible).toBe(true);
    c.restore();
    expect(unseen.visible).toBe(true);
  });
});

describe('a room shell is seen from outside (#175: the moon lit through the roofs)', () => {
  // Each room's interior: inside 0.2 m walls, floor and ceiling.
  const inner = (b) => b.clone().expandByScalar(-0.2);
  const SHELLED = NODES.map(n => ({ ...n, inner: inner(n.box) }));

  it("the moon sees every room's roof, though no opening shows it", () => {
    const c = new PortalCulling({ nodes: SHELLED, portals: [], outside: [], roots: [] });
    c.look(new THREE.Vector3(10, 1000, 0));
    // B's ceiling slab: a mesh across the room at the top of the shell.
    expect(c.sees(new THREE.Sphere(new THREE.Vector3(10, 2.95, 0), 5))).toBe(true);
    // A crate wholly inside B: under the roof, unseen.
    expect(c.sees(new THREE.Sphere(new THREE.Vector3(10, 1, 0), 0.3))).toBe(false);
  });

  it('hideUnseenCasters never hides a shell mesh from a light outside', () => {
    const roots = [new THREE.Group()];
    const ceiling = new THREE.Mesh(new THREE.BoxGeometry(10, 0.2, 10), new THREE.MeshBasicMaterial());
    ceiling.position.set(10, 2.9, 0);
    ceiling.castShadow = true;
    const crate = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), new THREE.MeshBasicMaterial());
    crate.position.set(10, 1, 0);
    crate.castShadow = true;
    roots[0].add(ceiling, crate);
    roots[0].updateMatrixWorld(true);
    const c = new PortalCulling({ nodes: SHELLED, portals: [], outside: [], roots });
    c.look(new THREE.Vector3(10, 1000, 0));
    c.hideUnseenCasters();
    expect(ceiling.visible).toBe(true);
    expect(crate.visible).toBe(false);
    c.restore();
  });
});
