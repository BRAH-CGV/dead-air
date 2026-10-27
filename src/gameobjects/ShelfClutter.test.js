import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { layoutShelf, buildClutter, weathered, CLUTTER, RACK_SHELF, SMALL_SHELF, WEATHER } from './ShelfClutter.js';

/** An item's footprint along the shelf, turned by its rotation. */
function extent(item) {
  const [w, , d] = item.size;
  const c = Math.abs(Math.cos(item.rotationY)), s = Math.abs(Math.sin(item.rotationY));
  return { x: (c * w + s * d) / 2, z: (s * w + c * d) / 2 };
}

describe('layoutShelf', () => {
  for (const [name, spec] of [['the storage rack', RACK_SHELF], ['the small shelf', SMALL_SHELF]]) {
    describe(name, () => {
      const seeds = [1, 2, 3, 4, 5, 6, 7, 8];

      it('keeps everything inside the uprights, on its boards, under the next one', () => {
        for (const seed of seeds) {
          const items = layoutShelf(spec, seed);
          expect(items.length, `seed ${seed}`).toBeGreaterThan(0);
          for (const item of items) {
            const e = extent(item), [x, y, z] = item.position;
            expect(x - e.x, item.kind).toBeGreaterThanOrEqual(-spec.length / 2 + spec.margin - 1e-9);
            expect(x + e.x, item.kind).toBeLessThanOrEqual(spec.length / 2 - spec.margin + 1e-9);
            expect(z - e.z, item.kind).toBeGreaterThanOrEqual(-spec.depth / 2 + spec.depthMargin - 1e-9);
            expect(z + e.z, item.kind).toBeLessThanOrEqual(spec.depth / 2 - spec.depthMargin + 1e-9);
            const level = spec.levels.find(l => y >= l.y - 1e-9 && y < l.y + l.clearance);
            expect(level, `${item.kind} at ${y}`).toBeDefined();
            expect(y + item.size[1], item.kind).toBeLessThanOrEqual(level.y + level.clearance + 1e-9);
          }
        }
      });

      it('stands each thing on its board or squarely on the one below', () => {
        for (const seed of seeds) {
          const items = layoutShelf(spec, seed);
          for (const item of items) {
            const [x, y, z] = item.position;
            if (spec.levels.some(l => Math.abs(l.y - y) < 1e-9)) continue;
            const under = items.find(o => o !== item && Math.abs(o.position[1] + o.size[1] - y) < 1e-9
              && Math.abs(o.position[0] - x) < o.size[0] / 2 && Math.abs(o.position[2] - z) < o.size[2] / 2);
            expect(under, `${item.kind} at ${y} on seed ${seed}`).toBeDefined();
          }
        }
      });

      it('never puts two things in the same place on a board', () => {
        for (const seed of seeds) {
          const grounded = layoutShelf(spec, seed).filter(i => spec.levels.some(l => Math.abs(l.y - i.position[1]) < 1e-9));
          for (const level of spec.levels) {
            const row = grounded.filter(i => Math.abs(i.position[1] - level.y) < 1e-9)
              .map(i => [i.position[0] - extent(i).x, i.position[0] + extent(i).x]).sort((a, b) => a[0] - b[0]);
            for (let k = 1; k < row.length; k++) expect(row[k][0], `seed ${seed}`).toBeGreaterThanOrEqual(row[k - 1][1] - 1e-9);
          }
        }
      });

      it('fills its boards well, but not to bursting', () => {
        let used = 0, usable = 0;
        for (const seed of seeds) {
          const items = layoutShelf(spec, seed);
          for (const level of spec.levels) {
            usable += spec.length - 2 * spec.margin;
            used += items.filter(i => Math.abs(i.position[1] - level.y) < 1e-9).reduce((sum, i) => sum + 2 * extent(i).x, 0);
          }
        }
        expect(used / usable).toBeGreaterThan(0.45);
        expect(used / usable).toBeLessThan(0.92);
      });
    });
  }

  it('is the same every time for a seed, and different for another', () => {
    expect(layoutShelf(RACK_SHELF, 3)).toEqual(layoutShelf(RACK_SHELF, 3));
    expect(layoutShelf(RACK_SHELF, 3)).not.toEqual(layoutShelf(RACK_SHELF, 4));
  });

  it('puts the heavy things low', () => {
    let low = 0, high = 0;
    for (let seed = 1; seed <= 40; seed++) {
      for (const item of layoutShelf(RACK_SHELF, seed)) {
        if (!CLUTTER[item.kind].heavy) continue;
        if (item.position[1] < 0.5) low++; else high++;
      }
    }
    expect(low).toBeGreaterThan(high * 2);
  });

  it('uses a good mix of the catalogue', () => {
    const kinds = new Set();
    for (let seed = 1; seed <= 12; seed++) for (const item of layoutShelf(RACK_SHELF, seed)) kinds.add(item.kind);
    expect(kinds.size).toBeGreaterThanOrEqual(Object.keys(CLUTTER).length - 1);
  });
});

