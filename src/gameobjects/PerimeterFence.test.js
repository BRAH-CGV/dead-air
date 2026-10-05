import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';

// Fake Rapier: the fence only builds colliders, it never steps a world, and the
// real WASM module will not load under every test runner.
vi.mock('@dimforge/rapier3d', async () => (await import('../test/fakeRapier.js')).rapierModule());

import { createPerimeterFence, perimeterRect, yardRect, fenceKeepOut, FENCE } from './PerimeterFence.js';
import { FakeWorld } from '../test/fakeRapier.js';
import { BASE_FOOTPRINT, YARD } from './BaseYard.js';

/** A stand-in for the chain-link panel, at the proportions the manifest's
 *  scale correction gives the real one: about 3.45 m wide and 2.4 m tall. */
const PANEL_WIDTH = 3.448;
function mockAssets() {
  const group = new THREE.Group();
  group.add(new THREE.Mesh(
    new THREE.BoxGeometry(PANEL_WIDTH, 2.4, 0.12),
    new THREE.MeshStandardMaterial(),
  ));
  group.updateMatrixWorld(true);
  return { get: vi.fn(() => ({ scene: group })), getCollision: vi.fn(() => null) };
}

/** Every panel instance, as a world position plus the axis it runs along. */
function panels(fence) {
  const out = [];
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();

  for (const mesh of fence.object3d.children) {
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, matrix);
      matrix.decompose(position, quaternion, scale);
      out.push({ position: position.clone(), scale: scale.clone() });
    }
  }
  return out;
}

const LANES = [
  { bearing: Math.atan2(-25, 0), halfWidth: 3.7 },
  { bearing: 0.8, halfWidth: 4.4 },
  { bearing: 2.4, halfWidth: 4.2 },
  { bearing: -2.2, halfWidth: 4.5 },
];

describe('the perimeter', () => {
  it('encloses the building and the parking apron both', () => {
    const rect = perimeterRect();
    const { halfX, halfZ } = BASE_FOOTPRINT;
    const parking = YARD.parking;

    // Clear of every wall of the base.
    expect(rect.minX).toBeLessThan(-halfX);
    expect(rect.maxX).toBeGreaterThan(halfX);
    expect(rect.minZ).toBeLessThan(-halfZ);
    // And out past the parking, which is what reaches furthest forward.
    expect(rect.maxZ).toBeGreaterThan(parking.z + parking.halfZ);
    expect(rect.minX).toBeLessThan(parking.x - parking.halfX);
    expect(rect.maxX).toBeGreaterThan(parking.x + parking.halfX);
  });

  it('leaves a walkway rather than running against the walls', () => {
    const rect = perimeterRect();
    expect(-rect.minX - BASE_FOOTPRINT.halfX).toBeCloseTo(FENCE.buffer);
    expect(rect.maxX - BASE_FOOTPRINT.halfX).toBeCloseTo(FENCE.buffer);
  });

  it('is a group, so the editor never lists every panel', () => {
    expect(createPerimeterFence().isGroup).toBe(true);
  });

  it('works with no model loaded, and still says where the gates are', () => {
    const fence = createPerimeterFence({ lanes: LANES });
    expect(fence.gates.length).toBe(LANES.length);
    expect(fence.object3d.children.length).toBe(0);
  });
});

