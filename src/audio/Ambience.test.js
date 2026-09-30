import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { Ambience, INSIDE, OUTSIDE, MIX } from './Ambience.js';

describe('Ambience', () => {
  let audio, transitions, player, airlock, ambience;

  const rooms = {
    MainOffice:     { name: 'MainOffice' },
    ServerRoom:     { name: 'ServerRoom' },
    LivingQuarters: { name: 'LivingQuarters' },
  };
  /** A corridor running along +x past x = 10. */
  const corridor = { containsPoint: p => p.x > 10 };

  const at = (room, x = 0) => {
    transitions.currentRoom = room;
    player.position.x = x;
    ambience.onUpdate(1 / 60);
    return { ...audio.ambience };
  };

  beforeEach(() => {
    audio = {
      ambience: { bed: null, room: null },
      ambienceVolume: { bed: 0.5, room: 0.5 },
      setAmbience(key, channel = 'room') { this.ambience[channel] = key; },
    };
    transitions = { currentRoom: null };
    player = new THREE.Object3D();
    airlock = { name: 'Airlock', state: 'pressurised' };
    ambience = new Ambience({ audio, transitions, corridors: [corridor], player, airlock });
  });

  it("sets the mix: the recording is the bed, each room's tone sits quieter over it", () => {
    expect(audio.ambienceVolume).toEqual(MIX);
    expect(MIX.room).toBeLessThan(MIX.bed);
  });

  it("in a room, the base's machinery under the room's own tone", () => {
    expect(at(rooms.MainOffice)).toEqual({ bed: INSIDE, room: 'amb:office' });
    expect(at(rooms.ServerRoom)).toEqual({ bed: INSIDE, room: 'amb:server-room' });
    expect(at(rooms.LivingQuarters)).toEqual({ bed: INSIDE, room: 'amb:quarters' });
    expect(at(airlock)).toEqual({ bed: INSIDE, room: 'amb:airlock' });
  });

  it("in a corridor, still indoors: the machinery and the corridor's hollow air", () => {
    expect(at(null, 12)).toEqual({ bed: INSIDE, room: 'amb:corridor' });
  });

  it('outside, only the wind', () => {
    expect(at(null, 0)).toEqual({ bed: OUTSIDE, room: null });
  });

  it('the airlock lets the wind in while its hatch stands open, and shuts it out again', () => {
    airlock.state = 'depressurising';
    expect(at(airlock).bed).toBe(INSIDE);
    airlock.state = 'depressurised';
    expect(at(airlock)).toEqual({ bed: OUTSIDE, room: 'amb:airlock' });
    airlock.state = 'pressurising';
    expect(at(airlock).bed).toBe(INSIDE);
  });

  it('a room with no tone of its own keeps just the machinery', () => {
    expect(at({ name: 'Storage' })).toEqual({ bed: INSIDE, room: null });
  });

  it('the beds are the two recordings', () => {
    expect(INSIDE).toBe('amb:base-interior');
    expect(OUTSIDE).toBe('amb:outside-wind');
  });
});
