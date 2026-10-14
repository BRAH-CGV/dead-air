import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';

vi.mock('@dimforge/rapier3d', async () => (await import('../test/fakeRapier.js')).rapierModule());

import { shellFaces, createBunkerShell, roundedRect, BUNKER } from './BunkerShell.js';
import { makeEngine } from '../test/fakeRapier.js';

// ─────────────────────────────────────────────
// BunkerShell: a sloped concrete skin round the building's outline.
// ─────────────────────────────────────────────

const H = 3;
const opts = { height: H, batter: 1.5, shoulder: 0.2, cap: { height: 0.3, overhang: 0.1, visor: 0.4 } };
/** 10 × 6, centred on the origin. */
const square = [{ x: -5, z: -3 }, { x: 5, z: -3 }, { x: 5, z: 3 }, { x: -5, z: 3 }];

const v3 = p => new THREE.Vector3(...p);
const faceNormal = poly => new THREE.Vector3()
  .subVectors(v3(poly[1]), v3(poly[0]))
  .cross(new THREE.Vector3().subVectors(v3(poly[2]), v3(poly[0])))
  .normalize();

describe('shellFaces', () => {
  it('slopes every wall of a plain outline out to the batter at the ground, the shoulder at the top', () => {
    const { slopes } = shellFaces({ outline: square, ...opts });
    expect(slopes).toHaveLength(4);
    for (const { poly, normal } of slopes) {
      const ground = poly.filter(p => p[1] === 0);
      const top    = poly.filter(p => p[1] === H);
      expect(ground).toHaveLength(2);
      expect(top).toHaveLength(2);
      // Distance out from the wall line, along the wall's outward normal.
      const out = p => (normal[0] !== 0 ? Math.abs(p[0]) - 5 : Math.abs(p[2]) - 3);
      for (const p of ground) expect(out(p)).toBeCloseTo(1.5);
      for (const p of top)    expect(out(p)).toBeCloseTo(0.2);
    }
  });

  it('faces outward and up: a slope leans back from the toe', () => {
    const { slopes } = shellFaces({ outline: square, ...opts });
    for (const { poly, normal } of slopes) {
      const n = faceNormal(poly);
      expect(n.x * normal[0] + n.z * normal[1]).toBeGreaterThan(0.5);
      expect(n.y).toBeGreaterThan(0.1);
    }
  });

  it('works whichever way round the outline is given', () => {
    const a = shellFaces({ outline: square, ...opts });
    const b = shellFaces({ outline: [...square].reverse(), ...opts });
    const outwards = ({ poly, normal }) => { const n = faceNormal(poly); return n.x * normal[0] + n.z * normal[1]; };
    for (const f of b.slopes) expect(outwards(f)).toBeGreaterThan(0.5);
    expect(b.slopes).toHaveLength(a.slopes.length);
  });

  it('mitres the corners: neighbouring slopes share their hip line', () => {
    const { slopes } = shellFaces({ outline: square, ...opts });
    const key = p => p.map(c => c.toFixed(5)).join(',');
    const count = new Map();
    for (const { poly } of slopes) for (const p of poly) count.set(key(p), (count.get(key(p)) ?? 0) + 1);
    // Each of the 8 corner points (4 at the toe, 4 at the shoulder) is in two faces.
    expect(count.size).toBe(8);
    for (const n of count.values()) expect(n).toBe(2);
  });

  it('leaves a flat edge bare (a window wall): no slope in front of it, and the slopes beside it capped', () => {
    const outline = square.map((p, i) => (i === 0 ? { ...p, flat: true } : p));   // the back, −z
    const { slopes, caps } = shellFaces({ outline, ...opts });
    expect(slopes).toHaveLength(3);
    // Nothing stands out in front of the back wall within its span.
    for (const { poly } of [...slopes, ...caps]) {
      for (const [x, , z] of poly) expect(z < -3 - 1e-6 && Math.abs(x) < 5 - 1e-6).toBe(false);
    }
    // The two side slopes end square on the back wall's plane, closed by a cap each.
    expect(caps).toHaveLength(2);
    for (const { poly } of caps) {
      for (const p of poly) expect(p[2]).toBeCloseTo(-3);
      expect(faceNormal(poly).z).toBeLessThan(-0.9);
    }
  });

  it('a concave corner meets in a valley, the two slopes sharing it', () => {
    // An L: the right half is set back, so (0, 1) is a concave corner.
    const L = [{ x: -5, z: -3 }, { x: 5, z: -3 }, { x: 5, z: 1 }, { x: 0, z: 1 }, { x: 0, z: 3 }, { x: -5, z: 3 }];
    const { slopes } = shellFaces({ outline: L, ...opts });
    const at = (p, x, z) => Math.abs(p[0] - x) < 1e-6 && Math.abs(p[2] - z) < 1e-6;
    // At the toe the valley is pulled in diagonally by the batter each way.
    const valley = slopes.flatMap(f => f.poly).filter(p => p[1] === 0 && at(p, 1.5, 2.5));
    expect(valley).toHaveLength(2);
  });

  it('gives a flat edge between two collinear slopes (the airlock) a cap at each side of the gap', () => {
    // The front (+z) split round a 2 m gap at x = 1 … 3.
    const outline = [{ x: -5, z: -3 }, { x: 5, z: -3 }, { x: 5, z: 3 }, { x: 3, z: 3, flat: true }, { x: 1, z: 3 }, { x: -5, z: 3 }];
    const { slopes, caps } = shellFaces({ outline, ...opts });
    expect(slopes).toHaveLength(5);
    expect(caps).toHaveLength(2);
    const xs = caps.map(c => c.poly[0][0]).sort();
    expect(xs[0]).toBeCloseTo(1);
    expect(xs[1]).toBeCloseTo(3);
    // Nothing in the gap.
    for (const { poly } of [...slopes, ...caps]) {
      for (const [x, , z] of poly) expect(z > 3 + 1e-6 && x > 1 + 1e-6 && x < 3 - 1e-6).toBe(false);
    }
  });

  it('caps the whole outline with a roof wider than the slopes, out over a flat edge by the visor', () => {
    const outline = square.map((p, i) => (i === 0 ? { ...p, flat: true } : p));
    const { roof } = shellFaces({ outline, ...opts });
    const xs = roof.map(p => p[0]), zs = roof.map(p => p[1]);
    expect(Math.max(...xs)).toBeCloseTo(5 + 0.2 + 0.1);
    expect(Math.max(...zs)).toBeCloseTo(3 + 0.2 + 0.1);
    expect(Math.min(...zs)).toBeCloseTo(-3 - 0.4);   // the brow over the window
  });

  it('gives each slope a solid hull: from the wall line out to the toe', () => {
    const { hulls } = shellFaces({ outline: square, ...opts });
    expect(hulls).toHaveLength(4);
    for (const points of hulls) expect(points).toHaveLength(8);
  });

  it('stands each hull sheer at the toe and well above the roof, so no jump can land on the slope', () => {
    // The character controller counts any upward-facing contact as ground, a
    // 67° slope included: jumping against a sloped collider walks up it.
    const { hulls, slopes } = shellFaces({ outline: square, ...opts });
    hulls.forEach((points, i) => {
      const [nx] = slopes[i].normal;
      const out = p => (nx !== 0 ? Math.abs(p[0]) - 5 : Math.abs(p[2]) - 3);
      const top = Math.max(...points.map(p => p[1]));
      expect(top).toBeGreaterThanOrEqual(H + BUNKER.climbGuard - 1e-9);
      // Every point is either on the wall line or out at the toe — at every height.
      for (const p of points) {
        const d = out(p);
        expect(Math.abs(d) < 1e-6 || Math.abs(d - opts.batter) < 1e-6, `${p}`).toBe(true);
      }
      // And the toe reaches from the ground to the top.
      const toe = points.filter(p => Math.abs(out(p) - opts.batter) < 1e-6);
      expect(Math.min(...toe.map(p => p[1]))).toBe(0);
      expect(Math.max(...toe.map(p => p[1]))).toBeCloseTo(top);
    });
  });
});

