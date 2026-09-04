import { describe, it, expect } from 'vitest';
import { mergePhysics, resolvePhysics, resolveShape } from './ColliderSpec.js';

// A 1 m cube authored the way our convention asks: origin on the floor, so the
// bounds are centred at half height, not at the origin. Getting that offset
// wrong is the classic collider bug — the box ends up half-buried in the floor.
const CUBE = { bounds: { size: [1, 1, 1], center: [0, 0.5, 0] } };

/** Four corners of a tetrahedron — the minimum a convex hull accepts. */
const TETRA = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);

const spec = (over) => mergePhysics(undefined, over);

describe('mergePhysics', () => {
  it('expands the bare-string shorthand', () => {
    expect(mergePhysics('dynamic').body).toBe('dynamic');
  });

  // The opt-in contract. If this ever regresses, every decorative model in the
  // manifest silently grows an invisible wall the level designer never asked for.
  it('returns null when nobody asked for physics', () => {
    expect(mergePhysics()).toBeNull();
    expect(mergePhysics(undefined, undefined)).toBeNull();
  });

  it('defaults to a static auto shape once someone HAS asked', () => {
    expect(mergePhysics({})).toMatchObject({ body: 'static', shape: 'auto' });
    expect(mergePhysics(undefined, 'dynamic')).toMatchObject({ shape: 'auto' });
  });

  it('lets a spawn-time override win over the manifest', () => {
    const merged = mergePhysics({ body: 'static', friction: 0.2 }, { body: 'dynamic' });
    expect(merged.body).toBe('dynamic');
    expect(merged.friction).toBe(0.2);   // untouched keys survive
  });
});

describe('auto bounding box', () => {
  it('halves the measured size and sits at the measured centre', () => {
    const [box] = resolveShape('box', CUBE);
    expect(box.kind).toBe('cuboid');
    expect(box.halfExtents).toEqual([0.5, 0.5, 0.5]);
    expect(box.position).toEqual([0, 0.5, 0]);
  });

  it('scales both extents and the offset at spawn time', () => {
    const [box] = resolveShape('box', CUBE, 2);
    expect(box.halfExtents).toEqual([1, 1, 1]);
    expect(box.position).toEqual([0, 1, 0]);
  });

  it('gives a flat model enough thickness for Rapier to cope', () => {
    const poster = { bounds: { size: [1, 0, 1], center: [0, 1, 0] } };
    expect(resolveShape('box', poster)[0].halfExtents[1]).toBeGreaterThan(0);
  });
});

describe("shape: 'auto'", () => {
  it('prefers collider meshes shipped inside the .glb', () => {
    const parts = resolveShape('auto', { ...CUBE, hulls: [TETRA] });
    expect(parts).toHaveLength(1);
    expect(parts[0].kind).toBe('hull');
  });

  it('falls back to the bounding box when the .glb shipped none', () => {
    expect(resolveShape('auto', CUBE)[0].kind).toBe('cuboid');
  });

  it('drops a degenerate hull rather than handing Rapier junk', () => {
    expect(resolveShape('hull', { hulls: [new Float32Array([0, 0, 0])] })).toEqual([]);
  });

  it('only copies hull points when the spawn is actually scaled', () => {
    expect(resolveShape('hull', { hulls: [TETRA] })[0].points).toBe(TETRA);
    expect(resolveShape('hull', { hulls: [TETRA] }, 2)[0].points[3]).toBe(2);
  });
});

describe('hand-written primitives', () => {
  it('treats box size as full metres, not half-extents', () => {
    const [box] = resolveShape([{ type: 'box', size: [1.6, 0.08, 0.8], position: [0, 0.72, 0] }]);
    expect(box.halfExtents).toEqual([0.8, 0.04, 0.4]);
    expect(box.position).toEqual([0, 0.72, 0]);
  });

  it('converts a capsule\'s tip-to-tip height to Rapier\'s middle segment', () => {
    // 2 m tall with 0.3 m caps leaves 1.4 m of cylinder → halfHeight 0.7
    const [cap] = resolveShape([{ type: 'capsule', height: 2, radius: 0.3 }]);
    expect(cap.halfHeight).toBeCloseTo(0.7);
    expect(cap.radius).toBe(0.3);
  });

  it('keeps a capsule valid when the caps would swallow the height', () => {
    const [cap] = resolveShape([{ type: 'capsule', height: 0.4, radius: 0.5 }]);
    expect(cap.halfHeight).toBeGreaterThan(0);
  });

  it('halves cylinder and cone heights without subtracting caps', () => {
    const [cyl] = resolveShape([{ type: 'cylinder', height: 0.9, radius: 0.15 }]);
    expect(cyl.halfHeight).toBeCloseTo(0.45);
  });

  it('builds one collider per part of a compound shape', () => {
    const parts = resolveShape([
      { type: 'box', size: [1.6, 0.08, 0.8], position: [0, 0.72, 0] },
      { type: 'cylinder', radius: 0.15, height: 0.9 },
    ]);
    expect(parts.map(p => p.kind)).toEqual(['cuboid', 'cylinder']);
  });

  it('turns an Euler rotation into a quaternion', () => {
    const [box] = resolveShape([{ type: 'box', size: [1, 1, 1], rotation: [0, Math.PI / 2, 0] }]);
    expect(box.rotation[1]).toBeCloseTo(Math.SQRT1_2);
    expect(box.rotation[3]).toBeCloseTo(Math.SQRT1_2);
  });
});

describe('resolvePhysics', () => {
  it('opts out on body:none and shape:none', () => {
    expect(resolvePhysics(spec({ body: 'none' }), CUBE)).toBeNull();
    expect(resolvePhysics(spec({ shape: 'none' }), CUBE)).toBeNull();
  });

  it('opts out when there is no geometry to fit', () => {
    expect(resolvePhysics(spec({}), {})).toBeNull();
  });

  it('defaults dynamic bodies to the density of water', () => {
    const resolved = resolvePhysics(spec({ body: 'dynamic' }), CUBE);
    expect(resolved.density).toBe(1000);
    expect(resolved.mass).toBeUndefined();
  });

  it('lets an explicit mass override density entirely', () => {
    const resolved = resolvePhysics(spec({ body: 'dynamic', mass: 12, density: 400 }), CUBE);
    expect(resolved.mass).toBe(12);
    expect(resolved.density).toBeUndefined();
  });

  it('carries the material settings through', () => {
    const resolved = resolvePhysics(spec({ friction: 0.1, restitution: 0.9, sensor: true }), CUBE);
    expect(resolved).toMatchObject({ friction: 0.1, restitution: 0.9, sensor: true });
  });
});
