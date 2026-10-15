import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { CoffeeMachine, COFFEE } from './CoffeeMachine.js';
import { Interactable } from './Interactable.js';

function make(opts) {
  const machine = new CoffeeMachine(opts);
  machine.stamina = { value: 0.3, restore(a) { this.value = Math.min(1, this.value + a); } };
  return machine;
}

/** Brew a cup, wait it out, drink it. */
function brewAndDrink(machine) {
  machine.onInteract({});
  machine.onUpdate(COFFEE.brewSeconds + 0.1);
  machine.onInteract({});
}

describe('CoffeeMachine', () => {
  it('a couple of cups a night, a real wait for each, about a third of the bar a cup', () => {
    expect(COFFEE.cups).toBe(2);
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
    expect(m.promptLabel).toBe('Brewing…');

    m.onInteract({});                         // nothing while it brews
    expect(m.stamina.value).toBe(0.3);
    m.onUpdate(COFFEE.brewSeconds - 0.1);
    expect(m.state).toBe('brewing');
    m.onUpdate(0.2);
    expect(m.state).toBe('brewed');
    expect(m.promptLabel).toBe('[E] Drink the coffee');
    expect(m.stamina.value).toBe(0.3);        // brewed, not drunk
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

  it('the cups run out for the night, and it says how many are left', () => {
    const m = make();
    expect(m.cups).toBe(COFFEE.cups);
    expect(m.promptLabel).toBe('[E] Brew a coffee (2 cups left)');
    brewAndDrink(m);
    expect(m.cups).toBe(1);
    expect(m.promptLabel).toBe('[E] Brew a coffee (1 cup left)');
    brewAndDrink(m);
    expect(m.cups).toBe(0);
    expect(m.state).toBe('empty');
    expect(m.promptLabel).toBe('Out of coffee tonight');

    m.onInteract({});
    m.onUpdate(COFFEE.brewSeconds * 2);
    m.onInteract({});
    expect(m.stamina.value).toBeCloseTo(0.3 + 2 * COFFEE.amount);
  });

  it('a cup is used as it starts brewing', () => {
    const m = make();
    m.onInteract({});
    expect(m.cups).toBe(COFFEE.cups - 1);
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

  it('reset() has a full rack and nothing brewing: a new or retried night', () => {
    const m = make();
    brewAndDrink(m);
    m.onInteract({});
    m.reset();
    expect(m.cups).toBe(COFFEE.cups);
    expect(m.state).toBe('ready');
    expect(m.promptLabel).toBe('[E] Brew a coffee (2 cups left)');
    m.onUpdate(COFFEE.brewSeconds + 1);
    expect(m.state).toBe('ready');
  });

  it('with no stamina wired it does nothing', () => {
    const m = new CoffeeMachine();
    expect(() => m.onInteract({})).not.toThrow();
    expect(m.state).toBe('ready');
    expect(m.cups).toBe(COFFEE.cups);
  });

  it('its screen shows the state across the room: green to use, amber brewing, red when out', () => {
    const screen = new THREE.MeshStandardMaterial({ emissive: 0x000000 });
    const m = make({ screen });
    const lit = () => screen.emissive.getHex();
    expect(lit()).toBe(COFFEE.screen.ready);
    m.onInteract({});
    expect(lit()).toBe(COFFEE.screen.brewing);
    m.onUpdate(COFFEE.brewSeconds + 0.1);
    expect(lit()).toBe(COFFEE.screen.brewed);
    m.onInteract({});
    brewAndDrink(m);
    expect(lit()).toBe(COFFEE.screen.empty);
    m.reset();
    expect(lit()).toBe(COFFEE.screen.ready);

    expect(COFFEE.screen.brewing).not.toBe(COFFEE.screen.ready);
    expect(COFFEE.screen.empty).not.toBe(COFFEE.screen.ready);
    expect(COFFEE.screen.empty).not.toBe(COFFEE.screen.brewing);
  });
});
