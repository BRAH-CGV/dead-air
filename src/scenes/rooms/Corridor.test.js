import { describe, it, expect, beforeEach, vi } from 'vitest';

// Same recording Rapier fake as Room.test.js — see the note there.
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

import { Corridor } from './Corridor.js';

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

const T = 0.2;
const X = { name: 'OfficeToServer', length: 4, width: 2, height: 3, wallThick: T, axis: 'x' };

function meshSize(go) {
  const p = go.object3d.children.find(c => c.isMesh).geometry.parameters;
  return [p.width, p.height, p.depth];
}

function names(corridor) {
  return corridor.root.children.map(c => c.name).sort();
}

describe('Corridor', () => {
  let engine;
  beforeEach(() => { engine = { world: new FakeWorld() }; });

  it('builds a group named Corridor:<name>', () => {
    const c = new Corridor(engine, X);
    const root = c.build();
    expect(root.name).toBe('Corridor:OfficeToServer');
    expect(root.isGroup).toBe(true);
  });

  it('open ends (default): 2 long walls + floor + ceiling, no end walls', () => {
    const c = new Corridor(engine, X);
    c.build();
    // Ends stay open so the corridor butts against a room's doorway wall
    // without two coplanar walls z-fighting.
    expect(names(c)).toEqual(['BackWall', 'Ceiling', 'CorridorLight', 'Floor', 'FrontWall']);
  });

  it('a z-axis corridor puts its long walls on the left and right', () => {
    const c = new Corridor(engine, { ...X, axis: 'z' });
    c.build();
    expect(names(c)).toEqual(['Ceiling', 'CorridorLight', 'Floor', 'LeftWall', 'RightWall']);
  });

  it('dimensions match the parameters (x axis)', () => {
    const c = new Corridor(engine, X);
    c.build();
    const back = c.root.find('BackWall');
    expect(meshSize(back)).toEqual([4, 3, T]);
    expect(back.object3d.position.z).toBeCloseTo(-1);
    expect(back.object3d.position.y).toBeCloseTo(1.5);

    // Floor and ceiling run exactly `length`, so they meet a room's floor
    // edge with no overlap in the doorway threshold.
    const floor = c.root.find('Floor');
    expect(meshSize(floor)).toEqual([4, T, 2 + T]);
    expect(floor.object3d.position.y + T / 2).toBeCloseTo(0);
    const ceiling = c.root.find('Ceiling');
    expect(meshSize(ceiling)).toEqual([4, T, 2 + T]);
    expect(ceiling.object3d.position.y).toBeCloseTo(3 + T / 2);
  });

  it('dimensions match the parameters (z axis)', () => {
    const c = new Corridor(engine, { ...X, axis: 'z', length: 6 });
    c.build();
    const left = c.root.find('LeftWall');
    expect(meshSize(left)).toEqual([T, 3, 6]);
    expect(left.object3d.position.x).toBeCloseTo(-1);
    expect(meshSize(c.root.find('Floor'))).toEqual([2 + T, T, 6]);
  });

  it('ends: "doorway" adds end walls, each cut into 3 segments', () => {
    const c = new Corridor(engine, { ...X, ends: 'doorway' });
    c.build();
    expect(names(c)).toEqual([
      'BackWall', 'Ceiling', 'CorridorLight', 'Floor', 'FrontWall',
      'LeftWall_A', 'LeftWall_B', 'LeftWall_Header',
      'RightWall_A', 'RightWall_B', 'RightWall_Header',
    ]);
  });

  it('doorway ends are centred, sized by doorWidth/doorHeight, and fit between the long walls', () => {
    const c = new Corridor(engine, { ...X, ends: 'doorway', doorWidth: 1.2, doorHeight: 2.2 });
    c.build();
    const a = c.root.find('RightWall_A');
    const b = c.root.find('RightWall_B');
    expect(a.object3d.position.x).toBeCloseTo(2);
    expect(a.object3d.position.z + meshSize(a)[2] / 2).toBeCloseTo(-0.6);
    expect(b.object3d.position.z - meshSize(b)[2] / 2).toBeCloseTo(0.6);
    // End wall spans the inside width only (width − wallThick)
    expect(a.object3d.position.z - meshSize(a)[2] / 2).toBeCloseTo(-(2 - T) / 2);
    expect(meshSize(c.root.find('RightWall_Header'))[1]).toBeCloseTo(3 - 2.2);
  });

  it('every collider is on a fixed (static) body', () => {
    const c = new Corridor(engine, { ...X, ends: 'doorway' });
    c.build();
    for (const go of c.root.children) {
      if (!go.rigidBody) continue;   // CorridorLight — a light, not a collider
      expect(go.rigidBody.isFixed(), go.name).toBe(true);
      const h = go.collider.halfExtents();
      expect([h.x * 2, h.y * 2, h.z * 2], go.name).toEqual(meshSize(go));
    }
  });

  it('bodies carry the corridor position offset', () => {
    const c = new Corridor(engine, { ...X, position: [8, 0, 0] });
    c.build();
    const t = c.root.find('BackWall').rigidBody.translation();
    expect(t.x).toBeCloseTo(8);
    expect(t.z).toBeCloseTo(-1);
  });

  it('rejects an unknown axis or ends mode', () => {
    expect(() => new Corridor(engine, { ...X, axis: 'y' })).toThrow(/axis/);
    expect(() => new Corridor(engine, { ...X, ends: 'both' })).toThrow(/ends/);
  });

  it('rejects a door wider than the corridor', () => {
    expect(() => new Corridor(engine, { ...X, ends: 'doorway', doorWidth: 2.5 }).build()).toThrow(/does not fit/);
  });

  it('bounds run exactly `length` along the axis, so ends sit flush on room walls', () => {
    const c = new Corridor(engine, { ...X, position: [8, 0, 3.5] });
    c.build();
    const { min, max } = c.bounds();
    [min.x, min.y, min.z].forEach((v, i) => expect(v).toBeCloseTo([6, -T, 3.5 - 1 - T / 2][i]));
    [max.x, max.y, max.z].forEach((v, i) => expect(v).toBeCloseTo([10, 3 + T, 3.5 + 1 + T / 2][i]));
  });

  it('has a single ceiling light so it does not read as pitch black', () => {
    const c = new Corridor(engine, X);
    c.build();
    let lights = 0;
    c.root.object3d.traverse(o => { if (o.isPointLight) lights++; });
    expect(lights).toBe(1);
    const light = c.root.find('CorridorLight').object3d.children.find(o => o.isPointLight);
    expect(light.position.y).toBeCloseTo(c.height - 0.3);
    expect(light.intensity).toBeGreaterThan(3);   // brighter than the first pass
  });

  it('has a visible fixture mesh at the light, like the room ceiling lights', () => {
    const c = new Corridor(engine, X);
    c.build();
    const group = c.root.find('CorridorLight');
    const light = group.object3d.children.find(o => o.isPointLight);
    const fixture = group.object3d.children.find(o => o.isMesh);
    expect(fixture).toBeTruthy();
    expect(fixture.position.toArray()).toEqual(light.position.toArray());
    expect(fixture.material.emissive.getHex()).not.toBe(0);
  });

  it('dispose removes its children and bodies', () => {
    const c = new Corridor(engine, { ...X, ends: 'doorway' });
    c.build();
    c.dispose();
    expect(c.root.children.length).toBe(0);
    expect(engine.world.bodies.len()).toBe(0);
  });
});
