import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { WallClock, clockHandAngles } from './WallClock.js';
import { NightClock } from '../gameplay/NightClock.js';

// ─────────────────────────────────────────────
// clockHandAngles — the maths, clockwise from 12
// ─────────────────────────────────────────────

describe('clockHandAngles', () => {
  it('points both hands at 12 at midnight, and at noon', () => {
    expect(clockHandAngles(0)).toEqual({ hour: 0, minute: 0 });
    expect(clockHandAngles(12)).toEqual({ hour: 0, minute: 0 });
  });

  it('3:00 — hour hand a quarter turn round, minute hand on 12', () => {
    const { hour, minute } = clockHandAngles(3);
    expect(hour).toBeCloseTo(Math.PI / 2);
    expect(minute).toBeCloseTo(0);
  });

  it('4:30 — hour hand halfway between 4 and 5, minute hand on 6', () => {
    const { hour, minute } = clockHandAngles(4.5);
    expect(hour).toBeCloseTo(3 * Math.PI / 4);
    expect(minute).toBeCloseTo(Math.PI);
  });
});

// ─────────────────────────────────────────────
// WallClock — the object on the wall
// ─────────────────────────────────────────────

describe('WallClock', () => {
  const hands = (clock) => ({
    hour:   clock.object3d.getObjectByName('HourHand'),
    minute: clock.object3d.getObjectByName('MinuteHand'),
  });

  it('is a GameObject named WallClock with an hour and a minute hand', () => {
    const clock = new WallClock();
    expect(clock.name).toBe('WallClock');
    const { hour, minute } = hands(clock);
    expect(hour).toBeDefined();
    expect(minute).toBeDefined();
  });

  it('the minute hand is the longer one', () => {
    const { hour, minute } = hands(new WallClock());
    const length = (o) => new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3()).y;
    expect(length(minute)).toBeGreaterThan(length(hour));
  });

  it('faces +Z, so it reads from inside a room when hung on a back wall', () => {
    const clock = new WallClock();
    const face = clock.object3d.getObjectByName('ClockFace');
    const box = new THREE.Box3().setFromObject(clock.object3d);
    const { hour } = hands(clock);
    // Hands sit in front of the face — toward +Z.
    expect(hour.getWorldPosition(new THREE.Vector3()).z)
      .toBeGreaterThan(face.getWorldPosition(new THREE.Vector3()).z);
    // Thin: it hangs on a wall rather than standing out from it.
    expect(box.max.z - box.min.z).toBeLessThan(0.1);
  });

  it('turns its hands clockwise as seen from the front', () => {
    const clock = new WallClock();
    clock.showTime(4.5);
    const { hour, minute } = hands(clock);
    // Positive rotation.z is anticlockwise looking down −Z, so clockwise is negative.
    expect(hour.rotation.z).toBeCloseTo(-3 * Math.PI / 4);
    expect(minute.rotation.z).toBeCloseTo(-Math.PI);
  });

  it('follows the NightClock it is given, frame by frame', () => {
    const clock = new WallClock();
    const night = new NightClock({ startHour: 0, nightDuration: 300 });
    clock.clock = night;

    night.update(150);           // 3:00 AM
    clock._update(0.016);
    expect(hands(clock).hour.rotation.z).toBeCloseTo(-Math.PI / 2);
    expect(hands(clock).minute.rotation.z).toBeCloseTo(0);
  });

  it('sits at 12:00 until it has a clock to read', () => {
    const clock = new WallClock();
    expect(() => clock._update(0.016)).not.toThrow();
    expect(hands(clock).hour.rotation.z).toBe(0);
  });

  it('has no collider — it is flat on the wall', () => {
    expect(new WallClock().rigidBody ?? null).toBeNull();
  });

  it('dispose frees every geometry and material it made', () => {
    const clock = new WallClock();
    const resources = new Set();
    clock.object3d.traverse(o => {
      if (o.isMesh) { resources.add(o.geometry); resources.add(o.material); }
    });
    expect(resources.size).toBeGreaterThan(0);

    const freed = new Set();
    for (const r of resources) r.addEventListener('dispose', () => freed.add(r));
    clock.dispose();
    expect(freed.size).toBe(resources.size);
  });
});