describe('buildClutter', () => {
  const own = () => { const list = []; return { list, own: r => (list.push(r), r) }; };

  it('one InstancedMesh per kind, every placed thing an instance of it, in its colour', () => {
    const target = new THREE.Group();
    const frame = new THREE.Matrix4().makeTranslation(2, 0, -1);
    const items = layoutShelf(RACK_SHELF, 5);
    const { own: keep } = own();
    const meshes = buildClutter(target, [{ items, matrix: frame }], { own: keep });
    const kinds = new Set(items.map(i => i.kind));
    expect(Object.keys(meshes).sort()).toEqual([...kinds].sort());
    let count = 0;
    for (const [kind, mesh] of Object.entries(meshes)) {
      expect(mesh).toBeInstanceOf(THREE.InstancedMesh);
      expect(mesh.parent).toBe(target);
      expect(mesh.castShadow && mesh.receiveShadow).toBe(true);
      expect(mesh.instanceColor).not.toBeNull();
      expect(mesh.count).toBe(items.filter(i => i.kind === kind).length);
      count += mesh.count;
    }
    expect(count).toBe(items.length);

    // The first item lands where the layout put it, moved by its shelf's frame.
    const first = items[0], mesh = meshes[first.kind];
    const m = new THREE.Matrix4(), at = new THREE.Vector3(), colour = new THREE.Color();
    mesh.getMatrixAt(items.filter(i => i.kind === first.kind).indexOf(first), m);
    at.setFromMatrixPosition(m);
    expect(at.toArray()).toEqual([first.position[0] + 2, first.position[1], first.position[2] - 1].map(v => expect.closeTo(v, 6)));
    mesh.getColorAt(0, colour);
    expect(colour.getHex()).toBe(weathered(items.find(i => i.kind === first.kind).color).getHex());
  });

  it('weathers every colour: duller and darker, to sit in the dim room', () => {
    expect(WEATHER.saturation).toBeLessThan(1);
    expect(WEATHER.lightness).toBeLessThan(1);
    for (const def of Object.values(CLUTTER)) {
      for (const hex of def.colors) {
        const before = {}, after = {};
        new THREE.Color(hex).getHSL(before);
        weathered(hex).getHSL(after);
        expect(after.l).toBeCloseTo(before.l * WEATHER.lightness, 5);
        expect(after.s).toBeCloseTo(before.s * WEATHER.saturation, 5);
      }
    }
  });

  it('builds each kind to a unit box, standing on its origin, so a scale is its size', () => {
    const target = new THREE.Group();
    const items = Object.keys(CLUTTER).map((kind, i) => ({ kind, size: [1, 1, 1], position: [i * 2, 0, 0], rotationY: 0, color: 0xffffff }));
    const meshes = buildClutter(target, [{ items, matrix: new THREE.Matrix4() }], { own: r => r });
    for (const [kind, mesh] of Object.entries(meshes)) {
      mesh.geometry.computeBoundingBox();
      const { min, max } = mesh.geometry.boundingBox;
      expect(min.y, kind).toBeCloseTo(0, 2);
      expect(max.y, kind).toBeLessThanOrEqual(1.01);
      for (const v of [min.x, min.z]) expect(v, kind).toBeGreaterThanOrEqual(-0.51);
      for (const v of [max.x, max.z]) expect(v, kind).toBeLessThanOrEqual(0.51);
      expect(mesh.geometry.getAttribute('color'), kind).toBeDefined();
    }
  });

  it('owns what it builds, for the room to free', () => {
    const { list, own: keep } = own();
    const meshes = buildClutter(new THREE.Group(), [{ items: layoutShelf(RACK_SHELF, 2), matrix: new THREE.Matrix4() }], { own: keep });
    for (const mesh of Object.values(meshes)) {
      expect(list).toContain(mesh.geometry);
      expect(list).toContain(mesh.material);
    }
  });
});