describe('createBunkerShell', () => {
  const build = () => {
    const engine = makeEngine();
    const outline = square.map((p, i) => (i === 0 ? { ...p, flat: true } : p));
    return { engine, shell: createBunkerShell({ engine, outline, height: H }) };
  };

  it('builds the skin, the roof and the roof-edge band as shadow-casting meshes', () => {
    const { shell } = build();
    const meshes = [];
    shell.object3d.traverse(o => { if (o.isMesh) meshes.push(o); });
    expect(meshes.length).toBeGreaterThan(0);
    for (const m of meshes) {
      expect(m.castShadow).toBe(true);
      expect(m.receiveShadow).toBe(true);
    }
    expect(shell.object3d.getObjectByName('BunkerSkin')).toBeDefined();
    expect(shell.object3d.getObjectByName('BunkerRoof')).toBeDefined();
  });

  it('takes no fog, like the rest of the building', () => {
    const { shell } = build();
    shell.object3d.traverse(o => {
      if (o.isMesh) for (const m of [].concat(o.material)) expect(m.fog).toBe(false);
    });
  });

  it('is solid: a fixed body with one hull per slope', () => {
    const { shell } = build();
    expect(shell.rigidBody).toBeTruthy();
    expect(shell.colliders).toHaveLength(3);
  });

  it('says where the roof-edge band is, for things fixed to it', () => {
    const { shell } = build();
    expect(shell.fascia.out).toBeCloseTo(BUNKER.shoulder + BUNKER.cap.overhang);
    expect(shell.fascia.y).toBeCloseTo(H + BUNKER.cap.height / 2);
    expect(shell.fascia.material).toBeInstanceOf(THREE.Material);
  });

  it('frees everything it made', () => {
    const { shell } = build();
    const freed = [], made = [...shell.resources];
    expect(made.some(r => r.isTexture)).toBe(true);
    for (const r of made) {
      const dispose = r.dispose.bind(r);
      r.dispose = () => { freed.push(r); dispose(); };
    }
    shell.disposeResources();
    expect(freed).toHaveLength(made.length);
  });
});

