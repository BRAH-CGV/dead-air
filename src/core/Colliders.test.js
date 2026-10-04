import { describe, it, expect } from 'vitest';
import RAPIER from '@dimforge/rapier3d';
import { mergePhysics, resolvePhysics } from './ColliderSpec.js';
import { createBody, attachColliders } from './Colliders.js';

const CUBE = { bounds: { size: [1, 1, 1], center: [0, 0.5, 0] } };
const TETRA = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);

describe('Rapier integration', () => {
  it('builds a static box body at the spawn transform', () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const resolved = resolvePhysics(mergePhysics('static'), CUBE);
    const body = createBody(world, resolved, { position: [1, 2, 3], rotationY: Math.PI / 2 });
    const cols = attachColliders(world, body, resolved, 'test');

    expect(cols).toHaveLength(1);
    expect(body.bodyType()).toBe(RAPIER.RigidBodyType.Fixed);
    expect(body.translation()).toMatchObject({ x: 1, y: 2, z: 3 });
    expect(body.rotation().y).toBeCloseTo(Math.SQRT1_2);
    // Collider translations read back in world space: the body's y=2 plus the
    // half-height offset that lifts an origin-on-floor model's box off the deck.
    expect(cols[0].translation().y).toBeCloseTo(2.5);
    world.free();
  });

  it('builds every primitive kind plus a hull', () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const shape = [
      { type: 'box', size: [1, 1, 1] },
      { type: 'sphere', radius: 0.4 },
      { type: 'capsule', height: 2, radius: 0.3 },
      { type: 'cylinder', height: 1, radius: 0.2 },
      { type: 'cone', height: 1, radius: 0.2 },
    ];
    const resolved = resolvePhysics(mergePhysics({ body: 'dynamic', shape }), CUBE);
    const body = createBody(world, resolved, {});
    expect(attachColliders(world, body, resolved, 'test')).toHaveLength(5);

    const hull = resolvePhysics(mergePhysics('static'), { ...CUBE, hulls: [TETRA] });
    const hullBody = createBody(world, hull, {});
    expect(attachColliders(world, hullBody, hull, 'test')).toHaveLength(1);
    world.free();
  });

  it('splits a requested mass across a compound shape', () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const resolved = resolvePhysics(mergePhysics({
      body: 'dynamic', mass: 10,
      shape: [{ type: 'box', size: [1, 1, 1] }, { type: 'box', size: [1, 1, 1] }],
    }), CUBE);
    const body = createBody(world, resolved, {});
    attachColliders(world, body, resolved, 'test');
    expect(body.mass()).toBeCloseTo(10);
    world.free();
  });

  it('a dynamic box falls onto a static one and rests on top of it', () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.timestep = 1 / 60;

    const ground = resolvePhysics(mergePhysics('static'), CUBE);   // top at y=1
    attachColliders(world, createBody(world, ground, { position: [0, 0, 0] }), ground, 'ground');

    const crate = resolvePhysics(mergePhysics({ body: 'dynamic', mass: 5 }), CUBE);
    const crateBody = createBody(world, crate, { position: [0, 3, 0] });
    attachColliders(world, crateBody, crate, 'crate');

    for (let i = 0; i < 180; i++) world.step();

    // Crate origin is on its floor, so resting on a 1 m box puts it at y≈1.
    expect(crateBody.translation().y).toBeCloseTo(1, 1);
    world.free();
  });

  it('debugRender returns buffers the overlay can upload', () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const resolved = resolvePhysics(mergePhysics('static'), CUBE);
    attachColliders(world, createBody(world, resolved, {}), resolved, 'test');
    world.step();

    const { vertices, colors } = world.debugRender();
    expect(vertices.length).toBeGreaterThan(0);
    expect(vertices.length / 3).toBe(colors.length / 4);
    world.free();
  });

  it('applies collision groups from the resolved spec to each collider', () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    // Shelf-like groups: member of SHELF (bit 2), filters DEFAULT (bit 0)
    const groups = { membership: ['SHELF'], filter: ['DEFAULT'] };
    const resolved = resolvePhysics(mergePhysics({ body: 'static', groups }), CUBE);
    const body = createBody(world, resolved, {});
    const cols = attachColliders(world, body, resolved, 'test');

    expect(cols).toHaveLength(1);
    // membership: SHELF (bit 2) = 0x0004, filter: DEFAULT (bit 0) = 0x0001
    // packed: (0x0004 << 16) | 0x0001 = 0x00040001
    expect(cols[0].collisionGroups()).toBe(0x00040001);
    world.free();
  });

  it('uses default groups (0xFFFFFFFF) when no groups specified', () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const resolved = resolvePhysics(mergePhysics('static'), CUBE);
    const body = createBody(world, resolved, {});
    const cols = attachColliders(world, body, resolved, 'test');

    expect(cols[0].collisionGroups()).toBe(0xFFFFFFFF);
    world.free();
  });

  it('applies per-part collision groups when specified, overriding spec-level', () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const resolved = resolvePhysics(mergePhysics({
      body: 'static',
      groups: { membership: ['SHELF'], filter: ['DEFAULT'] },
      shape: [
        { type: 'box', size: [1, 1, 1] },  // inherits spec groups
        { type: 'box', size: [1, 1, 1], groups: { membership: ['DEFAULT'], filter: ['PLAYER'] } },
      ],
    }), CUBE);
    const body = createBody(world, resolved, {});
    const cols = attachColliders(world, body, resolved, 'test');

    expect(cols).toHaveLength(2);
    // First part: spec groups (SHELF membership, DEFAULT filter)
    expect(cols[0].collisionGroups()).toBe(0x00040001);
    // Second part: per-part groups (DEFAULT membership, PLAYER filter)
    expect(cols[1].collisionGroups()).toBe(0x00010002);
    world.free();
  });
});
