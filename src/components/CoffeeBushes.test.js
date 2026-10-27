import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { GameObject } from '../core/GameObject.js';
import { CoffeeBushes } from './CoffeeBushes.js';
import { Interactable } from './Interactable.js';
import { CoffeeHarvest } from '../gameplay/CoffeeHarvest.js';

/** Four bushes in a row along z, rack-local, on a rack moved off the origin. */
function make() {
  const go = new GameObject('GrowBeds');
  go.object3d.position.set(-5, 0.9, -1.5);
  go.object3d.updateMatrixWorld(true);
  const bushes = [-1, -0.5, 0.5, 1].map(z => new THREE.Vector3(0, 0, z));
  const setBush = vi.fn();
  const use = go.addComponent(new CoffeeBushes({ bushes, setBush }));
  const harvest = new CoffeeHarvest({ bushes: 4, random: () => 0 });   // bushes 0 and 1 ripe
  const items = { spawnBeans: vi.fn() };
  return { go, use, setBush, harvest, items };
}

/** The hit on the rack's front face, in front of rack-local z. */
const at = (go, z, y = 0) => ({ point: go.object3d.localToWorld(new THREE.Vector3(0.35, y, z)) });

describe('CoffeeBushes', () => {
  it('is used with the interact key', () => {
    expect(make().use).toBeInstanceOf(Interactable);
  });

  it('shows tonight on the rack: every bush drawn as the harvest says, again whenever it changes', () => {
    const { use, setBush, harvest } = make();
    use.bind(harvest);
    expect(setBush.mock.calls).toEqual([[0, 'ripe'], [1, 'ripe'], [2, 'unripe'], [3, 'unripe']]);
    setBush.mockClear();
    harvest.harvest(0);
    expect(setBush).toHaveBeenCalledWith(0, 'picked');
  });

  it('harvests the bush under the crosshair, if it is ripe: a pile of beans, in front of it', () => {
    const { go, use, harvest, items } = make();
    use.bind(harvest, items);
    use.onHover(at(go, -0.45));
    expect(use.promptLabel).toBe('[E] Harvest coffee beans');
    use.onInteract(at(go, -0.45));
    expect(harvest.bushes[1]).toBe('picked');
    expect(items.spawnBeans).toHaveBeenCalledTimes(1);
    const pile = go.object3d.worldToLocal(items.spawnBeans.mock.calls[0][0].clone());
    expect(pile.x).toBeGreaterThan(0.35);                     // out of the rack's box, by its face
    expect(pile.z).toBeCloseTo(-0.5);
    use.onHover(at(go, -0.45));
    expect(use.promptLabel).toBe('');                         // picked: nothing to say
    use.onInteract(at(go, -0.45));
    expect(items.spawnBeans).toHaveBeenCalledTimes(1);
  });

  it('an unripe bush says so and gives nothing', () => {
    const { go, use, harvest, items } = make();
    use.bind(harvest, items);
    use.onHover(at(go, 0.9));
    expect(use.promptLabel).toBe('Coffee beans not ripe');
    use.onInteract(at(go, 0.9));
    expect(items.spawnBeans).not.toHaveBeenCalled();
  });

  it('the rack itself, away from any bush, says nothing', () => {
    const { go, use, harvest, items } = make();
    use.bind(harvest, items);
    expect(use.promptLabel).toBe('');
    use.onHover(at(go, -1, 0.9));                // well above the bush
    expect(use.promptLabel).toBe('');
    use.onInteract(at(go, -1, 0.9));
    expect(items.spawnBeans).not.toHaveBeenCalled();
  });

  it('its prompts say beans, and use no dash', () => {
    const { go, use, harvest } = make();
    use.bind(harvest);
    for (const z of [-1, -0.5, 0.5, 1]) {
      use.onHover(at(go, z));
      expect(use.promptLabel).not.toMatch(/cherr|—|–/i);
    }
  });

  it('lets go of the harvest when the scene is torn down', () => {
    const { use, setBush, harvest } = make();
    use.bind(harvest);
    use.onDestroy();
    setBush.mockClear();
    harvest.newNight();
    expect(setBush).not.toHaveBeenCalled();
  });
});
