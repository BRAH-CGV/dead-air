import { describe, it, expect, beforeEach, vi } from 'vitest';

// Door.js imports Rapier; these tests never create a body, so an empty
// stand-in is enough (the WASM build doesn't load under vitest here).
vi.mock('@dimforge/rapier3d', () => ({ default: {} }));

import { RoomTransitionSystem } from './RoomTransitionSystem.js';
import { Door } from '../gameobjects/Door.js';
import { GameObject } from '../core/GameObject.js';

const SIZE = [1, 2.2, 0.2];

function makeDoor(name, position, opts = {}) {
  const door = new Door(name, { size: SIZE, ...opts });
  door.object3d.position.set(...position);
  door.onPlayerEnter = vi.fn();
  door.onPlayerExit  = vi.fn();
  return door;
}

function fakePrompt() {
  return {
    text: '', visible: false,
    show(t) { this.text = t; this.visible = true; },
    hide()  { this.visible = false; },
  };
}

/** Minimal room stand-in: an x-range. RoomTransitionSystem only needs
 *  `name` and `containsPoint`. */
function fakeRoom(name, minX, maxX) {
  return { name, containsPoint: p => p.x >= minX && p.x <= maxX };
}

describe('RoomTransitionSystem', () => {
  let player, prompt;

  beforeEach(() => {
    player = new GameObject('Player');
    prompt = fakePrompt();
  });

  function attach(opts) {
    const sys = player.addComponent(new RoomTransitionSystem({ prompt, ...opts }));
    return sys;
  }

  function moveTo(sys, x, y, z) {
    player.object3d.position.set(x, y, z);
    sys.onUpdate(1 / 60);
  }

  it('detects overlap with an unlocked door — enter once, exit once', () => {
    const door = makeDoor('Door:A', [2, 1.1, 5]);
    const sys = attach({ doors: [door] });

    moveTo(sys, 0, 1, 0);
    expect(door.onPlayerEnter).not.toHaveBeenCalled();

    moveTo(sys, 2, 1, 5);
    moveTo(sys, 2, 1, 5.05);
    expect(door.onPlayerEnter).toHaveBeenCalledTimes(1);
    expect(door.onPlayerEnter).toHaveBeenCalledWith(player);

    moveTo(sys, 2, 1, 7);
    expect(door.onPlayerExit).toHaveBeenCalledTimes(1);
    expect(prompt.visible).toBe(false);
  });

  it('a locked door keeps its solid collider state and is detected on approach', () => {
    const door = makeDoor('Door:A', [2, 1.1, 5], { locked: true });
    const sys = attach({ doors: [door], approachMargin: 0.75 });

    // The player can't stand inside a solid door, so a locked door counts
    // the approach zone around it.
    moveTo(sys, 2, 1, 5.6);
    expect(door.onPlayerEnter).toHaveBeenCalledTimes(1);
    expect(door.locked).toBe(true);
  });

  it('a locked door shows its prompt, and hides it when the player leaves', () => {
    const door = makeDoor('Door:A', [2, 1.1, 5], { locked: true });
    door.lockedPrompt = 'Opens on night 2';
    const sys = attach({ doors: [door] });

    moveTo(sys, 2, 1, 5.5);
    expect(prompt.visible).toBe(true);
    expect(prompt.text).toBe('Opens on night 2');

    moveTo(sys, 2, 1, 9);
    expect(prompt.visible).toBe(false);
  });

  it('an unlocked door shows no prompt', () => {
    const door = makeDoor('Door:A', [2, 1.1, 5]);
    const sys = attach({ doors: [door] });
    moveTo(sys, 2, 1, 5);
    expect(prompt.visible).toBe(false);
  });

  it('hides the prompt when the door is unlocked while the player is at it', () => {
    const door = makeDoor('Door:A', [2, 1.1, 5], { locked: true });
    const sys = attach({ doors: [door] });
    moveTo(sys, 2, 1, 5.5);
    expect(prompt.visible).toBe(true);

    door.locked = false;
    moveTo(sys, 2, 1, 5.5);
    expect(prompt.visible).toBe(false);
  });

  it('tracks the current room and fires onRoomChange on transitions', () => {
    const office = fakeRoom('MainOffice', -6, 6);
    const server = fakeRoom('ServerRoom', 10, 16);
    const sys = attach({ rooms: [office, server] });
    const changes = [];
    sys.onRoomChange = (room, prev) => changes.push([room?.name ?? null, prev?.name ?? null]);

    moveTo(sys, 0, 1, 0);
    moveTo(sys, 1, 1, 0);          // same room — no event
    moveTo(sys, 8, 1, 0);          // corridor — between rooms
    moveTo(sys, 12, 1, 0);
    expect(sys.currentRoom).toBe(server);
    expect(changes).toEqual([
      ['MainOffice', null],
      [null, 'MainOffice'],
      ['ServerRoom', null],
    ]);
  });

  it('addDoors / addRooms register more after construction', () => {
    const sys = attach({});
    const door = makeDoor('Door:A', [0, 1.1, 0]);
    sys.addDoors([door]);
    sys.addRooms([fakeRoom('R', -1, 1)]);
    moveTo(sys, 0, 1, 0);
    expect(door.onPlayerEnter).toHaveBeenCalledTimes(1);
    expect(sys.currentRoom.name).toBe('R');
  });
});