describe('createBunkerShell, anchoring a fence into a slope', () => {
  // A fence 2.4 m tall meets the front (+z) slope 2 m in from its right end.
  const build = () => {
    const engine = makeEngine();
    const shell = createBunkerShell({ engine, outline: square, height: H });
    const anchor = shell.addAnchor({ x: 3, z: 3, height: 2.4, width: 0.4 });
    return { shell, anchor };
  };

  it('fills the gap between the slope and a post at its toe with a concrete buttress', () => {
    const { shell, anchor } = build();
    expect(anchor.mesh.name).toBe('BunkerAnchor');
    expect(anchor.mesh.parent).toBe(shell.object3d);
    expect(anchor.mesh.material).toBe(shell.concrete);
    anchor.mesh.geometry.computeBoundingBox();
    const b = anchor.mesh.geometry.boundingBox;
    // Its face at the slope's toe, where the fence's last post stands.
    expect(anchor.toe).toBeCloseTo(3 + BUNKER.batter);
    expect(b.max.z).toBeCloseTo(anchor.toe);
    // Back to the slope at the fence's height, and that tall.
    const slopeAt = h => 3 + BUNKER.batter + (BUNKER.shoulder - BUNKER.batter) * (h / H);
    expect(b.min.z).toBeCloseTo(slopeAt(2.4), 5);
    expect(b.min.y).toBeCloseTo(0);
    expect(b.max.y).toBeCloseTo(2.4);
    expect(b.max.x - b.min.x).toBeCloseTo(0.4);
  });

  it('is solid: a hull on the shell\'s body', () => {
    const { shell, anchor } = build();
    expect(shell.colliders).toContain(anchor.collider);
    expect(anchor.collider).toBeTruthy();
  });

  it('only anchors on a slope: a point by no slope is refused', () => {
    const shell = createBunkerShell({ engine: makeEngine(), outline: square, height: H });
    expect(() => shell.addAnchor({ x: 0, z: 20, height: 2, width: 0.3 })).toThrow();
  });
});