describe('the gates', () => {
  it('opens once for every lane, wherever that lane happens to cross', () => {
    const fence = createPerimeterFence({ lanes: LANES, assets: mockAssets() });
    expect(fence.gates.length).toBe(LANES.length);
    for (const gate of fence.gates) {
      expect(['N', 'S', 'E', 'W']).toContain(gate.side);
    }
  });

  it('puts the dish gate dead centre of the back wall', () => {
    // The dish sits straight out the window at (0, -25), so its lane leaves
    // through the middle of the back run. If this drifts, the road out to the
    // dish stops lining up with the way through the wire.
    const fence = createPerimeterFence({ lanes: [{ bearing: Math.atan2(-25, 0), halfWidth: 3.7 }] });
    expect(fence.gates.length).toBe(1);
    expect(fence.gates[0].side).toBe('S');
    expect(fence.gates[0].at).toBeCloseTo(0, 6);
  });

  it('is always wide enough to drive through, however narrow the lane', () => {
    const fence = createPerimeterFence({ lanes: [{ bearing: 1.1, halfWidth: 0.2 }] });
    expect(fence.gates[0].halfWidth).toBeCloseTo(FENCE.minGateWidth / 2);
  });

  it('never stands a panel in a gateway', () => {
    // The invariant the whole thing rests on. Two lanes can surface within
    // centimetres of each other on the same side, which used to leave a run
    // far too short for a panel — and the tiler filled it anyway, poking a
    // squeezed panel out into both gates.
    const fence = createPerimeterFence({ lanes: LANES, assets: mockAssets() });

    for (const { position, scale } of panels(fence)) {
      const halfWidth = (PANEL_WIDTH * scale.x) / 2;

      for (const gate of fence.gates) {
        const onThisSide =
          (gate.side === 'S' && Math.abs(position.z - fence.rect.minZ) < 0.01) ||
          (gate.side === 'N' && Math.abs(position.z - fence.rect.maxZ) < 0.01) ||
          (gate.side === 'W' && Math.abs(position.x - fence.rect.minX) < 0.01) ||
          (gate.side === 'E' && Math.abs(position.x - fence.rect.maxX) < 0.01);
        if (!onThisSide) continue;

        const along = gate.side === 'N' || gate.side === 'S' ? position.x : position.z;
        const clearance = Math.abs(along - gate.at) - halfWidth;
        expect(clearance, `panel at ${along.toFixed(2)} vs gate ${gate.side}@${gate.at.toFixed(2)}`)
          .toBeGreaterThanOrEqual(gate.halfWidth - 1e-6);
      }
    }
  });
});

describe('materials', () => {
  it('never uses the material the download shipped with', () => {
    // The loaded material leans entirely on an extension three's GLTFLoader
    // does not implement, and renders as a flat white blended card with no
    // texture at all — see the header for the full story. This is the
    // regression guard: whatever the model ships, the fence must never draw
    // with it directly.
    const brokenMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const group = new THREE.Group();
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.4, 0.1), brokenMaterial);
    post.name = 'pCube1_phong5_0';
    const fabric = new THREE.Mesh(new THREE.PlaneGeometry(PANEL_WIDTH, 2.4), brokenMaterial);
    fabric.name = 'pPlane1_phong6_0';
    group.add(post, fabric);
    group.updateMatrixWorld(true);

    const assets = { get: vi.fn(() => ({ scene: group })), getCollision: vi.fn(() => null) };
    const fence = createPerimeterFence({ lanes: [], assets });

    for (const mesh of fence.object3d.children) {
      expect(mesh.material).not.toBe(brokenMaterial);
    }
  });

  it('gives the wire mesh an actual gap to see through', () => {
    // The bug this replaces was an opaque white card. A material that is not
    // transparent at all would just be a different-coloured version of the
    // same problem.
    const group = new THREE.Group();
    const fabric = new THREE.Mesh(
      new THREE.PlaneGeometry(PANEL_WIDTH, 2.4),
      new THREE.MeshStandardMaterial(),
    );
    fabric.name = 'pPlane1_phong6_0';
    group.add(fabric);
    group.updateMatrixWorld(true);

    const assets = { get: vi.fn(() => ({ scene: group })), getCollision: vi.fn(() => null) };
    const fence = createPerimeterFence({ lanes: [], assets });

    const fabricMesh = fence.object3d.children[0];
    expect(fabricMesh.material.transparent).toBe(true);
    expect(fabricMesh.material.alphaMap ?? fabricMesh.material.map).toBeTruthy();
  });

  it('leaves its gaps out of the depth buffer, so what is behind the fence still draws', () => {
    // A blended material writes depth for every pixel of the panel, gaps
    // included. Anything see-through drawn after it and behind it — the wind
    // dust — was then cut out in the shape of the whole fence. alphaTest
    // throws the gap pixels away before they can write depth.
    const group = new THREE.Group();
    const fabric = new THREE.Mesh(
      new THREE.PlaneGeometry(PANEL_WIDTH, 2.4),
      new THREE.MeshStandardMaterial(),
    );
    fabric.name = 'pPlane1_phong6_0';
    group.add(fabric);
    group.updateMatrixWorld(true);

    const assets = { get: vi.fn(() => ({ scene: group })), getCollision: vi.fn(() => null) };
    const { material } = createPerimeterFence({ lanes: [], assets }).object3d.children[0];

    expect(material.alphaTest).toBeGreaterThan(0);
    // …but the wire itself is kept. Its alpha is the lattice texel's alpha
    // (map) times its green (alphaMap), both read off the texture.
    const { data } = material.map.image;
    let wire = 0;
    for (let i = 0; i < data.length; i += 4) wire = Math.max(wire, (data[i + 3] / 255) * (data[i + 1] / 255));
    expect(wire).toBeGreaterThan(0);
    expect(material.alphaTest).toBeLessThan(wire);
  });
});

