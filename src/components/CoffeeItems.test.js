import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { CoffeeItems } from './CoffeeItems.js';

/** A stand-in item: what CoffeeItems reads of a CoffeeBeans / CoffeeBag. */
function item(kind) {
  const it = {
    coffeeKind: kind, inPlay: false, at: null,
    pickupable: { held: false },
    place: vi.fn(at => { it.inPlay = true; it.at = at.clone(); }),
    park: vi.fn(() => { it.inPlay = false; }),
    position: () => it.at,
  };
  it.pickupable.gameObject = it;
  return it;
}

/** A stand-in PickupSystem. */
function pickup() {
  const p = {
    heldPickupable: null,
    pickUp: vi.fn(pk => { if (p.heldPickupable) return false; p.heldPickupable = pk; pk.held = true; return true; }),
    dropHeld: vi.fn(() => { const pk = p.heldPickupable; if (pk) pk.held = false; p.heldPickupable = null; return pk; }),
  };
  return p;
}

function make() {
  const beans = [item('beans'), item('beans')];
  const bags = [item('bag'), item('bag')];
  const hands = pickup();
  const engine = { consumeAction: vi.fn() };
  const items = new CoffeeItems({ beans, bags, pickup: hands, engine });
  return { items, beans, bags, hands, engine };
}

const at = new THREE.Vector3(1, 1, 1);

describe('CoffeeItems', () => {
  it('a harvested pile goes straight into empty hands, and that press is used up', () => {
    const { items, beans, hands, engine } = make();
    const pile = items.spawnBeans(at);
    expect(pile).toBe(beans[0]);
    expect(pile.place).toHaveBeenCalled();
    expect(hands.heldPickupable).toBe(pile.pickupable);
    expect(engine.consumeAction).toHaveBeenCalledWith('interact');
    expect(items.held('beans')).toBe(pile);
  });

  it('with hands full, the pile is left where it was picked', () => {
    const { items, hands } = make();
    hands.heldPickupable = { held: true, gameObject: {} };
    const pile = items.spawnBeans(at);
    expect(pile.inPlay).toBe(true);
    expect(hands.pickUp).not.toHaveBeenCalled();
  });

  it('takes the next pile out of the pool; with none left, reuses the oldest', () => {
    const { items, beans } = make();
    expect(items.spawnBeans(at)).toBe(beans[0]);
    items.hands.dropHeld();
    expect(items.spawnBeans(at)).toBe(beans[1]);
    items.hands.dropHeld();
    expect(items.spawnBeans(at)).toBe(beans[0]);
  });

  it('knows what is in hand, and what was let go this very press (the drop runs first or after)', () => {
    const { items, hands } = make();
    const pile = items.spawnBeans(at);
    items.onLateUpdate();
    expect(items.held('beans')).toBe(pile);
    expect(items.held('bag')).toBeNull();
    hands.dropHeld();                       // the pickup system dropped it on this press…
    expect(items.held('beans')).toBe(pile); // …still counted as in hand for it
    items.onLateUpdate();                   // the frame after, it is on the floor
    expect(items.held('beans')).toBeNull();
  });

  it('take() spends one: out of the hands, parked, and the press used up', () => {
    const { items, hands, engine } = make();
    const pile = items.spawnBeans(at);
    engine.consumeAction.mockClear();
    items.take(pile);
    expect(hands.heldPickupable).toBeNull();
    expect(pile.park).toHaveBeenCalled();
    expect(engine.consumeAction).toHaveBeenCalledWith('interact');
  });

  it('a bag ground is put in the bay, waiting there until it is picked up', () => {
    const { items, bags, hands } = make();
    const bag = items.spawnBag(at);
    expect(bag).toBe(bags[0]);
    expect(items.waiting).toBe(1);
    expect(hands.pickUp).not.toHaveBeenCalled();
    hands.pickUp(bag.pickupable);
    items.onLateUpdate();
    expect(items.waiting).toBe(0);
  });

  it('lists the loose ones of a kind: in play, not in hand', () => {
    const { items, hands } = make();
    const a = items.spawnBeans(at);
    hands.dropHeld();
    const b = items.spawnBeans(at);
    expect(items.loose('beans')).toEqual([a]);
    hands.dropHeld();
    expect(items.loose('beans')).toEqual([a, b]);
    expect(items.loose('bag')).toEqual([]);
    void b;
  });

  it('a new night puts everything away, out of the hands too', () => {
    const { items, beans, bags, hands } = make();
    items.spawnBeans(at);
    items.spawnBag(at);
    items.reset();
    expect(hands.heldPickupable).toBeNull();
    for (const it of [...beans, ...bags]) expect(it.inPlay).toBe(false);
    expect(items.waiting).toBe(0);
    expect(items.held('beans')).toBeNull();
  });
});
