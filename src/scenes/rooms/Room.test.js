import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';

// Recording fake of the Rapier API surface Room uses. The real WASM build
// doesn't load under vitest here (pre-existing, see AGENTS.md), and a
// catch-all Proxy mock can't tell us whether the colliders match the walls.
// This one keeps each desc's half-extents, body type and translation so the
// tests can assert on them.
vi.mock('@dimforge/rapier3d', () => {
  const bodyDesc = type => {
    const d = { type, t: { x: 0, y: 0, z: 0 }, setTranslation(x, y, z) { d.t = { x, y, z }; return d; } };
    return d;
  };
  return {
    default: {
      RigidBodyDesc: { fixed: () => bodyDesc('fixed') },
      ColliderDesc: {
        cuboid: (x, y, z) => {
          const d = { half: { x, y, z }, sensor: false, setSensor(s) { d.sensor = s; return d; } };
          return d;
        },
      },
    },
  };
});

import { Room } from './Room.js';

class FakeWorld {
  _bodies = new Set();
  bodies = { len: () => this._bodies.size };
  createRigidBody(desc) {
    const body = { isFixed: () => desc.type === 'fixed', translation: () => ({ ...desc.t }) };
    this._bodies.add(body);
    return body;
  }
  createCollider(desc) {
    return { halfExtents: () => ({ ...desc.half }), isSensor: () => desc.sensor };
  }
  removeRigidBody(body) { this._bodies.delete(body); }
}

function makeEngine() {
  return { world: new FakeWorld() };
}

const BASE = { name: 'Test', width: 8, depth: 6, height: 3, wallThick: 0.2 };

/** Every GameObject under the room root whose name starts with `prefix`. */
function parts(room, prefix) {
  return room.root.descendants().filter(go => go.name.startsWith(prefix));
}

/** Full box size of a GO's collider, from Rapier's half-extents. */
function colliderSize(go) {
  const h = go.collider.halfExtents();
  return [h.x * 2, h.y * 2, h.z * 2];
}

function meshSize(go) {
  const mesh = go.object3d.children.find(c => c.isMesh);
  const p = mesh.geometry.parameters;
  return [p.width, p.height, p.depth];
}

describe('Room shell', () => {
  let engine;
  beforeEach(() => { engine = makeEngine(); });

  it('build returns a group named Room:<name>', () => {
    const room = new Room(engine, BASE);
    const root = room.build();
    expect(root).toBe(room.root);
    expect(root.name).toBe('Room:Test');
    expect(root.isGroup).toBe(true);
  });

  it('buildShell creates 4 walls, a floor and a ceiling', () => {
    const room = new Room(engine, BASE);
    room.build();
    const names = room.root.children.map(c => c.name).sort();
    expect(names).toEqual(['BackWall', 'Ceiling', 'Floor', 'FrontWall', 'LeftWall', 'RightWall']);
  });

  it('walls have the dimensions from the params', () => {
    const room = new Room(engine, BASE);
    room.build();
    const { width, depth, height, wallThick } = BASE;
    // Front/back walls run the full outer width so they close the corners;
    // side walls fit between them, so nothing overlaps (no z-fighting).
    expect(meshSize(room.root.find('BackWall'))).toEqual([width + wallThick, height, wallThick]);
    expect(meshSize(room.root.find('FrontWall'))).toEqual([width + wallThick, height, wallThick]);
    expect(meshSize(room.root.find('LeftWall'))).toEqual([wallThick, height, depth - wallThick]);
    expect(meshSize(room.root.find('RightWall'))).toEqual([wallThick, height, depth - wallThick]);
    expect(room.root.find('BackWall').object3d.position.z).toBeCloseTo(-depth / 2);
    expect(room.root.find('RightWall').object3d.position.x).toBeCloseTo(width / 2);
  });

  it('floor top sits flush at y = 0 so corridors and rooms join without a step', () => {
    const room = new Room(engine, BASE);
    room.build();
    const floor = room.root.find('Floor');
    const top = floor.object3d.position.y + meshSize(floor)[1] / 2;
    expect(top).toBeCloseTo(0);
  });

  it('every surface has a fixed body with a collider matching its mesh', () => {
    const room = new Room(engine, BASE);
    room.build();
    for (const go of room.root.children) {
      expect(go.rigidBody, go.name).toBeTruthy();
      expect(go.rigidBody.isFixed(), go.name).toBe(true);
      expect(go.colliders.length, go.name).toBe(1);
      const size = colliderSize(go);
      meshSize(go).forEach((v, i) => expect(size[i], go.name).toBeCloseTo(v));
      expect(go._originalSize, go.name).toEqual(meshSize(go));
    }
  });

  it('bodies are placed in world space, offset by the room position', () => {
    const room = new Room(engine, { ...BASE, position: [14, 0, -2] });
    room.build();
    expect(room.root.object3d.position.toArray()).toEqual([14, 0, -2]);
    const back = room.root.find('BackWall');
    const t = back.rigidBody.translation();
    // Mesh is local to the room group; the body has no parent so it must
    // carry the room offset itself.
    expect(back.object3d.position.z).toBeCloseTo(-BASE.depth / 2);
    expect(t.x).toBeCloseTo(14);
    expect(t.z).toBeCloseTo(-2 - BASE.depth / 2);
  });

  it('meshes are centred on their GameObject pivot', () => {
    const room = new Room(engine, BASE);
    room.build();
    for (const go of room.root.children) {
      const mesh = go.object3d.children.find(c => c.isMesh);
      expect(mesh.position.lengthSq(), go.name).toBe(0);
    }
  });
});

