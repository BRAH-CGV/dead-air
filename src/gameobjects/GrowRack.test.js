import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { populateGrowRack, GROW_RACK, UV_LIGHT } from './GrowRack.js';

/** A cached-model stand-in: a Group holding one mesh with its own material,
 *  sized like the real thing (fixture 0.12 × 0.068 × 0.8 m, plant 0.18 × 0.35 m). */
function fakeAssets() {
  const model = (name, size, material) => {
    const root = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size).translate(0, size[1] / 2, 0), material);
    mesh.name = name;
    root.add(mesh);
    return root;
  };
  const fixtureMaterial = new THREE.MeshStandardMaterial({ color: 0x888888, emissive: 0xffffff, emissiveIntensity: 2.3 });
  const plantMaterial = new THREE.MeshStandardMaterial({ color: 0x44aa44 });
  const models = {
    'model:light-ceiling': model('fixture', [0.12, 0.068, 0.8], fixtureMaterial),
    'model:grow-plant': model('plant', [0.18, 0.35, 0.19], plantMaterial),
  };
  return { get: key => models[key], fixtureMaterial, plantMaterial };
}

function build(assets = fakeAssets()) {
  const target = new THREE.Group();
  const owned = [];
  const result = populateGrowRack(target, { assets, own: r => (owned.push(r), r) });
  return { target, owned, assets, ...result };
}

const meshes = root => {
  const out = [];
  root.traverse(o => { if (o.isMesh) out.push(o); });
  return out;
};

describe('GrowRack', () => {
  it('builds two tiers of three trays, stacked, with room for plants under the upper tier', () => {
    const { target } = build();
    const beds = target.children.filter(o => o.name.startsWith('GrowBed_'));
    expect(beds.length).toBe(6);
    const levels = [...new Set(beds.map(b => b.position.y.toFixed(3)))].map(Number).sort((a, b) => a - b);
    expect(levels.length).toBe(2);
    expect(levels[1] - levels[0]).toBeGreaterThan(0.5);
  });

  it('stays inside the rack\'s footprint and under the ceiling', () => {
    const { target } = build();
    const [w, h, d] = GROW_RACK.size;
    const box = new THREE.Box3().setFromObject(target);
    expect(box.max.x - box.min.x).toBeLessThanOrEqual(w + 1e-3);
    expect(box.max.z - box.min.z).toBeLessThanOrEqual(d + 1e-3);
    expect(box.max.y - box.min.y).toBeLessThanOrEqual(h + 1e-3);
    expect(box.min.y).toBeGreaterThanOrEqual(-h / 2 - 1e-3);   // origin is the rack's middle
  });

  it('merges its plain parts by material, so the frame is a handful of draw calls', () => {
    const { target } = build();
    expect(meshes(target).length).toBeLessThanOrEqual(20);
  });

  it('hangs a UV fixture, the ceiling light model, over each tray: one instanced draw', () => {
    const { target, fixtures } = build();
    expect(fixtures.isInstancedMesh).toBe(true);
    expect(fixtures.count).toBe(6);
    expect(target.getObjectByName('GrowLights')).toBe(fixtures);
  });

  it('colours the fixtures UV without repainting the cached model', () => {
    const { fixtures, assets } = build();
    expect(fixtures.material).not.toBe(assets.fixtureMaterial);
    expect(fixtures.material.emissive.getHex()).toBe(UV_LIGHT.color);
    expect(assets.fixtureMaterial.emissive.getHex()).toBe(0xffffff);
  });

  it('hangs each fixture clear of the plants below it', () => {
    const { fixtures, plants } = build();
    fixtures.computeBoundingBox();
    const m = new THREE.Matrix4();
    const lowest = new THREE.Box3();
    // Per tier: the tallest plant under the lowest fixture above it.
    const tiers = new Map();
    const box = new THREE.Box3();
    for (let i = 0; i < fixtures.count; i++) {
      fixtures.getMatrixAt(i, m);
      box.copy(fixtures.geometry.boundingBox).applyMatrix4(m);
      const tier = box.max.y > 0.4 ? 1 : 0;      // rack-local: origin is the rack's middle
      tiers.set(tier, Math.min(tiers.get(tier) ?? Infinity, box.min.y));
    }
    const top = [0, 0];
    for (const plant of plants) {
      plant.geometry.computeBoundingBox();
      for (let i = 0; i < plant.count; i++) {
        plant.getMatrixAt(i, m);
        lowest.copy(plant.geometry.boundingBox).applyMatrix4(m);
        const tier = lowest.min.y > 0 ? 1 : 0;
        top[tier] = Math.max(top[tier], lowest.max.y);
      }
    }
    expect(top[0]).toBeLessThan(tiers.get(0));
    expect(top[1]).toBeLessThan(tiers.get(1));
  });

  it('grows two plants in every tray, from the recoloured tree, each its own height', () => {
    const { plants, assets } = build();
    expect(plants.length).toBeGreaterThan(0);
    for (const p of plants) {
      expect(p.isInstancedMesh).toBe(true);
      expect(p.count).toBe(12);
      expect(p.material).not.toBe(assets.plantMaterial);
    }
    const m = new THREE.Matrix4();
    const heights = new Set();
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    for (let i = 0; i < plants[0].count; i++) {
      plants[0].getMatrixAt(i, m);
      m.decompose(p, q, s);
      heights.add(s.y.toFixed(3));
      expect(s.y).toBeGreaterThan(0.7);
      expect(s.y).toBeLessThan(1.3);
    }
    expect(heights.size).toBeGreaterThan(3);
  });

  it('adds no light sources: the light count is compiled into every lit shader', () => {
    const { target } = build();
    let lights = 0;
    target.traverse(o => { if (o.isLight) lights++; });
    expect(lights).toBe(0);
  });

  it('puts its glowing fittings where the power grid will find them', () => {
    const { fixtures, plants } = build();
    expect(fixtures.material.emissiveIntensity).toBeGreaterThan(0);
    for (const p of plants) expect(p.material.isMeshBasicMaterial).toBeFalsy();
  });

  it('is deterministic, so a rebuilt scene grows the same plants', () => {
    const a = build().plants[0], b = build().plants[0];
    expect(Array.from(a.instanceMatrix.array)).toEqual(Array.from(b.instanceMatrix.array));
  });

  it('falls back to a glowing strip per tier when the models are not loaded', () => {
    const { target, fixtures, plants } = build({ get: () => undefined });
    expect(fixtures).toBeNull();
    expect(plants).toEqual([]);
    const glows = meshes(target).filter(o => o.material.emissive?.getHex());
    expect(glows.map(g => g.name).sort()).toEqual(['GrowLight_1', 'GrowLight_2']);
  });

  it('hands every material and geometry it made to the room to free', () => {
    const { owned, fixtures, plants } = build();
    expect(owned).toContain(fixtures.material);
    expect(owned).toContain(plants[0].material);
    expect(owned).toContain(fixtures);
  });

  it('never owns the cached geometry, which other copies share', () => {
    const { owned, assets } = build();
    const geometries = new Set();
    assets.get('model:grow-plant').traverse(o => o.isMesh && geometries.add(o.geometry));
    assets.get('model:light-ceiling').traverse(o => o.isMesh && geometries.add(o.geometry));
    for (const g of geometries) expect(owned).not.toContain(g);
  });
});