describe('gateOffset', () => {
  it('slides a gate along its side without moving where the lane crosses', () => {
    // The dish clearing is wide, but the road through it runs to one side —
    // this is what lets the wire stay closed in front of the dish itself and
    // open only where something actually drives through.
    const centred = { bearing: Math.atan2(-25, 0), halfWidth: 3.7 };
    const shifted = { ...centred, gateOffset: -4 };

    const plain = createPerimeterFence({ lanes: [centred] });
    const offset = createPerimeterFence({ lanes: [shifted] });

    expect(offset.gates[0].side).toBe(plain.gates[0].side);
    expect(offset.gates[0].at).toBeCloseTo(plain.gates[0].at - 4);
  });

  it('still keeps every panel clear of the shifted gate', () => {
    const lane = { bearing: Math.atan2(-25, 0), halfWidth: 3.7, gateOffset: -4 };
    const fence = createPerimeterFence({ lanes: [lane], assets: mockAssets() });
    const gate = fence.gates[0];

    for (const { position, scale } of panels(fence)) {
      if (Math.abs(position.z - fence.rect.minZ) > 0.01) continue;
      const halfWidth = (PANEL_WIDTH * scale.x) / 2;
      expect(Math.abs(position.x - gate.at) - halfWidth).toBeGreaterThanOrEqual(gate.halfWidth - 1e-6);
    }
  });
});

describe('the runs', () => {
  it('tiles without stretching a panel out of shape', () => {
    const fence = createPerimeterFence({ lanes: LANES, assets: mockAssets() });
    const all = panels(fence);
    expect(all.length).toBeGreaterThan(10);

    for (const { scale } of all) {
      expect(scale.x).toBeGreaterThanOrEqual(1 - FENCE.maxPanelStretch - 1e-6);
      expect(scale.x).toBeLessThanOrEqual(1 + FENCE.maxPanelStretch + 1e-6);
      // Thickness and height are never touched — only the tiling axis is.
      expect(scale.y).toBeCloseTo(1);
      expect(scale.z).toBeCloseTo(1);
    }
  });

  it('stands every panel on one of the four runs', () => {
    const fence = createPerimeterFence({ lanes: LANES, assets: mockAssets() });
    const { rect } = fence;

    for (const { position } of panels(fence)) {
      const onSide =
        Math.abs(position.z - rect.minZ) < 0.01 || Math.abs(position.z - rect.maxZ) < 0.01 ||
        Math.abs(position.x - rect.minX) < 0.01 || Math.abs(position.x - rect.maxX) < 0.01;
      expect(onSide, `${position.x.toFixed(1)}, ${position.z.toFixed(1)}`).toBe(true);
    }
  });
});