describe('Room openings', () => {
  let engine;
  beforeEach(() => { engine = makeEngine(); });

  it('a doorway splits its wall into 3 segments', () => {
    const room = new Room(engine, {
      ...BASE, openings: [{ side: 'front', width: 1, height: 2.2, offset: 2 }],
    });
    room.build();
    expect(room.root.find('FrontWall')).toBeNull();
    expect(parts(room, 'FrontWall').map(g => g.name).sort())
      .toEqual(['FrontWall_A', 'FrontWall_B', 'FrontWall_Header']);
    // Other walls untouched
    expect(room.root.find('BackWall')).not.toBeNull();
  });

  it('doorway segments leave a gap of exactly the door width at the offset', () => {
    const room = new Room(engine, {
      ...BASE, openings: [{ side: 'front', width: 1, height: 2.2, offset: 2 }],
    });
    room.build();
    const a = room.root.find('FrontWall_A');
    const b = room.root.find('FrontWall_B');
    const aRight = a.object3d.position.x + meshSize(a)[0] / 2;
    const bLeft  = b.object3d.position.x - meshSize(b)[0] / 2;
    expect(aRight).toBeCloseTo(1.5);
    expect(bLeft).toBeCloseTo(2.5);
    // Segments together still span the full outer wall width
    const aLeft  = a.object3d.position.x - meshSize(a)[0] / 2;
    const bRight = b.object3d.position.x + meshSize(b)[0] / 2;
    expect(aLeft).toBeCloseTo(-(BASE.width + BASE.wallThick) / 2);
    expect(bRight).toBeCloseTo((BASE.width + BASE.wallThick) / 2);

    const header = room.root.find('FrontWall_Header');
    expect(meshSize(header)).toEqual([1, BASE.height - 2.2, BASE.wallThick]);
    expect(header.object3d.position.x).toBeCloseTo(2);
    expect(header.object3d.position.y).toBeCloseTo(2.2 + (BASE.height - 2.2) / 2);
  });

  it('a doorway on a side wall runs along z', () => {
    const room = new Room(engine, {
      ...BASE, openings: [{ side: 'right', width: 1.2, height: 2.2 }],
    });
    room.build();
    const a = room.root.find('RightWall_A');
    const b = room.root.find('RightWall_B');
    expect(a.object3d.position.x).toBeCloseTo(BASE.width / 2);
    const aEnd   = a.object3d.position.z + meshSize(a)[2] / 2;
    const bStart = b.object3d.position.z - meshSize(b)[2] / 2;
    expect(aEnd).toBeCloseTo(-0.6);
    expect(bStart).toBeCloseTo(0.6);
    expect(meshSize(a)[0]).toBe(BASE.wallThick);
  });

  it('a window (sill > 0) adds a lower segment — 4 in total', () => {
    const room = new Room(engine, {
      ...BASE, openings: [{ side: 'back', width: 4, height: 1.5, sill: 0.8 }],
    });
    room.build();
    expect(parts(room, 'BackWall').map(g => g.name).sort())
      .toEqual(['BackWall_A', 'BackWall_B', 'BackWall_Header', 'BackWall_Sill']);
    const sill = room.root.find('BackWall_Sill');
    expect(meshSize(sill)).toEqual([4, 0.8, BASE.wallThick]);
    expect(sill.object3d.position.y).toBeCloseTo(0.4);
    const header = room.root.find('BackWall_Header');
    expect(meshSize(header)[1]).toBeCloseTo(BASE.height - 2.3);
  });

  it('rejects an opening that does not fit in its wall', () => {
    expect(() => new Room(engine, {
      ...BASE, openings: [{ side: 'front', width: 3, height: 2, offset: 3.5 }],
    }).build()).toThrow(/does not fit/);
    expect(() => new Room(engine, {
      ...BASE, openings: [{ side: 'front', width: 1, height: 3.5 }],
    }).build()).toThrow(/does not fit/);
  });

  it('rejects two openings on the same wall', () => {
    expect(() => new Room(engine, {
      ...BASE,
      openings: [{ side: 'front', width: 1, height: 2 }, { side: 'front', width: 1, height: 2, offset: 2 }],
    }).build()).toThrow(/one opening per wall/);
  });

  it('rejects an unknown side', () => {
    expect(() => new Room(engine, {
      ...BASE, openings: [{ side: 'north', width: 1, height: 2 }],
    }).build()).toThrow(/side/);
  });
});

