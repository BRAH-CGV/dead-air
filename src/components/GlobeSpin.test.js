import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { GlobeSpin, GLOBE_AXIS } from './GlobeSpin.js';
import { Interactable } from './Interactable.js';
import { GameObject } from '../core/GameObject.js';

/** Run the component for `seconds`, in 60 fps frames. */
function run(spin, seconds) {
  for (let i = 0; i < Math.round(seconds * 60); i++) spin.onUpdate(1 / 60);
}

describe('GlobeSpin', () => {
  let globe, spin;

  beforeEach(() => {
    globe = new GameObject('Globe');
    globe.object3d.rotation.y = Math.PI / 4;      // however the room turned it
    spin = globe.addComponent(new GlobeSpin());
  });

  it('is an Interactable the player can use: it says what E does', () => {
    expect(globe.getComponent(Interactable)).toBe(spin);
    expect(spin.promptLabel).toMatch(/\[E\].*globe/i);
  });

  it('sits still until it is used', () => {
    const before = globe.object3d.quaternion.clone();
    run(spin, 1);
    expect(globe.object3d.quaternion.equals(before)).toBe(true);
    expect(spin.spinning).toBe(false);
  });

  it('E sets it spinning, and it slows to a stop by itself: a little spin, about a turn', () => {
    spin.onInteract({});
    expect(spin.spinning).toBe(true);

    let turned = 0, last = spin.speed;
    for (let i = 0; i < 60 * 12 && spin.spinning; i++) {
      turned += spin.speed / 60;
      spin.onUpdate(1 / 60);
      expect(spin.speed).toBeLessThan(last);       // only ever slowing
      last = spin.speed;
    }
    expect(spin.spinning).toBe(false);             // stopped within 12 s
    expect(turned).toBeGreaterThan(Math.PI);       // more than half a turn
    expect(turned).toBeLessThan(Math.PI * 4);      // less than two
  });

  it('turns about the globe\'s own tilted axis, on top of how the room turned it', () => {
    const rest = globe.object3d.quaternion.clone();
    spin.onInteract({});
    run(spin, 0.5);

    // What it has turned through since rest, in the globe's own space.
    const delta = rest.clone().invert().multiply(globe.object3d.quaternion);
    const angle = 2 * Math.acos(Math.min(1, Math.abs(delta.w)));
    expect(angle).toBeGreaterThan(0.5);
    const axis = new THREE.Vector3(delta.x, delta.y, delta.z).normalize().multiplyScalar(Math.sign(delta.w) || 1);
    const pole = new THREE.Vector3(...GLOBE_AXIS).normalize();
    expect(axis.dot(pole)).toBeCloseTo(1, 4);       // west to east about the pole
    expect(pole.y).toBeGreaterThan(0.9);            // a tilt, not a tumble
    expect(Math.abs(pole.x)).toBeGreaterThan(0.2);
  });

  it('the globe never leaves its stand: only its turn changes', () => {
    globe.object3d.position.set(1.5, 1.1, -2.35);
    spin.onInteract({});
    run(spin, 2);
    expect(globe.object3d.position.toArray()).toEqual([1.5, 1.1, -2.35]);
    expect(globe.object3d.scale.toArray()).toEqual([1, 1, 1]);
  });

  it('another push while it spins adds to it, up to a limit — mashing E can\'t wind it up forever', () => {
    spin.onInteract({});
    const one = spin.speed;
    spin.onInteract({});
    expect(spin.speed).toBeGreaterThan(one);
    for (let i = 0; i < 50; i++) spin.onInteract({});
    expect(spin.speed).toBeLessThanOrEqual(spin.maxSpeed);
  });

  it('comes to rest wherever it stopped, and spins on from there next time', () => {
    spin.onInteract({});
    run(spin, 12);
    const stopped = globe.object3d.quaternion.clone();
    run(spin, 1);
    expect(globe.object3d.quaternion.equals(stopped)).toBe(true);
    spin.onInteract({});
    run(spin, 0.1);
    expect(globe.object3d.quaternion.angleTo(stopped)).toBeGreaterThan(0.05);
    expect(globe.object3d.quaternion.angleTo(stopped)).toBeLessThan(1.5);   // no jump back to the start
  });
});
