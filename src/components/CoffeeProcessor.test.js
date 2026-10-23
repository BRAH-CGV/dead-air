import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { GameObject } from '../core/GameObject.js';
import { CoffeeProcessor } from './CoffeeProcessor.js';
import { CoffeeItems } from './CoffeeItems.js';
import { Interactable } from './Interactable.js';
import { CoffeeHarvest, COFFEE_HARVEST } from '../gameplay/CoffeeHarvest.js';
import { buildBeanProcessor, BAG_SPOTS, LID_OPEN } from '../gameobjects/BeanProcessor.js';
import { CoffeeBeans, CoffeeBag } from '../gameobjects/CoffeeGoods.js';

/** The processor in a room moved off the origin, its coffee goods beside it
 *  (no physics: they go where they are placed). */
function make() {
  const room = new GameObject('Room');
  room.object3d.position.set(-3, 0, 2);
  const go = new GameObject('BeanProcessor');
  go.object3d.position.set(-2.5, 0.85, 1);
  room.addChild(go);
  const parts = buildBeanProcessor(go.object3d, { own: r => r });
  const use = go.addComponent(new CoffeeProcessor({ parts }));
  const beans = [new CoffeeBeans(), new CoffeeBeans()];
  const bags = [new CoffeeBag(), new CoffeeBag()];
  for (const it of [...beans, ...bags]) room.addChild(it);
  room.object3d.updateMatrixWorld(true);
  const hands = {
    heldPickupable: null,
    pickUp: vi.fn(pk => { hands.heldPickupable = pk; pk.held = true; return true; }),
    dropHeld: vi.fn(() => { const pk = hands.heldPickupable; if (pk) pk.held = false; hands.heldPickupable = null; return pk; }),
  };
  const engine = { consumeAction: vi.fn() };
  const items = new CoffeeItems({ beans, bags, pickup: hands, engine });
  const scene = new THREE.Scene();
  scene.userData.engine = engine;
  go.scene = scene;
  const harvest = new CoffeeHarvest({ bushes: 4, random: () => 0 });
  use.bind(harvest, items);
  /** World point from the processor's own space. */
  const world = (x, y, z) => go.object3d.localToWorld(new THREE.Vector3(x, y, z));
  return { go, use, parts, harvest, items, hands, beans, bags, world, engine };
}

/** Let a pile go at `at` (world), and give the processor a frame. */
const drop = (t, at) => {
  const pile = t.items.spawnBeans(at);
  t.hands.dropHeld();
  t.use.onUpdate(0.016);
  return pile;
};

const lit = lamp => lamp.material.emissive.getHSL({}).l;

