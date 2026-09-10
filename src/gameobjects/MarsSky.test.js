import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { createMarsSky, directionFromAngles } from './MarsSky.js';

// ─────────────────────────────────────────────
// MarsSky  –  procedural night sky
// ─────────────────────────────────────────────
// Construction and wiring only. What the shader actually paints needs a real
// GL context, so the gradient and starfield are checked by eye in the browser
// — the same line Fullbright.test.js draws between material types and pixels.

const findMesh = (go, name) => go.object3d.children.find(c => c.name === name);

/** The moon's body, ignoring the halo quad sitting alongside it. */
const moonBody = (sky, name) => findMesh(sky.find(name), name);

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

describe('star sizing', () => {
  // A star wider than its hash cell is clipped at the boundary and renders as
  // a hard-edged wedge rather than a dot, which is what a "broken sky" looks
  // like. The defaults must stay on the right side of that.
  it('keeps default stars inside their own hash cell', () => {
    const { uStarSize, uStarDensity } = createMarsSky().skyUniforms;
    expect(uStarSize.value).toBeLessThanOrEqual(0.25 / uStarDensity.value);
  });

  it('warns when an override would clip stars at cell edges', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    createMarsSky({ starDensity: 100, starSize: 0.02 });

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('starSize'));
    warn.mockRestore();
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
    const moon = moonBody(sky, 'Phobos');

    expect(moon.position.z).toBeCloseTo(-95);
    expect(moon.position.x).toBeCloseTo(0);
  });

  it('keeps both default moons inside the window opening', () => {
    // The window spans roughly ±41° across. Vertically it depends on where the
    // player stands: ~14° from mid-room, ~31° up close, so the ceiling here is
    // "visible from the near half of the room", not "visible from anywhere".
    for (const name of ['Phobos', 'Deimos']) {
      const moon = moonBody(createMarsSky(), name);
      const azimuth   = THREE.MathUtils.radToDeg(Math.atan2(moon.position.x, -moon.position.z));
      const elevation = THREE.MathUtils.radToDeg(
        Math.asin(moon.position.y / moon.position.length()),
      );

      expect(Math.abs(azimuth)).toBeLessThan(41);
      expect(elevation).toBeGreaterThan(0);
      expect(elevation).toBeLessThan(25);
    }
  });
});

describe('moon materials', () => {
  it('opts the moon bodies out of fog', () => {
    // At sky distance FogExp2 resolves to ~100% fog colour, so a fogged moon
    // renders as a flat dark disc sitting inside its own halo.
    for (const name of ['Phobos', 'Deimos']) {
      expect(moonBody(createMarsSky(), name).material.fog).toBe(false);
    }
  });

  it('tints the two moons differently so they do not read as one moon twice', () => {
    const sky = createMarsSky();
    const phobos = moonBody(sky, 'Phobos').material.color;
    const deimos = moonBody(sky, 'Deimos').material.color;

    expect(phobos.getHex()).not.toBe(deimos.getHex());
  });
});

describe('moon glow', () => {
  it('gives each moon an additive halo wider than its body', () => {
    const sky  = createMarsSky();
    const body = moonBody(sky, 'Phobos');
    const halo = findMesh(sky.find('Phobos'), 'PhobosGlow');

    expect(halo.material.blending).toBe(THREE.AdditiveBlending);
    expect(halo.material.depthWrite).toBe(false);
    expect(halo.geometry.parameters.width).toBeGreaterThan(body.geometry.parameters.radius * 2);
  });

  it('sits beyond the moon so the body occludes the middle of the halo', () => {
    const sky = createMarsSky();
    const body = moonBody(sky, 'Phobos');
    const halo = findMesh(sky.find('Phobos'), 'PhobosGlow');

    expect(halo.position.length()).toBeGreaterThan(body.position.length());
  });

  it('faces the sky origin, which SkyFollow keeps pinned to the camera', () => {
    const halo = findMesh(createMarsSky().find('Phobos'), 'PhobosGlow');
    // The quad's +Z normal should point back at the origin it was aimed at.
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(halo.quaternion);
    const toOrigin = halo.position.clone().negate().normalize();

    expect(normal.dot(toOrigin)).toBeCloseTo(1);
  });

  it('omits the halo when a moon asks for no glow', () => {
    const sky = createMarsSky({ deimos: { glow: 0 } });
    expect(findMesh(sky.find('Deimos'), 'DeimosGlow')).toBeUndefined();
    expect(moonBody(sky, 'Deimos')).toBeDefined();
  });
});
