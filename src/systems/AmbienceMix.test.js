import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { AmbienceMix } from './AmbienceMix.js';

// ─────────────────────────────────────────────
// A cut-down base, west to east along x:
//
//   quarters [-10,-4] ── passage [-4,0] ── office [0,6] ── passage [6,10] ── server [10,16]
//
// plus a stub passage off the office's front (z) that leads nowhere.
// ─────────────────────────────────────────────

const box = (x0, x1, z0 = -2, z1 = 2) =>
  new THREE.Box3(new THREE.Vector3(x0, 0, z0), new THREE.Vector3(x1, 3, z1));

const at = (x, z = 0, y = 1) => new THREE.Vector3(x, y, z);

function base({ outside = null } = {}) {
  return new AmbienceMix({
    zones: [
      { box: box(-10, -4), track: 'bed' },
      { box: box(0, 6),    track: 'centre' },
      { box: box(10, 16),  track: 'server' },
    ],
    passages: [
      { box: box(-4, 0),  axis: 'x' },
      { box: box(6, 10),  axis: 'x' },
      { box: box(2, 4, 2, 6), axis: 'z' },   // office → nothing
    ],
    outside,
  });
}

describe('AmbienceMix', () => {
  it('plays only the room you are standing in', () => {
    const mix = base();
    expect(mix.weightsAt(at(3))).toEqual({ bed: 0, centre: 1, server: 0 });
    expect(mix.weightsAt(at(13))).toEqual({ bed: 0, centre: 0, server: 1 });
    expect(mix.weightsAt(at(-7))).toEqual({ bed: 1, centre: 0, server: 0 });
  });

  it('lists every track once, the outside one included', () => {
    expect(base().tracks).toEqual(['bed', 'centre', 'server']);
    expect(base({ outside: 'wind' }).tracks).toEqual(['bed', 'centre', 'server', 'wind']);
  });

  it('blends the two rooms a passage joins, by how far along it you are', () => {
    const mix = base();
    const mid = mix.weightsAt(at(8));
    expect(mid.centre).toBeCloseTo(Math.SQRT1_2);
    expect(mid.server).toBeCloseTo(Math.SQRT1_2);
    expect(mid.bed).toBe(0);

    const near = mix.weightsAt(at(7));
    expect(near.centre).toBeGreaterThan(near.server);
  });

  it('keeps the loudness level through a passage (equal power)', () => {
    const mix = base();
    for (let x = 6; x <= 10; x += 0.25) {
      const w = mix.weightsAt(at(x));
      expect(w.centre ** 2 + w.server ** 2, `x = ${x}`).toBeCloseTo(1);
    }
  });

  it('meets each room at its doorway without a jump', () => {
    const mix = base();
    expect(mix.weightsAt(at(6.001)).centre).toBeCloseTo(1, 2);
    expect(mix.weightsAt(at(6.001)).server).toBeCloseTo(0, 2);
    expect(mix.weightsAt(at(9.999)).server).toBeCloseTo(1, 2);
    expect(mix.weightsAt(at(9.999)).centre).toBeCloseTo(0, 2);
  });

  it('reads a passage the same way whichever side its rooms are on', () => {
    // The west passage runs quarters → office; the east one office → server.
    const w = base().weightsAt(at(-3));
    expect(w.bed).toBeGreaterThan(w.centre);
    expect(w.server).toBe(0);
  });

  it('is silent outside while there is no outside track', () => {
    expect(base().weightsAt(at(40))).toEqual({ bed: 0, centre: 0, server: 0 });
    // On the roof is outside too.
    expect(base().weightsAt(at(3, 0, 5))).toEqual({ bed: 0, centre: 0, server: 0 });
  });

  it('plays the outside track everywhere that is not the base', () => {
    const mix = base({ outside: 'wind' });
    expect(mix.weightsAt(at(40))).toEqual({ bed: 0, centre: 0, server: 0, wind: 1 });
    expect(mix.weightsAt(at(3)).wind).toBe(0);
  });

  it('fades a passage that opens on nothing toward the outside', () => {
    const silent = base().weightsAt(at(3, 4));
    expect(silent.centre).toBeCloseTo(Math.SQRT1_2);

    const windy = base({ outside: 'wind' }).weightsAt(at(3, 4));
    expect(windy.centre).toBeCloseTo(Math.SQRT1_2);
    expect(windy.wind).toBeCloseTo(Math.SQRT1_2);
  });

  it('holds one track steady through a passage with the same room sound at both ends', () => {
    const mix = new AmbienceMix({
      zones: [{ box: box(0, 4), track: 'hum' }, { box: box(8, 12), track: 'hum' }],
      passages: [{ box: box(4, 8), axis: 'x' }],
    });
    expect(mix.weightsAt(at(6))).toEqual({ hum: 1 });
  });

  it('follows a zone whose track is changed, as a door lets another sound in', () => {
    const chamber = { box: box(20, 24), track: 'centre' };
    const mix = new AmbienceMix({
      zones: [{ box: box(0, 6), track: 'centre' }, chamber],
      outside: 'wind',
    });
    expect(mix.weightsAt(at(22))).toEqual({ centre: 1, wind: 0 });

    chamber.track = 'wind';
    expect(mix.weightsAt(at(22))).toEqual({ centre: 0, wind: 1 });
    // The room that shares the track is untouched.
    expect(mix.weightsAt(at(3))).toEqual({ centre: 1, wind: 0 });
  });

  it('writes into the object it is given, so a frame allocates nothing', () => {
    const mix = base();
    const out = {};
    expect(mix.weightsAt(at(3), out)).toBe(out);
    mix.weightsAt(at(13), out);
    expect(out).toEqual({ bed: 0, centre: 0, server: 1 });
  });
});
