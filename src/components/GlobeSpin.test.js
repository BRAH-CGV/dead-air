import { describe, it, expect, beforeEach, vi } from 'vitest';
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

describe('GlobeSpin — the poof as it turns (#169)', () => {
  function cheese(opts = {}) {
    const globe = new GameObject('Globe');
    globe.object3d.add(new THREE.Mesh(new THREE.SphereGeometry(0.143), new THREE.MeshBasicMaterial()));
    const spin = globe.addComponent(new GlobeSpin(opts));
    for (let i = 0; i < 80 && !spin.cheese; i++) { spin.onInteract({}); run(spin, 1 / 8); }
    return { globe, spin };
  }

  it('a cloud bursts round it as it turns, and is gone again after', () => {
    const { globe, spin } = cheese();
    const poof = globe.object3d.getObjectByName('CloudPoof');
    expect(poof).toBeTruthy();
    expect(poof.visible).toBe(true);
    run(spin, 2);
    expect(poof.visible).toBe(false);
  });

  it('the cloud stays upright and doesn\'t spin with the cheese', () => {
    const { globe, spin } = cheese();
    globe.object3d.updateMatrixWorld(true);
    const poof = globe.object3d.getObjectByName('CloudPoof');
    const before = poof.getWorldQuaternion(new THREE.Quaternion());
    run(spin, 0.1);
    globe.object3d.updateMatrixWorld(true);
    expect(globe.object3d.quaternion.angleTo(new THREE.Quaternion())).toBeGreaterThan(0.1);   // the globe turned…
    expect(poof.getWorldQuaternion(new THREE.Quaternion()).angleTo(before)).toBeLessThan(1e-6); // …the cloud didn't
  });

  it('a comic POOF on the screen where the globe is, when it is in view', () => {
    const screen = vi.fn();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.set(0, 0, 2);
    camera.updateMatrixWorld();
    const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) };
    const { spin } = cheese({ screenPoof: screen, view: () => ({ camera, canvas }) });
    expect(spin.cheese).toBe(true);
    expect(screen).toHaveBeenCalledTimes(1);
    const [x, y] = screen.mock.calls[0];
    expect(x).toBeCloseTo(400, 0);                  // the globe at the middle of the view
    expect(y).toBeCloseTo(300, 0);
  });

  it('no POOF when the globe is behind the view', () => {
    const screen = vi.fn();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.set(0, 0, 2);
    camera.lookAt(0, 0, 10);                        // looking away
    camera.updateMatrixWorld();
    const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) };
    cheese({ screenPoof: screen, view: () => ({ camera, canvas }) });
    expect(screen).not.toHaveBeenCalled();
  });
});

describe('GlobeSpin — the cheese mashed again', () => {
  const quiet = { screenPoof: () => {}, screenFlash: () => {} };
  /** Mash at 8 presses a second until `done`, or 160 presses; how many it took. */
  function mashUntil(spin, done) {
    let presses = 0;
    for (; presses < 160 && !done(); presses++) { spin.onInteract({}); run(spin, 1 / 8); }
    return presses;
  }
  function cheese(opts = {}) {
    const globe = new GameObject('Globe');
    globe.object3d.add(new THREE.Mesh(new THREE.SphereGeometry(0.143), new THREE.MeshBasicMaterial()));
    const spin = globe.addComponent(new GlobeSpin({ ...quiet, ...opts }));
    mashUntil(spin, () => spin.cheese);
    return { globe, spin };
  }
  const blowUp = spin => mashUntil(spin, () => spin.blasted);

  it('turning to cheese starts the strain again from nothing', () => {
    const { spin } = cheese();
    expect(spin.strain).toBeLessThan(1);
    expect(spin.blasted).toBe(false);
  });

  it('a spin or two of the cheese leaves it be', () => {
    const { spin } = cheese();
    run(spin, 10);
    for (let i = 0; i < 6; i++) { spin.onInteract({}); run(spin, 1 / 4); }
    run(spin, 10);
    expect(spin.blasted).toBe(false);
  });

  it('mashed the same way the globe was, it goes off', () => {
    const globe = new GameObject('Globe');
    const fresh = globe.addComponent(new GlobeSpin(quiet));
    const toCheese = mashUntil(fresh, () => fresh.cheese);
    run(fresh, 30);
    expect(blowUp(fresh)).toBe(toCheese);
    expect(fresh.blasted).toBe(true);
  });

  it('the cheese goes, and the blast goes off where it was', () => {
    const { globe, spin } = cheese();
    blowUp(spin);
    expect(globe.object3d.getObjectByName('CheeseBall').visible).toBe(false);
    const blast = globe.object3d.getObjectByName('CheeseBlast');
    expect(blast).toBeTruthy();
    expect(blast.visible).toBe(true);
    expect(spin.promptLabel).toBe('');
  });

  it('flares the screen at once; onBlast follows blackAfter later, once', () => {
    const flash = vi.fn();
    const onBlast = vi.fn();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.set(0, 0, 2);
    camera.updateMatrixWorld();
    const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) };
    const { spin } = cheese({ screenFlash: flash, view: () => ({ camera, canvas }), blackAfter: 0.2 });
    spin.onBlast = onBlast;
    for (let i = 0; i < 160 && !spin.blasted; i++) {
      spin.onInteract({});
      if (!spin.blasted) run(spin, 1 / 8);
    }
    expect(flash).toHaveBeenCalledTimes(1);
    expect(onBlast).not.toHaveBeenCalled();
    run(spin, 0.15);
    expect(onBlast).not.toHaveBeenCalled();
    run(spin, 0.1);
    expect(onBlast).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 20; i++) spin.onInteract({});
    run(spin, 5);
    expect(onBlast).toHaveBeenCalledTimes(1);
  });

  it('flares the screen from its middle when the globe is behind the view', () => {
    const flash = vi.fn();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.set(0, 0, 2);
    camera.lookAt(0, 0, 10);
    camera.updateMatrixWorld();
    const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) };
    const { spin } = cheese({ screenFlash: flash, view: () => ({ camera, canvas }) });
    blowUp(spin);
    expect(flash).toHaveBeenCalledWith(400, 300);
  });

  it('gone off, E does nothing more', () => {
    const { spin } = cheese();
    blowUp(spin);
    const pushes = spin.pushes;
    spin.onInteract({});
    expect(spin.pushes).toBe(pushes);
    expect(spin.speed).toBe(0);
  });
});
