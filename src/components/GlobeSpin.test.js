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

  it('counts its pushes, at top speed too (for its sound)', () => {
    expect(spin.pushes).toBe(0);
    for (let i = 0; i < 5; i++) spin.onInteract({});
    expect(spin.speed).toBe(spin.maxSpeed);
    expect(spin.pushes).toBe(5);
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

describe('GlobeSpin — spammed, it turns to cheese (#169)', () => {
  let globe, spin, model;

  beforeEach(() => {
    globe = new GameObject('Globe');
    model = new THREE.Mesh(new THREE.SphereGeometry(0.143), new THREE.MeshBasicMaterial());
    globe.object3d.add(model);                      // the globe's own model
    spin = globe.addComponent(new GlobeSpin());
  });

  /** Mash E `presses` times, `perSecond` a second. */
  function mash(presses, perSecond) {
    for (let i = 0; i < presses; i++) {
      spin.onInteract({});
      run(spin, 1 / perSecond);
    }
  }

  it('an ordinary push or two, even a few at top speed, leaves it a globe', () => {
    mash(6, 4);
    run(spin, 20);
    mash(6, 4);
    expect(spin.cheese).toBe(false);
    expect(model.visible).toBe(true);
  });

  it('pushes spaced out at top speed never wind it up: the strain wears off', () => {
    for (let i = 0; i < 60; i++) { spin.onInteract({}); run(spin, 1); }
    expect(spin.cheese).toBe(false);
  });

  it('mashed at top speed for a few seconds, it becomes a ball of cheese', () => {
    mash(40, 8);
    expect(spin.cheese).toBe(true);
    expect(model.visible).toBe(false);              // the globe gone…
    const ball = globe.object3d.getObjectByName('CheeseBall');
    expect(ball).toBeTruthy();                      // …cheese in its place, spinning with it
    expect(ball.parent).toBe(globe.object3d);
    expect(spin.promptLabel).toMatch(/\[E\].*cheese/i);
  });

  it('pops in rather than appearing: it overshoots its size and settles on it', () => {
    for (let i = 0; i < 80 && !spin.cheese; i++) { spin.onInteract({}); run(spin, 1 / 8); }
    expect(spin.cheese).toBe(true);
    const ball = globe.object3d.getObjectByName('CheeseBall');
    let biggest = 0;
    for (let i = 0; i < 60; i++) { spin.onUpdate(1 / 60); biggest = Math.max(biggest, ball.scale.x); }
    expect(biggest).toBeGreaterThan(1.05);
    expect(ball.scale.x).toBeCloseTo(1, 6);
  });

  it('stays cheese, and still spins', () => {
    mash(40, 8);
    run(spin, 30);
    expect(spin.cheese).toBe(true);
    const before = globe.object3d.quaternion.clone();
    spin.onInteract({});
    run(spin, 0.2);
    expect(globe.object3d.quaternion.angleTo(before)).toBeGreaterThan(0.1);
  });

  it('frees the cheese it built when it is destroyed', () => {
    mash(40, 8);
    const ball = globe.object3d.getObjectByName('CheeseBall');
    let freed = 0;
    ball.traverse((o) => { if (o.isMesh) o.geometry.addEventListener('dispose', () => freed++); });
    spin.onDestroy();
    expect(freed).toBeGreaterThan(0);
  });
});
