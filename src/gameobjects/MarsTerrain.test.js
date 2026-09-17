import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';

// Mock RAPIER to avoid the WASM load, the same way OfficeScene.test.js does —
// but capture the heightfield arguments, because the collider agreeing with
// the mesh is the thing most worth testing and the least visible by eye.
const heightfieldCalls = [];
vi.mock('@dimforge/rapier3d', () => {
  const chain = () => new Proxy({}, { get: () => chain });
  return {
    default: {
      RigidBodyDesc: { fixed: () => ({ setTranslation: chain }) },
      ColliderDesc: {
        cuboid: () => ({ setTranslation: chain }),
        heightfield: (...args) => {
          globalThis.__heightfieldCalls.push(args);
          return { setFriction: chain };
        },
      },
    },
  };
});
globalThis.__heightfieldCalls = heightfieldCalls;

import { createMarsTerrain, terrainHeightAt, TERRAIN } from './MarsTerrain.js';

const { SIZE, SEGMENTS, FLAT_RADIUS, CREST_RADIUS } = TERRAIN;
const HALF = SIZE / 2;

/** Sample a full ring of points at radius r. */
function ring(r, count = 64) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    out.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return out;
}

function mockWorld() {
  return {
    createRigidBody: vi.fn(() => ({ handle: 1 })),
    createCollider: vi.fn(() => ({ handle: 2 })),
  };
}

// ── Requirement 4: a large flat centre for the office ──
describe('terrainHeightAt — the building pad', () => {
  it('is exactly flat at y = 0 across the whole pad', () => {
    expect(terrainHeightAt(0, 0)).toBe(0);
    for (const r of [0, 5, 12.5, 25, FLAT_RADIUS - 1]) {
      for (const [x, z] of ring(r)) {
        expect(terrainHeightAt(x, z)).toBe(0);
      }
    }
  });

  it('leaves room for everything already placed outside the office', () => {
    // Crates sit at z ≈ -7.8, the satellite at z = -25. All must be on flat ground.
    expect(FLAT_RADIUS).toBeGreaterThan(30);
  });

  it('has no crease where the pad meets the slope', () => {
    // Sample across the pad edge: the first non-zero heights must be tiny, not
    // a step the player would trip over.
    for (let r = FLAT_RADIUS - 2; r < FLAT_RADIUS + 4; r += 0.5) {
      for (const [x, z] of ring(r, 16)) {
        expect(terrainHeightAt(x, z)).toBeLessThan(0.5);
      }
    }
  });
});

// ── Requirement 2: the edge of the map can never be seen ──
describe('terrainHeightAt — the valley closes', () => {
  it('climbs steadily from the pad out to the crest', () => {
    for (const [x, z] of ring(1, 16)) {
      const h = [150, 280, CREST_RADIUS].map(r => terrainHeightAt(x * r, z * r));
      expect(h[0]).toBeLessThan(h[1]);
      expect(h[1]).toBeLessThan(h[2]);
    }
  });

  it('hides the mesh boundary behind the ridge, from anywhere on the pad', () => {
    // The real requirement, and the reason the ground does NOT have to keep
    // rising: a point is invisible when something nearer subtends a greater
    // elevation angle. Checked from several eye positions, because a rule that
    // only holds at the origin is not a rule.
    const EYE_Y = 1.6;
    const eyes = [[0, 0], [30, 0], [-30, 0], [0, 30], [0, -30], [22, 22]];

    for (const [ex, ez] of eyes) {
      for (const [ux, uz] of ring(1, 48)) {
        let bestAngle = -Infinity;
        for (let t = 50; t < HALF; t += 4) {
          const x = ex + ux * t;
          const z = ez + uz * t;
          if (Math.abs(x) > HALF || Math.abs(z) > HALF) break;
          const d = Math.hypot(x - ex, z - ez);
          bestAngle = Math.max(bestAngle, (terrainHeightAt(x, z) - EYE_Y) / d);
        }
        // Where the ray leaves the mesh, on the mesh edge itself.
        const tEdge = Math.min(
          ux === 0 ? Infinity : (Math.sign(ux) * HALF - ex) / ux,
          uz === 0 ? Infinity : (Math.sign(uz) * HALF - ez) / uz,
        );
        const bx = ex + ux * tEdge;
        const bz = ez + uz * tEdge;
        const edgeAngle = (terrainHeightAt(bx, bz) - EYE_Y) / tEdge;
        expect(edgeAngle).toBeLessThan(bestAngle);
      }
    }
  });

  it('raises a crest tall enough to close the horizon', () => {
    for (const [x, z] of ring(CREST_RADIUS, 32)) {
      expect(terrainHeightAt(x, z)).toBeGreaterThan(25);
    }
  });

  it('varies the skyline instead of ringing the office with a level wall', () => {
    // A crest of constant height reads as a circular wall. Spread across the
    // horizon is what makes it read as terrain.
    const angles = ring(CREST_RADIUS, 64).map(([x, z]) => terrainHeightAt(x, z) / CREST_RADIUS);
    const spread = Math.max(...angles) - Math.min(...angles);
    expect(spread).toBeGreaterThan(Math.tan(THREE.MathUtils.degToRad(2)));
  });
});

