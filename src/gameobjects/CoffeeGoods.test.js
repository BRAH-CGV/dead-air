import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { CoffeeBeans, CoffeeBag, COFFEE_BEANS, COFFEE_BAG, BEANS_COLOUR } from './CoffeeGoods.js';
import { Pickupable } from '../components/Pickupable.js';
import { ImpactSound, IMPACT_SOUNDS } from '../components/ImpactSound.js';
import { makeEngine, rapierModule } from '../test/fakeRapier.js';

function init(item) {
  const engine = makeEngine();
  engine.RAPIER = { ...rapierModule().default, RigidBodyType: { Dynamic: 0, Fixed: 1, KinematicPositionBased: 2 } };
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

      it('place() stands it on the spot asked; park() puts it away again', () => {
        const item = new Kind();
        init(item);
        item.place(new THREE.Vector3(1, 0.8, -2));
        expect(item.inPlay).toBe(true);
        expect(item.object3d.visible).toBe(true);
        expect(item.rigidBody.translation()).toEqual({ x: 1, y: 0.8 + spec.size[1] / 2, z: -2 });   // its middle, over its feet
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
        expect(item.rigidBody.translation().y).toBeCloseTo(1 + spec.size[1] / 2);
      });

      it('is about the size it should be, centred on its body, so the hand holds it by its middle', () => {
        const item = new Kind();
        item.object3d.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(item.mesh);
        const size = box.getSize(new THREE.Vector3());
        const middle = box.getCenter(new THREE.Vector3());
        expect(Math.abs(middle.x)).toBeLessThan(0.01);
        expect(Math.abs(middle.y)).toBeLessThan(0.01);
        expect(Math.abs(middle.z)).toBeLessThan(0.01);
        expect(size.x).toBeLessThanOrEqual(spec.size[0] + 0.01);
        expect(size.y).toBeLessThanOrEqual(spec.size[1] + 0.01);
        expect(size.z).toBeLessThanOrEqual(spec.size[2] + 0.01);
      });

      it(`sounds as it is knocked and handled: IMPACT_SOUNDS.${kind}`, () => {
        const voice = new Kind().getComponent(ImpactSound);
        expect(voice).toBeTruthy();
        expect(voice.clips).toEqual(IMPACT_SOUNDS[kind].clips);
        expect(voice.volume).toBe(IMPACT_SOUNDS[kind].volume);
      });

      it('docks like a drive: kinematic in a socket, dynamic again out of it; parked, it leaves its socket first', () => {
        const item = new Kind();
        const engine = init(item);
        item.place(new THREE.Vector3(0, 1, 0));
        item.rigidBody.setBodyType = vi.fn();
        const { KinematicPositionBased, Dynamic } = engine.RAPIER.RigidBodyType;
        item.makeKinematic();
        expect(item.rigidBody.setBodyType).toHaveBeenLastCalledWith(KinematicPositionBased, true);
        item.makeDynamic();
        expect(item.rigidBody.setBodyType).toHaveBeenLastCalledWith(Dynamic, true);
        const socket = { detach: vi.fn() };
        item._snapOwner = socket;
        item.park();
        expect(socket.detach).toHaveBeenCalledWith(item, { playSound: false });
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
