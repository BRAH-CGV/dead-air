import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { CoffeeMachine, COFFEE } from './CoffeeMachine.js';
import { Interactable } from './Interactable.js';
import { GameObject } from '../core/GameObject.js';
import { ImpactSound, IMPACT } from './ImpactSound.js';

/** A bag of ground coffee let go at `at` (world). */
const bagAt = at => {
  const object3d = new THREE.Object3D();
  object3d.position.set(...at);
  return { object3d };
};

/** Bags of ground coffee carried in (a CoffeeItems stand-in): `grounds` of
 *  them, each let go beside the machine in turn. */
const supply = (grounds, at = [0.3, 0.9, 0.4]) => ({
  grounds,
  taken: [],
  inHand: false,
  held(kind) { return kind === 'bag' && this.inHand ? {} : null; },
  loose(kind) { return kind === 'bag' && this.grounds > 0 ? [bagAt(at)] : []; },
  take(bag, opts) { this.taken.push([bag, opts]); this.grounds--; },
});

function make(opts, grounds = 2) {
  const go = new GameObject('CoffeeMachine');
  go.object3d.position.set(0, 1, 0);
  const machine = go.addComponent(new CoffeeMachine(opts));
  machine.stamina = { value: 0.3, restore(a) { this.value = Math.min(1, this.value + a); } };
  machine.items = supply(grounds);
  machine.onUpdate(0);                        // the scene's first frame: it sees what is in hand
  return machine;
}

/** Brew a cup, wait it out, drink it. */
function brewAndDrink(machine) {
  machine.onUpdate(0);                        // a bag let go beside it goes in
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
    expect(m.state).toBe('ready');
  });

  it('a brewed cup waits for the player: walk off and it is still there', () => {
    const m = make();
    m.onInteract({});
    m.onUpdate(COFFEE.brewSeconds + 120);
    expect(m.state).toBe('brewed');
    m.onInteract({});
    expect(m.stamina.value).toBeCloseTo(0.3 + COFFEE.amount);
  });

  it('takes a bag of ground coffee let go near it, then [E] brews it: a bag a cup, no count of cups left (#168)', () => {
    const m = make({}, 1);
    expect(m.promptLabel).toBe('[E] Brew a coffee');
    brewAndDrink(m);
    expect(m.items.taken).toHaveLength(1);          // the bag went in
    expect(m.items.taken[0][1]).toEqual({ press: false });   // on its own, not with a press
    expect(m.state).toBe('empty');
    expect(m.promptLabel).toBe('Needs ground coffee');

    m.onInteract({});
    m.onUpdate(COFFEE.brewSeconds * 2);
    m.onInteract({});
    expect(m.stamina.value).toBeCloseTo(0.3 + COFFEE.amount);   // nothing without coffee

    m.items.grounds = 1;                                    // back from the processor
    m.onUpdate(0.016);
    expect(m.state).toBe('ready');
    expect(m.promptLabel).toBe('[E] Brew a coffee');
  });

  it('with nothing to brew it says so, briefly and without a dash; with a bag in hand, to drop it in', () => {
    const m = make({}, 0);
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

  it('sounds the bag going in, from itself (the bag is gone)', () => {
    const go = new GameObject('CoffeeMachine');
    go.object3d.position.set(0, 1, 0);
    const intake = go.addComponent(new ImpactSound());
    const handle = vi.spyOn(intake, 'handle').mockImplementation(() => {});
    const m = go.addComponent(new CoffeeMachine());
    m.items = supply(1);
    m.onUpdate(0.016);
    expect(handle).toHaveBeenCalledWith(IMPACT.seatLevel);
  });

  it('leaves a bag let go away from it', () => {
    const go = new GameObject('CoffeeMachine');
    go.object3d.position.set(0, 1, 0);
    const m = go.addComponent(new CoffeeMachine());
    m.items = supply(1, [3, 0.1, 0]);
    m.onUpdate(0.016);
    expect(m.state).toBe('empty');
    expect(m.items.taken).toHaveLength(0);
  });

  it('a taken bag waits in it; [E] brews it, and it takes the next bag only once that cup is done', () => {
    const m = make();
    expect(m.state).toBe('ready');
    expect(m.items.grounds).toBe(1);               // one in, one still loose beside it
    m.onInteract({});
    m.onUpdate(1);
    expect(m.items.grounds).toBe(1);               // not while it brews
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

  it('reset() leaves nothing brewing: a new or retried night', () => {
    const m = make();
    brewAndDrink(m);
    m.onInteract({});
    m.items.grounds = 0;                       // a new night empties the player's hands
    m.reset();
    expect(m.state).toBe('empty');
    m.onUpdate(COFFEE.brewSeconds + 1);
    expect(m.state).toBe('empty');
    m.items.grounds = 1;
    m.reset();
    m.onUpdate(0);                             // a bag let go beside it again
    expect(m.state).toBe('ready');
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
    expect(shown()).toBe(false);
    brewAndDrink(m);
    expect(m.state).toBe('empty');
    expect(shown()).toBe(false);

    m.items.grounds = 1;
    m.reset();
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
    expect(m.state).toBe('empty');
    m.items = supply(1);
    m.onUpdate(0.016);
    m.onInteract({});
    expect(m.state).toBe('empty');                // no body to find bags round
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
    brewAndDrink(m);
    expect(lit()).toBe(COFFEE.screen.empty);
    m.items.grounds = 1;
    m.reset();
    m.onUpdate(0);
    expect(lit()).toBe(COFFEE.screen.ready);

    expect(COFFEE.screen.brewing).not.toBe(COFFEE.screen.ready);
    expect(COFFEE.screen.empty).not.toBe(COFFEE.screen.ready);
    expect(COFFEE.screen.empty).not.toBe(COFFEE.screen.brewing);
  });
});