describe('CoffeeProcessor', () => {
  it('is used with the interact key, and only says what it is', () => {
    const { use } = make();
    expect(use).toBeInstanceOf(Interactable);
    expect(use.promptLabel).toBe('Bean processor');
  });

  it('takes a pile let go near it, by the hopper or on the floor in front, and shuts the hopper', () => {
    for (const at of [[0.02, 0.35, 0.67], [0.8, -0.82, 0]]) {
      const t = make();
      const pile = drop(t, t.world(...at));
      expect(pile.inPlay, String(at)).toBe(false);   // taken in
      expect(t.harvest.processor).toBe('loaded');
      expect(t.use.promptLabel).toBe('[E] Process the beans');
      t.use.onUpdate(1);
      expect(t.parts.lid.rotation.x).toBeCloseTo(0);   // shut
    }
  });

  it('leaves a pile let go away from it', () => {
    const t = make();
    const pile = drop(t, t.world(2.5, -0.8, 0));
    expect(pile.inPlay).toBe(true);
    expect(t.harvest.processor).toBe('idle');
  });

  it('[E] grinds what it has taken; the lid stays shut until it is done', () => {
    const t = make();
    drop(t, t.world(0.8, -0.82, 0));
    t.use.onInteract({});
    expect(t.harvest.processor).toBe('processing');
    expect(t.engine.consumeAction).toHaveBeenCalledWith('interact');
    t.use.onUpdate(1);
    expect(t.use.promptLabel).toMatch(/^Processing… \(4 s\)$/);
    expect(t.parts.lid.rotation.x).toBeCloseTo(0);
    t.use.onUpdate(COFFEE_HARVEST.processSeconds);
    for (let i = 0; i < 60; i++) t.use.onUpdate(0.05);
    expect(t.parts.lid.rotation.x).toBeCloseTo(LID_OPEN);   // open again
    expect(t.use.promptLabel).toBe('Bean processor');
  });

  it('takes nothing in while it grinds: a pile let go then stays out', () => {
    const t = make();
    drop(t, t.world(0.8, -0.82, 0));
    t.use.onInteract({});
    const pile = drop(t, t.world(0.8, -0.82, 0.2));
    expect(pile.inPlay).toBe(true);
    t.use.onUpdate(COFFEE_HARVEST.processSeconds);
    t.use.onUpdate(0.016);                            // done: now it goes in
    expect(pile.inPlay).toBe(false);
  });

  it('with beans in hand, [E] drops them in rather than starting it', () => {
    const t = make();
    drop(t, t.world(0.8, -0.82, 0));                  // one already in
    t.items.spawnBeans(t.world(1.2, 0, 0));           // another in hand
    t.use.onUpdate(0);
    expect(t.use.promptLabel).toBe('[E] Drop the beans in');
    t.use.onInteract({});
    expect(t.harvest.processor).toBe('loaded');
  });

  it('[E] with nothing in it does nothing', () => {
    const t = make();
    t.use.onInteract({});
    expect(t.harvest.processor).toBe('idle');
    expect(t.engine.consumeAction).not.toHaveBeenCalled();
  });

  it('puts a bag of ground coffee in its bay for each pile ground, one spot each', () => {
    const { use, harvest, items, bags, world } = make();
    harvest.load();
    harvest.load();
    harvest.start();
    use.onUpdate(COFFEE_HARVEST.processSeconds + 0.1);
    expect(bags[0].inPlay).toBe(true);
    use.onUpdate(COFFEE_HARVEST.processSeconds);
    expect(bags[1].inPlay).toBe(true);
    expect(items.waiting).toBe(2);
    const spots = bags.map(b => b.object3d.getWorldPosition(new THREE.Vector3()));
    BAG_SPOTS.forEach(([x, y, z], i) => expect(spots[i].distanceTo(world(x, y, z))).toBeLessThan(0.01));
  });

  it('shows what it is doing: the burrs turn and beans sit in the hopper while it grinds', () => {
    const { use, parts, harvest } = make();
    use.onUpdate(1);
    expect(parts.paddles.rotation.x).toBe(0);
    expect(parts.load.visible).toBe(false);
    harvest.load();
    harvest.start();
    use.onUpdate(0.5);
    expect(parts.paddles.rotation.x).not.toBe(0);
    expect(parts.load.visible).toBe(true);
    use.onUpdate(COFFEE_HARVEST.processSeconds);
    expect(parts.load.visible).toBe(false);
  });

  it('lights one lamp for its state: red idle, amber loaded or grinding, green with a bag to take', () => {
    const { use, parts, harvest, items, hands } = make();
    const on = () => parts.lamps.map(l => lit(l) > 0.2);
    expect(on()).toEqual([false, false, true]);
    harvest.load();
    use.onUpdate(0.1);
    expect(on()).toEqual([false, true, false]);
    harvest.start();
    use.onUpdate(0.1);
    expect(on()).toEqual([false, true, false]);
    use.onUpdate(COFFEE_HARVEST.processSeconds);
    expect(on()).toEqual([true, false, false]);
    hands.pickUp(items.bags[0].pickupable);          // the bag taken out
    items.onLateUpdate();
    use.onUpdate(0.016);
    expect(on()).toEqual([false, false, true]);
    for (const l of parts.lamps) expect(l.material.emissive.getHex()).not.toBe(0);   // dimmed, never black
  });

  it('without a harvest wired it only says what it is', () => {
    const go = new GameObject('BeanProcessor');
    const use = go.addComponent(new CoffeeProcessor({ parts: buildBeanProcessor(go.object3d, { own: r => r }) }));
    expect(() => use.onUpdate(0.016)).not.toThrow();
    expect(() => use.onInteract({})).not.toThrow();
    expect(use.promptLabel).toBe('Bean processor');
  });
});
