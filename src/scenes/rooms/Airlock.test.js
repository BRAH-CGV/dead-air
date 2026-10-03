import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@dimforge/rapier3d', async () => (await import('../../test/fakeRapier.js')).rapierModule());

import { Airlock } from './Airlock.js';
import { makeEngine, pointLights } from '../../test/fakeRapier.js';
import { Interactable } from '../../components/Interactable.js';
import { EVASuit } from '../../components/EVASuit.js';
import { GameObject } from '../../core/GameObject.js';
import { Door } from '../../gameobjects/Door.js';

function childNames(room) {
  return room.root.children.map(c => c.name);
}

// The airlock is built at [2, 0, 6.6]: its open back end on z = 5.1 (the
// office's front wall face), the hatch at z = 8.1. Player spots, at the
// standing capsule's centre height:
const Y = 0.675;
const AT_LOCKER     = [1.7, Y, 6.85];   // in the chamber, in front of the suit locker
const IN_OFFICE     = [2,   Y, 4.0];    // looking in through the open inner door
const IN_INNER_DOOR = [2,   Y, 5.25];   // inside the footprint, but in the office doorway
const IN_HATCH_DOOR = [2,   Y, 7.8];    // inside the footprint, but in the hatch
const OUTSIDE       = [2,   Y, 9.5];

/** The office's front door — the airlock's inner door — where BaseScene
 *  puts it: in the office's front wall (centre line z = 5), 1 m wide. */
function officeDoor() {
  const door = new Door('Door:ToAirlock', { size: [1, 2.2, 0.2], targetRoom: 'Airlock' });
  door.object3d.position.set(2, 1.1, 5);
  return door;
}

/** A player carrying the suit (worn or not), standing at `at`. */
function playerAt(at) {
  const player = new GameObject('Player');
  player.object3d.position.set(...at);
  const suit = player.addComponent(new EVASuit());
  return { player, suit };
}