describe('roundedRect', () => {
  const ring = roundedRect({ x0: -2, x1: 2, y0: 0, y1: 2, r: 0.5, segments: 6 });

  it('is a closed contour within its rectangle, the same number of points whatever its size', () => {
    for (const [u, v] of ring) {
      expect(u).toBeGreaterThanOrEqual(-2 - 1e-9);
      expect(u).toBeLessThanOrEqual(2 + 1e-9);
      expect(v).toBeGreaterThanOrEqual(-1e-9);
      expect(v).toBeLessThanOrEqual(2 + 1e-9);
    }
    expect(roundedRect({ x0: -5, x1: 5, y0: -1, y1: 4, r: 1, segments: 6 })).toHaveLength(ring.length);
  });

  it('cuts the corners round: nothing within r of a corner but the arc', () => {
    const corner = Math.min(...ring.map(([u, v]) => Math.hypot(u - 2, v - 2)));
    expect(corner).toBeCloseTo(Math.SQRT2 * 0.5 - 0.5, 5);
  });

  it('runs counter-clockwise', () => {
    let a = 0;
    ring.forEach(([x0, y0], i) => { const [x1, y1] = ring[(i + 1) % ring.length]; a += x0 * y1 - x1 * y0; });
    expect(a).toBeGreaterThan(0);
  });
});

describe('createBunkerShell, with a window in a flat edge', () => {
  // The back (−z) edge is bare, with a 6 × 2 m window in it, 0.5 m up.
  const outline = square.map((p, i) => (i === 0 ? { ...p, flat: true } : p));
  const opening = { edge: 0, at: 5, sill: 0.5, width: 6, height: 2 };

  it('frames it in a flared, rounded concrete embrasure and a steel collar', () => {
    const shell = createBunkerShell({ engine: makeEngine(), outline, height: H, embrasures: [opening] });
    const concrete = shell.object3d.getObjectByName('BunkerEmbrasure');
    const steel = shell.object3d.getObjectByName('BunkerEmbrasureSteel');
    expect(concrete).toBeDefined();
    expect(steel).toBeDefined();
    concrete.geometry.computeBoundingBox();
    const b = concrete.geometry.boundingBox;
    // Out from the wall face, wider than the opening, no further out than the brow.
    expect(b.min.z).toBeGreaterThanOrEqual(-3 - BUNKER.cap.visor - 1e-6);
    expect(b.max.z).toBeLessThanOrEqual(-3 + 1e-6);
    expect(b.max.x - b.min.x).toBeGreaterThan(6.5);
    expect(b.min.y).toBeGreaterThan(0);
  });

  it('leaves the opening itself clear: straight through its middle meets nothing', () => {
    const shell = createBunkerShell({ engine: makeEngine(), outline, height: H, embrasures: [opening] });
    const meshes = [];
    shell.object3d.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.side = THREE.DoubleSide; meshes.push(o); } });
    shell.object3d.updateMatrixWorld(true);
    const ray = new THREE.Raycaster();
    for (const x of [-2.5, 0, 2.5]) {
      for (const y of [0.7, 1.5, 2.3]) {
        ray.set(new THREE.Vector3(x, y, -2.9), new THREE.Vector3(0, 0, -1));
        expect(ray.intersectObjects(meshes), `${x}, ${y}`).toHaveLength(0);
      }
    }
  });
});