describe('the yard block — a fence that keeps the player on the airlock side', () => {
  const { halfX, halfZ } = BASE_FOOTPRINT;

  it('spans the building end to end, just outside its end walls', () => {
    const rect = yardRect();
    expect(rect.minX).toBeLessThan(-halfX);
    expect(rect.maxX).toBeGreaterThan(halfX);
    expect(rect.minX).toBeGreaterThan(-halfX - 0.5);     // flush: no gap to squeeze round
    expect(rect.maxX).toBeLessThan(halfX + 0.5);
  });

  it('tucks its back edge into the building, so the side runs meet the end walls', () => {
    const rect = yardRect();
    expect(rect.minZ).toBeLessThan(halfZ);
    expect(rect.minZ).toBeGreaterThan(0);                // into the front half, not round the back
  });

  it('still takes in the whole parking apron, generator and buggy included', () => {
    const rect = yardRect();
    const p = YARD.parking;
    expect(rect.maxZ).toBeGreaterThan(p.z + p.halfZ);
    expect(rect.minX).toBeLessThan(p.x - p.halfX);
    expect(rect.maxX).toBeGreaterThan(p.x + p.halfX);
    for (const [x, z] of [[7, 9], [-7.79, 10.01]]) {     // generator, buggy
      expect(x).toBeGreaterThan(rect.minX);
      expect(x).toBeLessThan(rect.maxX);
      expect(z).toBeLessThan(rect.maxZ);
    }
  });

  it('leaves the building side open — the wall is the fence there', () => {
    const rect = yardRect();
    const fence = createPerimeterFence({ rect, openSides: ['S'], assets: mockAssets() });
    expect(fence.rect).toEqual(rect);
    for (const { position } of panels(fence)) {
      expect(Math.abs(position.z - rect.minZ), `${position.x.toFixed(1)}, ${position.z.toFixed(1)}`).toBeGreaterThan(0.01);
    }
  });

  it('with no lanes it is closed all round — no gate to walk out of', () => {
    const rect = yardRect();
    const world = new FakeWorld();
    const fence = createPerimeterFence({ rect, openSides: ['S'], world });
    expect(fence.gates).toEqual([]);
    expect(fence.colliders).toHaveLength(3);             // N, W, E — one unbroken run each

    const total = fence.colliders.reduce((sum, c) => {
      const h = c.halfExtents();
      return sum + 2 * Math.max(h.x, h.z);
    }, 0);
    const perimeter = (rect.maxX - rect.minX) + 2 * (rect.maxZ - rect.minZ);
    expect(total).toBeCloseTo(perimeter);
  });

  it('the default is still the full perimeter, every side fenced', () => {
    const fence = createPerimeterFence({ world: new FakeWorld() });
    expect(fence.rect).toEqual(perimeterRect());
    expect(fence.colliders).toHaveLength(4);
  });
});

describe('fenceKeepOut — the bands either side of each run, for scenery to stay out of', () => {
  it('one box per fenced side, reaching `clearance` either side of the wire and past its ends', () => {
    const rect = yardRect();
    const boxes = fenceKeepOut(rect, { openSides: ['S'], clearance: 3 });
    expect(boxes).toHaveLength(3);
    const [n, w, e] = boxes;
    expect(n).toEqual({ minX: rect.minX - 3, maxX: rect.maxX + 3, minZ: rect.maxZ - 3, maxZ: rect.maxZ + 3 });
    expect(w).toEqual({ minX: rect.minX - 3, maxX: rect.minX + 3, minZ: rect.minZ - 3, maxZ: rect.maxZ + 3 });
    expect(e).toEqual({ minX: rect.maxX - 3, maxX: rect.maxX + 3, minZ: rect.minZ - 3, maxZ: rect.maxZ + 3 });
  });
});