/** Advance the airlock by `seconds`, in 60 fps frames. */
function run(airlock, seconds) {
  const frames = Math.round(seconds * 60);
  for (let i = 0; i < frames; i++) airlock.update(1 / 60);
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

  it('cycles in a sensible time — long enough to read as an airlock, short enough not to be a chore', () => {
    expect(airlock.cycleTime).toBeGreaterThanOrEqual(1.5);
    expect(airlock.cycleTime).toBeLessThanOrEqual(4);
  });

  describe('interlock — the inner door and the hatch are never open together', () => {
    let inner, suit, use;

    beforeEach(() => {
      inner = officeDoor();
      airlock.bindInnerDoor(inner);
      ({ suit } = playerAt(AT_LOCKER));
      airlock.bindSuit(suit);
      use = airlock.root.find('SuitLocker').getComponent(Interactable);
    });

    it('starts pressurised: the inner door open, the hatch sealed', () => {
      expect(airlock.state).toBe('pressurised');
      expect(inner.locked).toBe(false);
      expect(airlock.hatch.locked).toBe(true);
    });

    it('suiting up shuts the inner door behind you at once; the hatch opens only once the airlock has cycled', () => {
      use.onInteract({});
      expect(suit.worn).toBe(true);
      expect(inner.locked).toBe(true);
      expect(airlock.hatch.locked).toBe(true);
      expect(airlock.state).toBe('depressurising');

      run(airlock, airlock.cycleTime - 0.1);
      expect(airlock.hatch.locked).toBe(true);

      run(airlock, 0.2);
      expect(airlock.state).toBe('depressurised');
      expect(airlock.hatch.locked).toBe(false);
      expect(inner.locked).toBe(true);
    });

    it('taking the suit off seals the hatch at once; the inner door opens only once the airlock has cycled', () => {
      use.onInteract({});
      run(airlock, airlock.cycleTime + 0.1);

      use.onInteract({});
      expect(suit.worn).toBe(false);
      expect(airlock.hatch.locked).toBe(true);
      expect(inner.locked).toBe(true);
      expect(airlock.state).toBe('pressurising');

      run(airlock, airlock.cycleTime - 0.1);
      expect(inner.locked).toBe(true);

      run(airlock, 0.2);
      expect(airlock.state).toBe('pressurised');
      expect(inner.locked).toBe(false);
      expect(airlock.hatch.locked).toBe(true);
    });

    it('never has both doors open on any frame of a round trip, reversals included', () => {
      const bothOpen = [];
      const wait = seconds => {
        for (let i = 0; i < Math.round(seconds * 60); i++) {
          airlock.update(1 / 60);
          if (!inner.locked && !airlock.hatch.locked) bothOpen.push(airlock.state);
        }
      };

      use.onInteract({}); wait(airlock.cycleTime + 0.5);   // out
      use.onInteract({}); wait(airlock.cycleTime / 2);     // back in, changed mind…
      use.onInteract({}); wait(airlock.cycleTime + 0.5);   // …out again
      use.onInteract({}); wait(airlock.cycleTime + 0.5);   // in

      expect(bothOpen).toEqual([]);
      expect(inner.locked).toBe(false);
    });

    it('reversing mid-cycle runs back only as far as the cycle had got', () => {
      use.onInteract({});                    // depressurising…
      run(airlock, 1);
      use.onInteract({});                    // …suit off again after 1 s
      expect(airlock.state).toBe('pressurising');

      run(airlock, 0.9);
      expect(inner.locked).toBe(true);
      run(airlock, 0.2);
      expect(inner.locked).toBe(false);
    });

    it('the beacon over the hatch is red while sealed, amber while cycling, green once it is open', () => {
      const { beacon } = airlock;
      const hue = () => { const hsl = {}; beacon.color.getHSL(hsl); return hsl.h * 360; };

      expect(hue()).toBeLessThan(15);                 // red
      use.onInteract({});
      expect(hue()).toBeGreaterThan(20);              // amber
      expect(hue()).toBeLessThan(60);
      run(airlock, airlock.cycleTime + 0.1);
      expect(hue()).toBeGreaterThan(90);              // green
      expect(hue()).toBeLessThan(150);
    });

    it('each shut door says why it is shut', () => {
      expect(airlock.hatch.lockedPrompt).toMatch(/put on the EVA suit/i);

      use.onInteract({});
      expect(airlock.hatch.lockedPrompt).toMatch(/cycling/i);
      expect(inner.lockedPrompt).toMatch(/cycling/i);

      run(airlock, airlock.cycleTime + 0.1);
      expect(inner.lockedPrompt).toMatch(/take off the EVA suit/i);

      use.onInteract({});
      expect(airlock.hatch.lockedPrompt).toMatch(/cycling/i);
      expect(inner.lockedPrompt).toMatch(/cycling/i);

      run(airlock, airlock.cycleTime + 0.1);
      expect(airlock.hatch.lockedPrompt).toMatch(/put on the EVA suit/i);
    });

    it('cycles for the suit however it changes, not only through the locker', () => {
      suit.putOn();
      expect(inner.locked).toBe(true);
      run(airlock, airlock.cycleTime + 0.1);
      expect(airlock.hatch.locked).toBe(false);
    });

    it("is driven by the room's own GameObject — the scene ticks it, nobody has to call update", () => {
      use.onInteract({});
      for (let i = 0; i < Math.round((airlock.cycleTime + 0.1) * 60); i++) airlock.root._update(1 / 60);
      expect(airlock.hatch.locked).toBe(false);
    });

    it('binding the inner door late still puts it in step', () => {
      use.onInteract({});
      const late = officeDoor();
      airlock.bindInnerDoor(late);
      expect(late.locked).toBe(true);
    });

    describe('readyFor — the door ahead waits for the side beyond it', () => {
      it('holds the hatch shut past the cycle time until the outside is ready', () => {
        let outsideReady = false;
        airlock.readyFor = side => side === 'outside' ? outsideReady : true;

        use.onInteract({});
        run(airlock, airlock.cycleTime + 1);
        expect(airlock.state).toBe('depressurising');
        expect(airlock.hatch.locked).toBe(true);
        expect(airlock.hatch.lockedPrompt).toBe('Airlock cycling…');

        outsideReady = true;
        run(airlock, 1 / 60);
        expect(airlock.state).toBe('depressurised');
        expect(airlock.hatch.locked).toBe(false);
      });

      it('holds the inner door shut on the way back in until the inside is ready', () => {
        let insideReady = true;
        airlock.readyFor = side => side === 'inside' ? insideReady : true;
        use.onInteract({});
        run(airlock, airlock.cycleTime + 0.1);

        insideReady = false;
        use.onInteract({});
        run(airlock, airlock.cycleTime + 1);
        expect(inner.locked).toBe(true);

        insideReady = true;
        run(airlock, 1 / 60);
        expect(airlock.state).toBe('pressurised');
        expect(inner.locked).toBe(false);
      });

      it('never cuts the cycle short — a side that is already ready still waits the cycle out', () => {
        airlock.readyFor = () => true;
        use.onInteract({});
        run(airlock, airlock.cycleTime - 0.1);
        expect(airlock.hatch.locked).toBe(true);
      });
    });

    it('onStateChange reports each new state, so the scene can swap what is drawn', () => {
      const states = [];
      airlock.onStateChange(state => states.push(state));
      use.onInteract({});
      run(airlock, airlock.cycleTime + 0.1);
      use.onInteract({});
      run(airlock, airlock.cycleTime + 0.1);
      expect(states).toEqual(['depressurising', 'depressurised', 'pressurising', 'pressurised']);
    });

    it('onStateChange returns an unsubscribe', () => {
      const listener = vi.fn();
      const off = airlock.onStateChange(listener);
      off();
      use.onInteract({});
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('the suit locker only works from inside the chamber', () => {
    let inner;

    beforeEach(() => {
      inner = officeDoor();
      airlock.bindInnerDoor(inner);
    });

    function tryLockerFrom(at) {
      const { player, suit } = playerAt(at);
      airlock.bindSuit(suit);
      airlock.update(0);
      const use = airlock.root.find('SuitLocker').getComponent(Interactable);
      use.onInteract({});
      return { player, suit, use };
    }

    it('in front of the locker: it offers the suit and hands it over', () => {
      const { suit, use } = tryLockerFrom(AT_LOCKER);
      expect(suit.worn).toBe(true);
      expect(use.promptLabel).toBe('[E] Take off EVA suit');
    });

    it.each([
      ['from the office, through the open inner door', IN_OFFICE],
      ['from the office doorway, where the inner door would shut on you', IN_INNER_DOOR],
      ['from the hatch doorway', IN_HATCH_DOOR],
      ['from outside', OUTSIDE],
    ])('not %s', (_what, at) => {
      const { suit, use } = tryLockerFrom(at);
      expect(suit.worn).toBe(false);
      expect(inner.locked).toBe(false);
      expect(use.promptLabel).not.toMatch(/\[E\]/);
      expect(use.promptLabel).toMatch(/step into the airlock/i);
    });

    it('the label comes back once the player steps in', () => {
      const { player, use } = tryLockerFrom(IN_OFFICE);
      player.object3d.position.set(...AT_LOCKER);
      airlock.update(0);
      expect(use.promptLabel).toBe('[E] Put on EVA suit');
    });

    it('does nothing for a suit nobody is wearing (not on a player)', () => {
      const suit = new EVASuit();
      airlock.bindSuit(suit);
      airlock.update(0);
      airlock.root.find('SuitLocker').getComponent(Interactable).onInteract({});
      expect(suit.worn).toBe(false);
    });
  });

  it('binding a suit that is already on settles straight to depressurised: hatch open, inner door shut', () => {
    const inner = officeDoor();
    airlock.bindInnerDoor(inner);
    const { suit } = playerAt(AT_LOCKER);
    suit.putOn();
    airlock.bindSuit(suit);
    expect(airlock.state).toBe('depressurised');
    expect(airlock.hatch.locked).toBe(false);
    expect(inner.locked).toBe(true);
    expect(airlock.root.find('SuitLocker').getComponent(Interactable).promptLabel).toBe('[E] Take off EVA suit');
  });

  it('works without an inner door bound — the hatch still waits for the cycle', () => {
    const { suit } = playerAt(AT_LOCKER);
    airlock.bindSuit(suit);
    suit.putOn();
    expect(airlock.hatch.locked).toBe(true);
    run(airlock, airlock.cycleTime + 0.1);
    expect(airlock.hatch.locked).toBe(false);
  });

  it('rebinding lets go of the previous suit', () => {
    const first = playerAt(AT_LOCKER).suit;
    airlock.bindSuit(first);
    airlock.bindSuit(playerAt(AT_LOCKER).suit);
    first.putOn();
    run(airlock, airlock.cycleTime + 0.1);
    expect(airlock.hatch.locked).toBe(true);
  });

  it('the locker does nothing (and does not throw) with no suit bound', () => {
    const use = airlock.root.find('SuitLocker').getComponent(Interactable);
    expect(() => use.onInteract({})).not.toThrow();
    expect(() => airlock.update(1 / 60)).not.toThrow();
    expect(airlock.hatch.locked).toBe(true);
  });

  it('has the ceiling light plus a hatch beacon over the hatch', () => {
    const lights = pointLights(airlock);
    expect(lights.length).toBe(2);
    const { beacon } = airlock;
    expect(lights).toContain(beacon);
    expect(beacon.position.z).toBeGreaterThan(1);   // over the hatch
    expect(beacon.color.r).toBeGreaterThan(beacon.color.g);
  });

  it('dispose lets go of the suit and the inner door, and removes its bodies', () => {
    const inner = officeDoor();
    airlock.bindInnerDoor(inner);
    const { suit } = playerAt(AT_LOCKER);
    airlock.bindSuit(suit);
    const hatch = airlock.hatch;
    airlock.dispose();
    expect(() => suit.putOn()).not.toThrow();
    expect(() => airlock.update(10)).not.toThrow();
    expect(hatch.locked).toBe(true);                // no longer listening
    expect(inner.locked).toBe(false);               // the office's door, left as it was
    expect(engine.world.bodies.len()).toBe(0);
  });
});
