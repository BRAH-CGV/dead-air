import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { ShadowScheduler } from './ShadowScheduler.js';

// ─────────────────────────────────────────────
// ShadowScheduler  –  render shadow maps only when something changed
// ─────────────────────────────────────────────
// The renderer clears `shadow.needsUpdate` after it draws a map; `rendered()`
// below stands in for that frame.

function scene() {
  const root = new THREE.Scene();
  const moon = new THREE.DirectionalLight();
  moon.position.set(0, 10, 10);
  moon.castShadow = true;
  root.add(moon, moon.target);

  const lamp = new THREE.PointLight();
  lamp.position.set(0, 2.5, 0);
  lamp.castShadow = true;
  root.add(lamp);

  const fill = new THREE.PointLight();       // no shadow — not ours to manage
  root.add(fill);

  root.updateMatrixWorld(true);
  return { root, moon, lamp, fill };
}

/** The renderer's side: it draws every flagged map and clears the flag. */
function rendered(...lights) {
  for (const l of lights) l.shadow.needsUpdate = false;
}

describe('ShadowScheduler', () => {
  it('freezes every shadow-casting light, after one first render', () => {
    const { root, moon, lamp, fill } = scene();
    new ShadowScheduler().adopt(root);

    for (const light of [moon, lamp]) {
      expect(light.shadow.autoUpdate).toBe(false);
      expect(light.shadow.needsUpdate).toBe(true);
    }
    expect(fill.shadow.autoUpdate).toBe(true);
  });

  it('leaves a frozen map alone while nothing moves', () => {
    const { root, moon, lamp } = scene();
    const shadows = new ShadowScheduler();
    shadows.adopt(root);
    rendered(moon, lamp);

    shadows.update();
    shadows.update();
    expect(moon.shadow.needsUpdate).toBe(false);
    expect(lamp.shadow.needsUpdate).toBe(false);
  });

  it('re-renders a directional light once it has turned past the threshold, not for every hair', () => {
    const { root, moon, lamp } = scene();
    const shadows = new ShadowScheduler({ angle: THREE.MathUtils.degToRad(0.5) });
    shadows.adopt(root);
    rendered(moon, lamp);

    // ~0.1° — under the threshold.
    moon.position.applyAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(0.1));
    shadows.update();
    expect(moon.shadow.needsUpdate).toBe(false);

    // Another 0.6° on top — the total since the last render counts.
    moon.position.applyAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(0.6));
    shadows.update();
    expect(moon.shadow.needsUpdate).toBe(true);
    expect(lamp.shadow.needsUpdate).toBe(false);   // only the light that moved
  });

  it('measures from the last render, so a slow drift still lands', () => {
    const { root, moon, lamp } = scene();
    const shadows = new ShadowScheduler({ angle: THREE.MathUtils.degToRad(0.5) });
    shadows.adopt(root);
    rendered(moon, lamp);

    let flagged = 0;
    for (let i = 0; i < 20; i++) {
      moon.position.applyAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(0.1));
      shadows.update();
      if (moon.shadow.needsUpdate) { flagged++; rendered(moon); }
    }
    expect(flagged).toBeGreaterThanOrEqual(3);     // 2° in 0.5° steps
    expect(flagged).toBeLessThanOrEqual(4);
  });

  it('re-renders a point light that moves', () => {
    const { root, moon, lamp } = scene();
    const shadows = new ShadowScheduler();
    shadows.adopt(root);
    rendered(moon, lamp);

    lamp.position.x += 0.5;
    shadows.update();
    expect(lamp.shadow.needsUpdate).toBe(true);
  });

  it('invalidate() re-renders every map once — a door shut, a zone swapped', () => {
    const { root, moon, lamp } = scene();
    const shadows = new ShadowScheduler();
    shadows.adopt(root);
    rendered(moon, lamp);

    shadows.invalidate();
    expect(moon.shadow.needsUpdate).toBe(true);
    expect(lamp.shadow.needsUpdate).toBe(true);
  });

  it('watch() re-renders the given lights while a shadow caster moves', () => {
    const { root, moon, lamp } = scene();
    const dish = new THREE.Object3D();
    root.add(dish);
    const shadows = new ShadowScheduler();
    shadows.adopt(root);
    shadows.watch(dish, [moon]);
    rendered(moon, lamp);

    shadows.update();
    expect(moon.shadow.needsUpdate).toBe(false);   // still

    dish.rotation.y += 0.2;
    shadows.update();
    expect(moon.shadow.needsUpdate).toBe(true);
    expect(lamp.shadow.needsUpdate).toBe(false);
  });

  it('adopting the same scene twice does not double-track', () => {
    const { root } = scene();
    const shadows = new ShadowScheduler();
    shadows.adopt(root);
    shadows.adopt(root);
    expect(shadows.lights).toHaveLength(2);
  });

  it('release() hands every light back to per-frame updates', () => {
    const { root, moon, lamp } = scene();
    const shadows = new ShadowScheduler();
    shadows.adopt(root);
    shadows.release();
    expect(moon.shadow.autoUpdate).toBe(true);
    expect(lamp.shadow.autoUpdate).toBe(true);
    expect(shadows.lights).toHaveLength(0);
  });
});