// ── Requirement 3: the hills must not crop the sky ──
describe('terrainHeightAt — the sky stays clear', () => {
  it('never rises more than 10 degrees above the horizon from the office', () => {
    // The office window spans -13°..+14° vertically, and the sky branch hangs
    // Phobos at 12° elevation and Deimos at 16°. A rim that broke this bound
    // would eat a moon. Tuning passes must keep it.
    const LIMIT = Math.tan(THREE.MathUtils.degToRad(10));
    let worst = 0;
    for (let r = FLAT_RADIUS + 5; r <= HALF; r += 8) {
      for (const [x, z] of ring(r, 32)) {
        worst = Math.max(worst, terrainHeightAt(x, z) / r);
      }
    }
    expect(worst).toBeLessThan(LIMIT);
  });
});

// ── Mesh ──
describe('createMarsTerrain — mesh', () => {
  it('returns a group named MarsTerrain', () => {
    const go = createMarsTerrain(mockWorld());
    expect(go.name).toBe('MarsTerrain');
    // Marked a group so the level editor does not measure a 1 km bounding box
    // for it and round-trip the valley as a grey placeholder.
    expect(go.isGroup).toBe(true);
  });

  it('displaces every vertex to match the height function', () => {
    const go = createMarsTerrain(mockWorld());
    const mesh = go.object3d.getObjectByName('MarsTerrainMesh');
    expect(mesh).toBeDefined();

    const pos = mesh.geometry.getAttribute('position');
    expect(pos.count).toBe((SEGMENTS + 1) ** 2);

    for (const i of [0, 137, 4021, 33000, pos.count - 1]) {
      expect(pos.getY(i)).toBeCloseTo(terrainHeightAt(pos.getX(i), pos.getZ(i)), 5);
    }
  });

  it('receives shadows and carries vertex colours', () => {
    const go = createMarsTerrain(mockWorld());
    const mesh = go.object3d.getObjectByName('MarsTerrainMesh');
    expect(mesh.receiveShadow).toBe(true);
    expect(mesh.material.vertexColors).toBe(true);
    expect(mesh.geometry.getAttribute('color')).toBeDefined();
  });

  it('computes normals, so the hills are lit rather than flat-shaded', () => {
    const go = createMarsTerrain(mockWorld());
    const mesh = go.object3d.getObjectByName('MarsTerrainMesh');
    expect(mesh.geometry.getAttribute('normal')).toBeDefined();
  });

  it('uses a material with no specular term', () => {
    // Phobos sits 12° up, straight out the window, so the office looks toward
    // the light across a near-flat plain. At that grazing angle Fresnel climbs
    // to ~0.5 and a Standard material lays white specular over the ground —
    // 91% of its blue channel — washing the red out to grey exactly where the
    // player is looking. Lambert has no specular lobe at all.
    const mesh = createMarsTerrain(mockWorld()).object3d.getObjectByName('MarsTerrainMesh');
    expect(mesh.material.isMeshLambertMaterial).toBe(true);
    expect(mesh.material.isMeshStandardMaterial).toBeUndefined();
  });

  it('breaks the normals up so the moonlight lands in patches, not one gradient', () => {
    const mesh = createMarsTerrain(mockWorld()).object3d.getObjectByName('MarsTerrainMesh');
    const pos = mesh.geometry.getAttribute('position');
    const nrm = mesh.geometry.getAttribute('normal');

    let tilted = 0;
    for (let i = 0; i < pos.count; i += 97) {
      const x = nrm.getX(i), y = nrm.getY(i), z = nrm.getZ(i);
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 5);   // still unit length
      expect(y).toBeGreaterThan(0);                    // still faces the sky
      if (Math.abs(x) > 1e-3 || Math.abs(z) > 1e-3) tilted++;
    }
    // The flat pad would be perfectly vertical normals without the grain.
    expect(tilted).toBeGreaterThan(0);

    const flat = [];
    for (let i = 0; i < pos.count; i++) {
      if (Math.hypot(pos.getX(i), pos.getZ(i)) < 30) flat.push(i);
    }
    const tilts = flat.map(i => Math.hypot(nrm.getX(i), nrm.getZ(i)));
    expect(Math.max(...tilts)).toBeGreaterThan(0.02);  // genuinely scattered
    expect(Math.max(...tilts)).toBeLessThan(0.4);      // not boiling
  });
});

