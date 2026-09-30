import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { shouldRefreshShadow, ShadowRefresh } from './ShadowRefresh.js';

const rad = THREE.MathUtils.degToRad;
/** A unit vector `deg` degrees round from +Z, in the ground plane. */
const dir = deg => new THREE.Vector3(Math.sin(rad(deg)), 0, Math.cos(rad(deg)));

describe('shouldRefreshShadow', () => {
  it('holds while the light has turned less than the threshold', () => {
    expect(shouldRefreshShadow(dir(0), dir(0), rad(0.25))).toBe(false);
    expect(shouldRefreshShadow(dir(0), dir(0.2), rad(0.25))).toBe(false);
  });

  it('asks for a new shadow once it has turned past it', () => {
    expect(shouldRefreshShadow(dir(0), dir(0.3), rad(0.25))).toBe(true);
    expect(shouldRefreshShadow(dir(10), dir(-10), rad(0.25))).toBe(true);
    expect(shouldRefreshShadow(dir(0), dir(180), rad(0.25))).toBe(true);
  });

  it('asks for one when no shadow has been drawn yet (a zero direction)', () => {
    expect(shouldRefreshShadow(new THREE.Vector3(), dir(0), rad(0.25))).toBe(true);
  });
});

describe('ShadowRefresh', () => {
  let light, parent, caster, refresh;

  /** What three does after it draws a light's shadow. */
  const drawn = () => { light.shadow.needsUpdate = false; };
  const tick = () => refresh.onLateUpdate(1 / 60);

  beforeEach(() => {
    light = new THREE.PointLight();
    light.castShadow = true;
    parent = new THREE.Object3D();
    caster = new THREE.Object3D();
    parent.add(caster);
    refresh = new ShadowRefresh({ lights: [light], casters: [caster] });
  });

  it('stops the light redrawing its shadow every frame, but asks for the first one', () => {
    expect(light.shadow.autoUpdate).toBe(false);
    expect(light.shadow.needsUpdate).toBe(true);
  });

  it('asks for nothing while nothing moves', () => {
    drawn();
    tick();
    tick();
    expect(light.shadow.needsUpdate).toBe(false);
  });

  it('asks for a new shadow when a caster moves or turns, once per change', () => {
    drawn();
    caster.position.x = 1;
    tick();
    expect(light.shadow.needsUpdate).toBe(true);
    drawn();
    tick();
    expect(light.shadow.needsUpdate).toBe(false);
    caster.rotation.y = 1;
    tick();
    expect(light.shadow.needsUpdate).toBe(true);
  });

  it('sees a caster carried by its parent', () => {
    drawn();
    parent.position.z = 2;
    tick();
    expect(light.shadow.needsUpdate).toBe(true);
  });

  it('asks for a new shadow when a caster appears or disappears', () => {
    drawn();
    caster.visible = false;
    tick();
    expect(light.shadow.needsUpdate).toBe(true);
    drawn();
    tick();
    expect(light.shadow.needsUpdate).toBe(false);
    caster.visible = true;
    tick();
    expect(light.shadow.needsUpdate).toBe(true);
  });

  it('watches casters added later, from where they are when added', () => {
    const late = new THREE.Object3D();
    late.position.set(3, 0, 0);
    refresh.watch(late);
    drawn();
    tick();
    expect(light.shadow.needsUpdate).toBe(false);
    late.position.y = 1;
    tick();
    expect(light.shadow.needsUpdate).toBe(true);
  });

  it('skips a missing caster (a part a model did not have)', () => {
    expect(() => refresh.watch(null)).not.toThrow();
    drawn();
    tick();
    expect(light.shadow.needsUpdate).toBe(false);
  });

  it('flag() asks every light for a new shadow by hand', () => {
    const moon = new THREE.DirectionalLight();
    refresh = new ShadowRefresh({ lights: [light, moon] });
    drawn();
    moon.shadow.needsUpdate = false;
    refresh.flag();
    expect(light.shadow.needsUpdate).toBe(true);
    expect(moon.shadow.needsUpdate).toBe(true);
  });

  it('release() hands the lights back to redrawing every frame', () => {
    refresh.release();
    expect(light.shadow.autoUpdate).toBe(true);
  });
});
