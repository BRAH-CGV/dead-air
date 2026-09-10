import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createMarsSky, directionFromAngles } from './MarsSky.js';

// ─────────────────────────────────────────────
// MarsSky  –  procedural night sky
// ─────────────────────────────────────────────
// Construction and wiring only. What the shader actually paints needs a real
// GL context, so the gradient and starfield are checked by eye in the browser
// — the same line Fullbright.test.js draws between material types and pixels.

const findMesh = (go, name) => go.object3d.children.find(c => c.name === name);

describe('createMarsSky structure', () => {
  it('returns a group so the level editor treats it as a container', () => {
    // Non-group objects get a measured bounding box in the editor's save
    // format, and an 800 m box reloads as a giant grey placeholder.
    expect(createMarsSky().isGroup).toBe(true);
  });

  it('builds the dome with an unlit, non-fogged backside shader', () => {
    const dome = findMesh(createMarsSky(), 'MarsSkyDome');

    expect(dome.geometry.parameters.radius).toBe(400);
    expect(dome.material).toBeInstanceOf(THREE.ShaderMaterial);
    expect(dome.material.side).toBe(THREE.BackSide);
    // Fullbright only swaps lit materials, and FogExp2 would otherwise wash
    // a 400 m dome into a flat blob.
    expect(dome.material.fog).toBe(false);
  });

  it('carries both moons as their own GameObjects', () => {
    const names = createMarsSky().children.map(c => c.name);
    expect(names).toEqual(['Phobos', 'Deimos']);
  });

  it('exposes the uniforms so they stay tunable after construction', () => {
    const sky = createMarsSky({ horizonColor: 0x112233 });
    expect(sky.skyUniforms.uHorizonColor.value).toBeInstanceOf(THREE.Color);
    expect(sky.skyUniforms.uHorizonColor.value.getHex()).toBe(0x112233);
    expect(sky.skyUniforms.uTime.value).toBe(0);
  });

  it('passes options through to the dome', () => {
    const sky = createMarsSky({ radius: 250 });
    expect(findMesh(sky, 'MarsSkyDome').geometry.parameters.radius).toBe(250);
  });
});

describe('moon aiming', () => {
  // The whole "keep the moons framed in the window" requirement rests on this
  // convention, so pin it down: azimuth 0° looks out the window (−Z).
  it('azimuth 0, elevation 0 points straight out the window', () => {
    const dir = directionFromAngles(0, 0);
    expect(dir.x).toBeCloseTo(0);
    expect(dir.y).toBeCloseTo(0);
    expect(dir.z).toBeCloseTo(-1);
  });

  it('positive azimuth swings right, positive elevation swings up', () => {
    expect(directionFromAngles(90, 0).x).toBeCloseTo(1);
    expect(directionFromAngles(-90, 0).x).toBeCloseTo(-1);
    expect(directionFromAngles(0, 90).y).toBeCloseTo(1);
  });

  it('places a moon just inside the dome, in its aimed direction', () => {
    const sky  = createMarsSky({ radius: 100, phobos: { azimuth: 0, elevation: 0 } });
    const moon = sky.find('Phobos').object3d.children[0];

    expect(moon.position.z).toBeCloseTo(-95);
    expect(moon.position.x).toBeCloseTo(0);
  });

  it('keeps both default moons inside the window opening', () => {
    // Mid-room the window spans roughly ±41° across and −13°..+14° up.
    for (const name of ['Phobos', 'Deimos']) {
      const moon = createMarsSky().find(name).object3d.children[0];
      const azimuth   = THREE.MathUtils.radToDeg(Math.atan2(moon.position.x, -moon.position.z));
      const elevation = THREE.MathUtils.radToDeg(
        Math.asin(moon.position.y / moon.position.length()),
      );

      expect(Math.abs(azimuth)).toBeLessThan(41);
      expect(elevation).toBeGreaterThan(0);
      expect(elevation).toBeLessThan(14);
    }
  });
});