// ── Requirement 5: reads as terraformed Mars, red throughout ──
describe('createMarsTerrain — colour zones', () => {
  const luminance = c => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  /** Red chromaticity — how red a colour is regardless of how bright it is.
   *  A plain r/(g+b) ratio swings wildly between dark and light samples once
   *  the values are linear, which is what these buffers hold. */
  const redness = c => c.r / (c.r + c.g + c.b + 1e-6);

  function colourAt(mesh, x, z) {
    const pos = mesh.geometry.getAttribute('position');
    const col = mesh.geometry.getAttribute('color');
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < pos.count; i++) {
      const d = (pos.getX(i) - x) ** 2 + (pos.getZ(i) - z) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    return { r: col.getX(best), g: col.getY(best), b: col.getZ(best) };
  }

  it('reads as Mars everywhere — the basin is red too, not a green park', () => {
    const mesh = createMarsTerrain(mockWorld()).object3d.getObjectByName('MarsTerrainMesh');
    for (const [x, z] of [[0, 0], ...ring(20, 8), ...ring(90, 8)]) {
      const c = colourAt(mesh, x, z);
      expect(c.r).toBeGreaterThan(c.g);
      expect(c.r).toBeGreaterThan(c.b);
    }
  });

  it('shows the terraforming as darker ground, not as a different colour', () => {
    const mesh = createMarsTerrain(mockWorld()).object3d.getObjectByName('MarsTerrainMesh');
    const basin = colourAt(mesh, 0, 0);
    const hills = ring(400, 8).map(([x, z]) => colourAt(mesh, x, z));

    // Clearly darker, so the worked basin reads at a glance...
    for (const h of hills) {
      expect(luminance(basin)).toBeLessThan(luminance(h) * 0.8);
    }
    // ...but the same family of red, so it never reads as a separate biome.
    const spread = hills.map(h => Math.abs(redness(basin) - redness(h)));
    expect(Math.max(...spread)).toBeLessThan(0.15);
  });

  it('paints the far hills Mars red', () => {
    const mesh = createMarsTerrain(mockWorld()).object3d.getObjectByName('MarsTerrainMesh');
    for (const [x, z] of ring(400, 8)) {
      const c = colourAt(mesh, x, z);
      expect(c.r).toBeGreaterThan(c.g);
      expect(c.g).toBeGreaterThanOrEqual(c.b);
    }
  });
});

// ── Physics ──
describe('createMarsTerrain — collider', () => {
  it('builds a heightfield that matches the mesh resolution and extent', () => {
    heightfieldCalls.length = 0;
    const world = mockWorld();
    createMarsTerrain(world);

    expect(heightfieldCalls.length).toBe(1);
    const [nrows, ncols, heights, scale] = heightfieldCalls[0];
    // Rapier counts SUBDIVISIONS here and reads a (nrows+1)² matrix.
    expect(nrows).toBe(SEGMENTS);
    expect(ncols).toBe(SEGMENTS);
    expect(heights).toBeInstanceOf(Float32Array);
    expect(heights.length).toBe((SEGMENTS + 1) ** 2);
    expect(scale).toEqual({ x: SIZE, y: 1, z: SIZE });
  });

  it('stores heights the way Rapier reads them: rows are Z, columns are X', () => {
    heightfieldCalls.length = 0;
    createMarsTerrain(mockWorld());
    const [nrows, , heights] = heightfieldCalls[0];
    const points = nrows + 1;

    // Deliberately off-diagonal samples: a transposed grid is identical along
    // the diagonal, so [[0,0],[128,128]] alone would pass on mirrored terrain.
    for (const [col, row] of [[40, 200], [200, 40], [10, 250], [0, points - 1]]) {
      const x = (col / (points - 1) - 0.5) * SIZE;
      const z = (row / (points - 1) - 0.5) * SIZE;
      expect(heights[col * points + row]).toBeCloseTo(terrainHeightAt(x, z), 4);
    }
  });

  it('hands the collider refs to the GameObject so teardown can find them', () => {
    const world = mockWorld();
    const go = createMarsTerrain(world);
    expect(go.rigidBody).toBeDefined();
    expect(go.collider).toBeDefined();
    expect(go.colliders).toHaveLength(1);
  });
});

// ── Determinism ──
describe('the valley is the same every time', () => {
  it('generates identical heights on repeated builds', () => {
    for (const [x, z] of ring(300, 8)) {
      expect(terrainHeightAt(x, z)).toBe(terrainHeightAt(x, z));
    }
  });

  it('generates a different valley for a different seed', () => {
    const a = terrainHeightAt(300, 120, { seed: 1 });
    const b = terrainHeightAt(300, 120, { seed: 2 });
    expect(a).not.toBe(b);
  });
});
