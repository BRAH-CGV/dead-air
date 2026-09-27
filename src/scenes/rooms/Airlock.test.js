import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@dimforge/rapier3d', async () => (await import('../../test/fakeRapier.js')).rapierModule());

import { Airlock } from './Airlock.js';
import { makeEngine, pointLights } from '../../test/fakeRapier.js';
import { Interactable } from '../../components/Interactable.js';
import { EVASuit } from '../../components/EVASuit.js';

function childNames(room) {
  return room.root.children.map(c => c.name);
}

describe('Airlock', () => {
  let engine, airlock;

  beforeEach(() => {
    engine = makeEngine();
    airlock = new Airlock(engine, { position: [2, 0, 6.6] });
    airlock.build();
  });

  it('is a room (tracked like one), 3 m long along z', () => {
    // kind 'Room', not 'Corridor': standing in the airlock is a place the
    // player can be, and RoomTransitionSystem names it.
    expect(airlock.root.name).toBe('Room:Airlock');
    expect(airlock.axis).toBe('z');
    expect([airlock.length, airlock.corridorWidth, airlock.height]).toEqual([3, 2.4, 3]);
  });

  it('is open at the back, where it butts onto the office front wall, and has a hatch doorway at the front', () => {
    const names = childNames(airlock);
    expect(names.some(n => n.startsWith('BackWall'))).toBe(false);
    expect(names).toEqual(expect.arrayContaining(['FrontWall_A', 'FrontWall_B', 'FrontWall_Header']));
  });

  it('the hatch leads Outside, at the far end, and is sealed until the suit is on', () => {
    expect(airlock.doors.length).toBe(1);
    const { hatch } = airlock;
    expect(hatch).toBe(airlock.doors[0]);
    expect(hatch.name).toBe('Door:ToOutside');
    expect(hatch.targetRoom).toBe('Outside');
    expect(hatch.object3d.position.z).toBeCloseTo(1.5);
    expect(hatch.doorSize[0]).toBeCloseTo(1.1);
    expect(hatch.locked).toBe(true);
    expect(hatch.lockedPrompt).toMatch(/EVA suit/);
  });

  it('keeps the suit in a locker against the left wall, facing into the airlock', () => {
    expect(engine.spawnModel).toHaveBeenCalledWith('model:locker', expect.objectContaining({ name: 'SuitLocker' }));
    const locker = airlock.root.find('SuitLocker');
    expect(locker).not.toBeNull();
    expect(engine._rootObjects).not.toContain(locker);
    expect(locker.object3d.position.x).toBeLessThan(-0.6);        // clear of the 1.1 m hatch line
    expect(locker.object3d.rotation.y).toBeCloseTo(Math.PI / 2);  // front (+Z) turned to +X
  });

  it('the locker is a raycastable Interactable offering the suit', () => {
    const locker = airlock.root.find('SuitLocker');
    const use = locker.getComponent(Interactable);
    expect(use).not.toBeNull();
    expect(engine._bodyToGO.get(locker.rigidBody.handle)).toBe(locker);
    expect(use.promptLabel).toBe('[E] Put on EVA suit');
  });

  it('with a suit bound: the locker toggles it, the hatch and the prompt follow', () => {
    const suit = new EVASuit();
    airlock.bindSuit(suit);
    const use = airlock.root.find('SuitLocker').getComponent(Interactable);

    use.onInteract({});
    expect(suit.worn).toBe(true);
    expect(airlock.hatch.locked).toBe(false);
    expect(use.promptLabel).toBe('[E] Take off EVA suit');

    use.onInteract({});
    expect(suit.worn).toBe(false);
    expect(airlock.hatch.locked).toBe(true);
    expect(use.promptLabel).toBe('[E] Put on EVA suit');
  });

  it('the hatch follows the suit however it changes, not only through the locker', () => {
    const suit = new EVASuit();
    airlock.bindSuit(suit);
    suit.putOn();
    expect(airlock.hatch.locked).toBe(false);
  });

  it('binding a suit that is already on opens the hatch straight away', () => {
    const suit = new EVASuit();
    suit.putOn();
    airlock.bindSuit(suit);
    expect(airlock.hatch.locked).toBe(false);
    expect(airlock.root.find('SuitLocker').getComponent(Interactable).promptLabel).toBe('[E] Take off EVA suit');
  });

  it('rebinding lets go of the previous suit', () => {
    const first = new EVASuit();
    airlock.bindSuit(first);
    airlock.bindSuit(new EVASuit());
    first.putOn();
    expect(airlock.hatch.locked).toBe(true);
  });

  it('the locker does nothing (and does not throw) with no suit bound', () => {
    const use = airlock.root.find('SuitLocker').getComponent(Interactable);
    expect(() => use.onInteract({})).not.toThrow();
    expect(airlock.hatch.locked).toBe(true);
  });

  it('has the ceiling light plus a hatch beacon: red while sealed, green once the suit is on', () => {
    const lights = pointLights(airlock);
    expect(lights.length).toBe(2);
    const { beacon } = airlock;
    expect(lights).toContain(beacon);
    expect(beacon.position.z).toBeGreaterThan(1);   // over the hatch
    expect(beacon.color.r).toBeGreaterThan(beacon.color.g);

    const suit = new EVASuit();
    airlock.bindSuit(suit);
    suit.putOn();
    expect(beacon.color.g).toBeGreaterThan(beacon.color.r);
  });

  it('dispose lets go of the suit and removes its bodies', () => {
    const suit = new EVASuit();
    airlock.bindSuit(suit);
    const hatch = airlock.hatch;
    airlock.dispose();
    expect(() => suit.putOn()).not.toThrow();
    expect(hatch.locked).toBe(true);                // no longer listening
    expect(engine.world.bodies.len()).toBe(0);
  });
});