describe('Room doors', () => {
  let engine;
  beforeEach(() => { engine = makeEngine(); });

  it('addDoor places a Door GameObject in the opening on that side', () => {
    const room = new Room(engine, {
      ...BASE, openings: [{ side: 'front', width: 1, height: 2.2, offset: 2 }],
    });
    room.build();
    const door = room.addDoor('ToServerRoom', 'front', 'ServerRoom');
    expect(door.name).toBe('Door:ToServerRoom');
    expect(door.parent).toBe(room.root);
    expect(door.targetRoom).toBe('ServerRoom');
    expect(door.locked).toBe(false);
    expect(door.object3d.position.x).toBeCloseTo(2);
    expect(door.object3d.position.y).toBeCloseTo(1.1);
    expect(door.object3d.position.z).toBeCloseTo(BASE.depth / 2);
    expect(door.doorSize).toEqual([1, 2.2, BASE.wallThick]);
    expect(room.doors).toContain(door);
  });

  it('addDoor on a side wall is rotated to face along x', () => {
    const room = new Room(engine, {
      ...BASE, openings: [{ side: 'left', width: 1, height: 2.2, offset: -1 }],
    });
    room.build();
    const door = room.addDoor('ToGen', 'left', 'GeneratorBay');
    expect(door.object3d.position.x).toBeCloseTo(-BASE.width / 2);
    expect(door.object3d.position.z).toBeCloseTo(-1);
    expect(Math.abs(door.object3d.rotation.y)).toBeCloseTo(Math.PI / 2);
  });

  it('addDoor without a matching opening throws', () => {
    const room = new Room(engine, BASE);
    room.build();
    expect(() => room.addDoor('Nope', 'front', 'X')).toThrow(/no opening/);
  });

  it('a window cannot take a door', () => {
    const room = new Room(engine, {
      ...BASE, openings: [{ side: 'back', width: 2, height: 1, sill: 1 }],
    });
    room.build();
    expect(() => room.addDoor('Nope', 'back', 'X')).toThrow(/window/);
  });
});

describe('Room hooks and teardown', () => {
  let engine;
  beforeEach(() => { engine = makeEngine(); });

  it('build calls buildLighting and buildProps on subclasses', () => {
    const calls = [];
    class Sub extends Room {
      buildLighting() { calls.push('lighting'); }
      buildProps()    { calls.push('props'); }
    }
    new Sub(engine, BASE).build();
    expect(calls).toEqual(['lighting', 'props']);
  });

  it('uses the given material for every surface', () => {
    const material = new THREE.MeshStandardMaterial({ color: 0xff0000 });
    const room = new Room(engine, { ...BASE, material });
    room.build();
    for (const go of room.root.children) {
      expect(go.object3d.children[0].material).toBe(material);
    }
  });

  it('dispose removes all children and their physics bodies', () => {
    const room = new Room(engine, {
      ...BASE, openings: [{ side: 'front', width: 1, height: 2.2 }],
    });
    room.build();
    room.addDoor('D', 'front', 'Other');
    expect(engine.world.bodies.len()).toBeGreaterThan(0);

    room.dispose();
    expect(room.root.children.length).toBe(0);
    expect(engine.world.bodies.len()).toBe(0);
    expect(room.doors.length).toBe(0);
  });

  it('dispose detaches the room from its parent', () => {
    const room = new Room(engine, BASE);
    const root = room.build();
    const parent = new THREE.Object3D();
    parent.add(root.object3d);
    room.dispose();
    expect(root.object3d.parent).toBeNull();
  });

  it('dispose frees geometries it created and a default material it owns, not a passed-in one', () => {
    const material = new THREE.MeshStandardMaterial();
    let disposed = false;
    material.addEventListener('dispose', () => { disposed = true; });
    const room = new Room(engine, { ...BASE, material });
    room.build();
    const geom = room.root.find('Floor').object3d.children[0].geometry;
    let geomDisposed = false;
    geom.addEventListener('dispose', () => { geomDisposed = true; });

    room.dispose();
    expect(geomDisposed).toBe(true);
    expect(disposed).toBe(false);
  });
});
