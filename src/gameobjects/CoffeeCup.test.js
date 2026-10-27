import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { CoffeeCup, CUP } from './CoffeeCup.js';

const meshes = cup => {
  const out = [];
  cup.object3d.traverse(o => { if (o.isMesh) out.push(o); });
  return out;
};
const byName = (cup, name) => cup.object3d.getObjectByName(name);

describe('CoffeeCup', () => {
  it('is a mug about a mug\'s size, standing on its origin', () => {
    const cup = new CoffeeCup();
    const box = new THREE.Box3().setFromObject(cup.object3d);
    expect(box.min.y).toBeCloseTo(0, 3);
    expect(box.max.y).toBeCloseTo(CUP.height, 2);
    expect(CUP.height).toBeGreaterThan(0.08);
    expect(CUP.height).toBeLessThan(0.12);
    expect(CUP.radius).toBeGreaterThan(0.035);
    expect(CUP.radius).toBeLessThan(0.055);
  });

  it('wears its picture round the outside, the middle of it on the front (+z)', () => {
    const picture = new THREE.Texture();
    const cup = new CoffeeCup({ picture });
    const wall = byName(cup, 'CupWall');
    expect(wall.material.map).toBe(picture);
    const pos = wall.geometry.getAttribute('position'), uv = wall.geometry.getAttribute('uv');
    let front = null;
    for (let i = 0; i < uv.count; i++) if (Math.abs(uv.getX(i) - 0.5) < 1e-6) front = i;
    expect(pos.getZ(front)).toBeGreaterThan(0.03);
    expect(Math.abs(pos.getX(front))).toBeLessThan(1e-6);
    // u grows to the viewer's right, so the picture is not mirrored.
    let right = null;
    for (let i = 0; i < uv.count; i++) if (Math.abs(uv.getX(i) - 0.6) < 0.02) right = i;
    expect(pos.getX(right)).toBeGreaterThan(0);
  });

  it('has a plain glaze without a picture', () => {
    const cup = new CoffeeCup();
    expect(byName(cup, 'CupWall').material.map).toBeNull();
  });

  it('has its handle on its right (+x), out from the wall', () => {
    const cup = new CoffeeCup();
    const box = new THREE.Box3().setFromObject(byName(cup, 'CupHandle'));
    expect(box.min.x).toBeGreaterThan(CUP.radius * 0.8);
    expect(box.max.x).toBeGreaterThan(CUP.radius + 0.015);
  });

  it('fills: the coffee rises from the bottom to just under the rim', () => {
    const cup = new CoffeeCup();
    const coffee = byName(cup, 'CupCoffee');
    cup.setFill(0);
    const low = coffee.position.y;
    cup.setFill(1);
    const high = coffee.position.y;
    expect(low).toBeLessThan(0.02);
    expect(high).toBeGreaterThan(CUP.height * 0.75);
    expect(high).toBeLessThan(CUP.height);
    cup.setFill(2);
    expect(coffee.position.y).toBe(high);       // clamped
    cup.setFill(-1);
    expect(coffee.position.y).toBe(low);
  });

  it('keeps the coffee inside the cup, empty or full', () => {
    const cup = new CoffeeCup();
    const coffee = byName(cup, 'CupCoffee');
    for (const fill of [0, 0.5, 1]) {
      cup.setFill(fill);
      cup.object3d.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(coffee);
      for (const v of [box.min.x, box.max.x, box.min.z, box.max.z]) {
        expect(Math.abs(v), `fill ${fill}`).toBeLessThan(CUP.radius - CUP.wall + 1e-6);
      }
      expect(box.max.y - box.min.y).toBeLessThan(1e-6);         // flat
    }
  });

  describe('pouring', () => {
    // Two spouts over the cup, either side and a little in front: cup-local.
    const SPOUTS = [[-0.037, 0.12, 0.015], [0.037, 0.12, 0.015]];
    const streams = cup => meshes(cup).filter(m => m.name === 'CupStream');
    /** A stream's two ends, in the cup's space. */
    const ends = (cup, stream) => {
      cup.object3d.updateMatrixWorld(true);
      const pos = stream.geometry.getAttribute('position');
      const box = new THREE.Box3().setFromBufferAttribute(pos);
      const top = new THREE.Vector3(0, box.max.y, 0).applyMatrix4(stream.matrixWorld);
      const bottom = new THREE.Vector3(0, box.min.y, 0).applyMatrix4(stream.matrixWorld);
      return { top, bottom };
    };

    it('a stream from each spout, only while it pours', () => {
      const cup = new CoffeeCup({ spouts: SPOUTS });
      expect(streams(cup)).toHaveLength(2);
      for (const s of streams(cup)) expect(s.visible).toBe(false);
      cup.setPouring(true);
      for (const s of streams(cup)) expect(s.visible).toBe(true);
      cup.setPouring(false);
      for (const s of streams(cup)) expect(s.visible).toBe(false);
      expect(streams(new CoffeeCup())).toHaveLength(0);       // no spouts, no streams
    });

    it('falls straight down from the spout onto the coffee, shorter as it fills, clear of the wall', () => {
      const cup = new CoffeeCup({ spouts: SPOUTS });
      cup.setPouring(true);
      const coffee = byName(cup, 'CupCoffee');
      let last = Infinity;
      for (const fill of [0, 0.5, 1]) {
        cup.setFill(fill);
        streams(cup).forEach((stream, i) => {
          const { top, bottom } = ends(cup, stream);
          expect(top.distanceTo(new THREE.Vector3(...SPOUTS[i])), `fill ${fill}`).toBeLessThan(1e-6);
          expect(bottom.y).toBeCloseTo(coffee.position.y, 6);
          expect(bottom.x).toBeCloseTo(top.x, 6);              // plumb
          expect(bottom.z).toBeCloseTo(top.z, 6);
          if (i === 0) {
            expect(top.distanceTo(bottom)).toBeLessThan(last);
            last = top.distanceTo(bottom);
          }
        });
      }
    });

    it('is wide enough inside for a spout over its edge to pour clear of the wall', () => {
      for (const [x, , z] of SPOUTS) {
        expect(Math.hypot(x, z) + 0.003).toBeLessThan(CUP.footRadius - CUP.wall);
      }
    });
  });

  it('casts no shadow: it comes and goes, and the shadow maps are frozen', () => {
    for (const mesh of meshes(new CoffeeCup())) expect(mesh.castShadow, mesh.name).toBe(false);
  });

  it('frees its own geometries and materials, never the cached picture', () => {
    const picture = new THREE.Texture();
    const spy = vi.spyOn(picture, 'dispose');
    const cup = new CoffeeCup({ picture });
    const disposed = meshes(cup).map(m => vi.spyOn(m.geometry, 'dispose'));
    cup.dispose();
    for (const d of disposed) expect(d).toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled();
  });
});
