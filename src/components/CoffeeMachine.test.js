import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { CoffeeMachine, COFFEE } from './CoffeeMachine.js';
import { Interactable } from './Interactable.js';
import { GameObject } from '../core/GameObject.js';

/** The dock on top of the machine (a SnapSocket stand-in): a bag sits in
 *  it until it is taken off. */
const fakeDock = () => ({
  bag: null,
  detached: [],
  hasAttached() { return !!this.bag; },
  get firstAttached() { return this.bag; },
  detach(item, opts) { this.detached.push([item, opts]); this.bag = null; return item; },
});

/** The coffee carried about (a CoffeeItems stand-in). */
const carried = () => ({
  inHand: false,
  taken: [],
  held(kind) { return kind === 'bag' && this.inHand ? {} : null; },
  take(item, opts) { this.taken.push([item, opts]); },
});

/** A bag of ground coffee docked on top. */
const dockBag = m => { m.dock.bag = { name: 'Bag' }; m.onUpdate(0); return m.dock.bag; };

function make(opts, { docked = true } = {}) {
  const go = new GameObject('CoffeeMachine');
  const machine = go.addComponent(new CoffeeMachine(opts));
  machine.stamina = { value: 0.3, restore(a) { this.value = Math.min(1, this.value + a); } };
  machine.items = carried();
  machine.dock = fakeDock();
  if (docked) dockBag(machine);
  else machine.onUpdate(0);
  return machine;
}

/** Brew a cup, wait it out, drink it. */
function brewAndDrink(machine) {
  machine.onInteract({});
  machine.onUpdate(COFFEE.brewSeconds + 0.1);
  machine.onInteract({});
  machine.onUpdate(0);
}

const EMPTY_LABEL = 'Needs ground coffee';

