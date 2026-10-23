import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { CoffeeBeans, CoffeeBag, COFFEE_BEANS, COFFEE_BAG, BEANS_COLOUR } from './CoffeeGoods.js';
import { Pickupable } from '../components/Pickupable.js';
import { makeEngine, rapierModule } from '../test/fakeRapier.js';

function init(item) {
  const engine = makeEngine();
  engine.RAPIER = rapierModule().default;
  const scene = new THREE.Scene();
  scene.userData.engine = engine;
  item._init(scene, engine.world);
  return engine;
}

describe('CoffeeGoods', () => {
  for (const [Kind, kind, spec] of [[CoffeeBeans, 'beans', COFFEE_BEANS], [CoffeeBag, 'bag', COFFEE_BAG]]) {
    describe(Kind.name, () => {
      it(`is carried like a drive: a Pickupable, a dynamic body the pick-up ray finds, kind '${kind}'`, () => {
        const item = new Kind();
        const engine = init(item);
        expect(item.getComponent(Pickupable)).toBe(item.pickupable);
        expect(item.coffeeKind).toBe(kind);
        expect(item.rigidBody.bodyType()).toBe('dynamic');
        expect(engine._bodyToGO.get(item.rigidBody.handle)).toBe(item);
        expect(engine.rigidBodyMap.get(item.rigidBody.handle)).toBe(item);
      });

      it('starts parked: out of play, hidden, under the floor', () => {
        const item = new Kind();
        init(item);
        expect(item.inPlay).toBe(false);
        expect(item.object3d.visible).toBe(false);
        expect(item.rigidBody.translation().y).toBeLessThan(-10);
      });

      it('place() brings it into the world where it is asked; park() puts it away again', () => {
        const item = new Kind();
        init(item);
        item.place(new THREE.Vector3(1, 0.8, -2));
        expect(item.inPlay).toBe(true);
        expect(item.object3d.visible).toBe(true);
        expect(item.rigidBody.translation()).toEqual({ x: 1, y: 0.8, z: -2 });
        item.park();
        expect(item.inPlay).toBe(false);
        expect(item.object3d.visible).toBe(false);
        expect(item.rigidBody.translation().y).toBeLessThan(-10);
      });

      it('placed before it has a body, it comes into the world where it was put', () => {
        const item = new Kind();
        item.place(new THREE.Vector3(0, 1, 0));
        init(item);
        expect(item.inPlay).toBe(true);
        expect(item.rigidBody.translation().y).toBe(1);
      });

      it('is about the size it should be, feet at its origin', () => {
        const item = new Kind();
        const box = new THREE.Box3().setFromObject(item.mesh);
        const size = box.getSize(new THREE.Vector3());
        expect(box.min.y).toBeGreaterThan(-0.005);
        expect(size.x).toBeLessThanOrEqual(spec.size[0] + 0.01);
        expect(size.y).toBeLessThanOrEqual(spec.size[1] + 0.01);
        expect(size.z).toBeLessThanOrEqual(spec.size[2] + 0.01);
      });

      it('hands what it builds to be freed', () => {
        const owned = [];
        const item = new Kind(undefined, { own: r => (owned.push(r), r) });
        expect(owned).toContain(item.mesh.geometry);
        expect(owned).toContain(item.mesh.material);
      });
    });
  }

  it('the beans are a heap of dull brownish-red beans, as on the bush', () => {
    const { mesh } = new CoffeeBeans();
    const colour = mesh.geometry.attributes.color;
    const c = new THREE.Color(), hsl = {}, base = {};
    new THREE.Color(BEANS_COLOUR).getHSL(base);
    for (let i = 0; i < colour.count; i += 30) {
      c.fromBufferAttribute(colour, i).getHSL(hsl);
      expect(Math.abs(hsl.h - base.h)).toBeLessThan(0.03);
    }
    expect(mesh.geometry.attributes.position.count / 3 / 20).toBe(COFFEE_BEANS.beans);
  });
});
