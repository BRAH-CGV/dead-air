import { describe, it, expect, vi } from 'vitest';
import { NightManager, DEFAULT_NIGHTS } from './NightManager.js';

/** Room stand-ins: NightManager only reads `name` and `doors`, and writes
 *  each door's `locked` and `lockedPrompt`. */
function door(targetRoom) {
  return { targetRoom, locked: false, lockedPrompt: '' };
}

function makeRooms() {
  return {
    MainOffice:     { name: 'MainOffice',     doors: [door('ServerRoom'), door('LivingQuarters'), door('Outside')] },
    ServerRoom:     { name: 'ServerRoom',     doors: [door('MainOffice')] },
    LivingQuarters: { name: 'LivingQuarters', doors: [door('MainOffice')] },
  };
}

const find = (rooms, room, target) => rooms[room].doors.find(d => d.targetRoom === target);

describe('NightManager', () => {
  it('starts at night 1', () => {
    expect(new NightManager().currentNight).toBe(1);
  });

  it('getOpenRooms(1) returns only MainOffice', () => {
    expect(new NightManager().getOpenRooms(1)).toEqual(['MainOffice']);
  });

  it('getOpenRooms(2) includes ServerRoom', () => {
    expect(new NightManager().getOpenRooms(2)).toEqual(expect.arrayContaining(['MainOffice', 'ServerRoom']));
    expect(new NightManager().getOpenRooms(2)).not.toContain('LivingQuarters');
  });

  it('getOpenRooms(3) opens everything, the outside included', () => {
    expect(new NightManager().getOpenRooms(3))
      .toEqual(expect.arrayContaining(['MainOffice', 'ServerRoom', 'LivingQuarters', 'Outside']));
  });

  it('getOpenRooms defaults to the current night and returns a copy', () => {
    const nights = new NightManager();
    const open = nights.getOpenRooms();
    open.push('Hacked');
    expect(nights.getOpenRooms()).toEqual(['MainOffice']);
    expect(DEFAULT_NIGHTS[1]).toEqual(['MainOffice']);
  });

  it('advance() increments the night and returns it', () => {
    const nights = new NightManager();
    expect(nights.advance()).toBe(2);
    expect(nights.currentNight).toBe(2);
  });

  it('advance() stops at the last night', () => {
    const nights = new NightManager({ startNight: 3 });
    expect(nights.advance()).toBe(3);
    expect(nights.maxNight).toBe(3);
  });

  it('emits a change (night, previous) on advance, not when clamped', () => {
    const nights = new NightManager({ startNight: 2 });
    const listener = vi.fn();
    const off = nights.onChange(listener);
    nights.advance();
    nights.advance();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(3, 2);

    off();
    nights.setNight(1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('setNight rejects a night with no config', () => {
    expect(() => new NightManager().setNight(7)).toThrow(/night 7/);
    expect(() => new NightManager({ startNight: 0 })).toThrow(/night 0/);
  });

  it('isOpen reports whether a room is open on a night', () => {
    const nights = new NightManager();
    expect(nights.isOpen('MainOffice')).toBe(true);
    expect(nights.isOpen('ServerRoom')).toBe(false);
    expect(nights.isOpen('ServerRoom', 2)).toBe(true);
  });

  it('firstNightOpen finds when a room (or a pair) first opens', () => {
    const nights = new NightManager();
    expect(nights.firstNightOpen('MainOffice')).toBe(1);
    expect(nights.firstNightOpen('ServerRoom')).toBe(2);
    expect(nights.firstNightOpen('MainOffice', 'LivingQuarters')).toBe(3);
    expect(nights.firstNightOpen('Nowhere')).toBeNull();
  });
});

describe('NightManager.applyTo', () => {
  it('night 1: every door out of the office is locked, at both ends', () => {
    const rooms = makeRooms();
    new NightManager().applyTo(rooms);
    expect(find(rooms, 'MainOffice', 'ServerRoom').locked).toBe(true);
    expect(find(rooms, 'MainOffice', 'LivingQuarters').locked).toBe(true);
    expect(find(rooms, 'MainOffice', 'Outside').locked).toBe(true);
    // The far end too: its own room is closed, even though it leads to an open one.
    expect(find(rooms, 'ServerRoom', 'MainOffice').locked).toBe(true);
  });

  it('night 2: the server room opens, the rest stay locked', () => {
    const rooms = makeRooms();
    new NightManager({ startNight: 2 }).applyTo(rooms);
    expect(find(rooms, 'MainOffice', 'ServerRoom').locked).toBe(false);
    expect(find(rooms, 'ServerRoom', 'MainOffice').locked).toBe(false);
    expect(find(rooms, 'MainOffice', 'LivingQuarters').locked).toBe(true);
    expect(find(rooms, 'MainOffice', 'Outside').locked).toBe(true);
  });

  it('night 3: everything is unlocked', () => {
    const rooms = makeRooms();
    new NightManager({ startNight: 3 }).applyTo(rooms);
    for (const room of Object.values(rooms)) {
      for (const d of room.doors) expect(d.locked, `${room.name}→${d.targetRoom}`).toBe(false);
    }
  });

  it('locked doors say which night they open', () => {
    const rooms = makeRooms();
    new NightManager().applyTo(rooms);
    expect(find(rooms, 'MainOffice', 'ServerRoom').lockedPrompt).toMatch(/night 2/i);
    expect(find(rooms, 'MainOffice', 'Outside').lockedPrompt).toMatch(/night 3/i);
  });

  it('accepts rooms as an array as well as a name map', () => {
    const rooms = makeRooms();
    new NightManager({ startNight: 2 }).applyTo(Object.values(rooms));
    expect(find(rooms, 'ServerRoom', 'MainOffice').locked).toBe(false);
  });

  it('re-applying after advance() unlocks the next room', () => {
    const rooms = makeRooms();
    const nights = new NightManager();
    nights.applyTo(rooms);
    nights.advance();
    nights.applyTo(rooms);
    expect(find(rooms, 'MainOffice', 'ServerRoom').locked).toBe(false);
  });

  it('a custom config drives the same logic', () => {
    const rooms = makeRooms();
    const nights = new NightManager({ config: { 1: ['MainOffice', 'LivingQuarters'] } });
    nights.applyTo(rooms);
    expect(find(rooms, 'MainOffice', 'LivingQuarters').locked).toBe(false);
    expect(find(rooms, 'MainOffice', 'ServerRoom').locked).toBe(true);
    expect(nights.maxNight).toBe(1);
  });
});