describe('CoffeeMachine', () => {
  it('a real wait for each cup, about a third of the bar a cup', () => {
    expect(COFFEE.brewSeconds).toBeGreaterThanOrEqual(10);
    expect(COFFEE.brewSeconds).toBeLessThanOrEqual(30);
    expect(COFFEE.amount).toBeCloseTo(0.35);
  });

  it('is used with the interact key', () => {
    expect(make()).toBeInstanceOf(Interactable);
  });

  it('a cup takes brewing: nothing to drink until it is done', () => {
    const m = make();
    expect(m.state).toBe('ready');
    expect(m.promptLabel).toMatch(/^\[E\] Brew a coffee/);
    m.onInteract({});
    expect(m.state).toBe('brewing');
    expect(m.promptLabel).toMatch(/^Brewing…/);

    m.onInteract({});                         // nothing while it brews
    expect(m.stamina.value).toBe(0.3);
    m.onUpdate(COFFEE.brewSeconds - 0.1);
    expect(m.state).toBe('brewing');
    m.onUpdate(0.2);
    expect(m.state).toBe('brewed');
    expect(m.promptLabel).toBe('[E] Drink the coffee');
    expect(m.stamina.value).toBe(0.3);        // brewed, not drunk
  });

  it('counts the brew down in its prompt', () => {
    const m = make();
    m.onInteract({});
    expect(m.promptLabel).toBe(`Brewing… (${COFFEE.brewSeconds} s)`);
    m.onUpdate(5.5);
    expect(m.promptLabel).toBe(`Brewing… (${COFFEE.brewSeconds - 5} s)`);
  });

  it('a cup gives back COFFEE.amount', () => {
    const m = make();
    brewAndDrink(m);
    expect(m.stamina.value).toBeCloseTo(0.3 + COFFEE.amount);
    expect(m.state).toBe('empty');                // the bag went into that cup
  });

  it('a brewed cup waits for the player: walk off and it is still there', () => {
    const m = make();
    m.onInteract({});
    m.onUpdate(COFFEE.brewSeconds + 120);
    expect(m.state).toBe('brewed');
    m.onInteract({});
    expect(m.stamina.value).toBeCloseTo(0.3 + COFFEE.amount);
  });

  it('a bag docked on top is a cup to brew; [E] takes it off and brews: a bag a cup, no count of cups left (#168)', () => {
    const m = make();
    const bag = m.dock.bag;
    expect(m.loaded).toBe(true);
    expect(m.promptLabel).toBe('[E] Brew a coffee');
    m.onInteract({});
    expect(m.dock.detached).toEqual([[bag, { playSound: false }]]);   // off the top, quietly
    expect(m.items.taken).toEqual([[bag, undefined]]);                // put away, the press used up
    expect(m.loaded).toBe(false);
    m.onUpdate(COFFEE.brewSeconds + 0.1);
    m.onInteract({});
    m.onUpdate(0);
    expect(m.state).toBe('empty');
    expect(m.promptLabel).toBe('Needs ground coffee');

    m.onInteract({});
    m.onUpdate(COFFEE.brewSeconds * 2);
    m.onInteract({});
    expect(m.stamina.value).toBeCloseTo(0.3 + COFFEE.amount);   // nothing without coffee

    dockBag(m);                                             // the next bag set on it
    expect(m.state).toBe('ready');
  });

  it('a bag taken back off the top before brewing leaves it empty again', () => {
    const m = make();
    m.dock.bag = null;                                      // picked up again
    m.onUpdate(0.016);
    expect(m.state).toBe('empty');
  });

  it('with nothing to brew it says so, briefly and without a dash; with a bag in hand, to drop it on', () => {
    const m = make({}, { docked: false });
    expect(m.state).toBe('empty');
    expect(m.promptLabel).toBe('Needs ground coffee');
    m.items.inHand = true;
    m.onUpdate(0.016);
    expect(m.promptLabel).toBe('[E] Drop the coffee in');
    for (const label of [EMPTY_LABEL, '[E] Brew a coffee', '[E] Drop the coffee in']) {
      expect(label.length).toBeLessThan(25);
      expect(label).not.toMatch(/—|–/);
    }
  });

  it('takes a bag only while it is idle with none on it: never mid-brew or with a cup waiting', () => {
    const m = make();
    expect(m.accepts({ coffeeKind: 'bag' })).toBe(false);   // one on it already
    m.onInteract({});
    expect(m.accepts({ coffeeKind: 'bag' })).toBe(false);   // brewing
    m.onUpdate(COFFEE.brewSeconds + 0.1);
    expect(m.accepts({ coffeeKind: 'bag' })).toBe(false);   // a cup waiting
    m.onInteract({});
    m.onUpdate(0);
    expect(m.accepts({ coffeeKind: 'bag' })).toBe(true);
    expect(m.accepts({ coffeeKind: 'beans' })).toBe(false); // only ground coffee
  });

  it('tells the scene as a brew starts, as it is done and as it is drunk: hooks for its sounds', () => {
    const m = make();
    m.onBrew = vi.fn();
    m.onBrewed = vi.fn();
    m.onDrink = vi.fn();
    m.onInteract({});
    m.onInteract({});
    expect(m.onBrew).toHaveBeenCalledTimes(1);
    m.onUpdate(COFFEE.brewSeconds + 0.1);
    m.onUpdate(1);
    expect(m.onBrewed).toHaveBeenCalledTimes(1);
    m.onInteract({});
    m.onInteract({});
    expect(m.onDrink).toHaveBeenCalledTimes(1);
  });

  it('reset() leaves nothing brewing and nothing on it: a new or retried night', () => {
    const m = make();
    m.onInteract({});
    m.reset();
    expect(m.state).toBe('empty');
    m.onUpdate(COFFEE.brewSeconds + 1);
    expect(m.state).toBe('empty');
    const bag = dockBag(m);
    m.reset();                                 // a bag docked and not brewed: taken off, put away
    expect(m.dock.bag).toBeNull();
    expect(m.items.taken.at(-1)).toEqual([bag, { press: false }]);
    expect(m.state).toBe('empty');
  });

  it('shows its cup while one brews and while it waits to be drunk, filling as it brews', () => {
    const cup = { object3d: new THREE.Object3D(), setFill: vi.fn(), setPouring: vi.fn() };
    const m = make({ cup });
    const shown = () => cup.object3d.visible;
    const fill = () => cup.setFill.mock.lastCall[0];
    expect(shown()).toBe(false);                 // nothing on the tray to start

    m.onInteract({});
    expect(shown()).toBe(true);
    expect(fill()).toBe(0);
    m.onUpdate(COFFEE.brewSeconds / 2);
    expect(fill()).toBeCloseTo(0.5);
    m.onUpdate(COFFEE.brewSeconds);
    expect(m.state).toBe('brewed');
    expect(shown()).toBe(true);
    expect(fill()).toBe(1);

    m.onInteract({});                             // drunk
    m.onUpdate(0);
    expect(shown()).toBe(false);
    expect(m.state).toBe('empty');

    dockBag(m);
    m.onInteract({});
    m.reset();                                    // a retry mid-brew takes it away
    expect(shown()).toBe(false);
  });

  it('pours into the cup while it brews, and stops when it is done', () => {
    const cup = { object3d: new THREE.Object3D(), setFill: vi.fn(), setPouring: vi.fn() };
    const m = make({ cup });
    const pouring = () => cup.setPouring.mock.lastCall[0];
    expect(pouring()).toBe(false);
    m.onInteract({});
    expect(pouring()).toBe(true);
    m.onUpdate(COFFEE.brewSeconds + 0.1);
    expect(pouring()).toBe(false);
    m.onInteract({});
    m.onInteract({});
    m.reset();                                    // a retry mid-brew stops it too
    expect(pouring()).toBe(false);
  });

  it('with no stamina or coffee wired it does nothing', () => {
    const m = new CoffeeMachine();
    expect(() => m.onInteract({})).not.toThrow();
    expect(() => m.onUpdate(0.016)).not.toThrow();
    expect(() => m.reset()).not.toThrow();
    expect(m.state).toBe('empty');
    expect(m.loaded).toBe(false);
  });

  it('its screen shows the state across the room: green to use, amber brewing, red with no coffee', () => {
    const screen = new THREE.MeshStandardMaterial({ emissive: 0x000000 });
    const m = make({ screen });
    const lit = () => screen.emissive.getHex();
    expect(lit()).toBe(COFFEE.screen.ready);
    m.onInteract({});
    expect(lit()).toBe(COFFEE.screen.brewing);
    m.onUpdate(COFFEE.brewSeconds + 0.1);
    expect(lit()).toBe(COFFEE.screen.brewed);
    m.onInteract({});
    m.onUpdate(0);
    expect(lit()).toBe(COFFEE.screen.empty);
    dockBag(m);
    expect(lit()).toBe(COFFEE.screen.ready);

    expect(COFFEE.screen.brewing).not.toBe(COFFEE.screen.ready);
    expect(COFFEE.screen.empty).not.toBe(COFFEE.screen.ready);
    expect(COFFEE.screen.empty).not.toBe(COFFEE.screen.brewing);
  });
});
