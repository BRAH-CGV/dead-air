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
    // Gates the DITHERING define; without it the dark gradient quantises into
    // visible bands, and the shader's dithering chunks compile to nothing.
    expect(dome.material.dithering).toBe(true);
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

describe('star field', () => {
  const starsOf = (sky) => findMesh(sky, 'MarsSkyStars');

  it('builds the requested number of stars as an additive point cloud', () => {
    const stars = starsOf(createMarsSky({ starCount: 1200 }));

    expect(stars.isPoints).toBe(true);
    expect(stars.geometry.getAttribute('position').count).toBe(1200);
    expect(stars.material.blending).toBe(THREE.AdditiveBlending);
    expect(stars.material.depthWrite).toBe(false);
  });

  it('carries a twinkle phase and a magnitude per star', () => {
    const stars = starsOf(createMarsSky({ starCount: 500 }));

    expect(stars.geometry.getAttribute('aPhase').count).toBe(500);
    expect(stars.geometry.getAttribute('aMagnitude').count).toBe(500);
  });

  it('places every star on one sphere, beyond the moons', () => {
    const sky   = createMarsSky({ radius: 400, starCount: 300 });
    const stars = starsOf(sky);
    const pos   = stars.geometry.getAttribute('position');
    const moon  = moonBody(sky, 'Phobos').position.length();

    for (let i = 0; i < pos.count; i++) {
      const r = new THREE.Vector3().fromBufferAttribute(pos, i).length();
      expect(r).toBeCloseTo(392, 2);
      expect(r).toBeGreaterThan(moon);
    }
  });

  // The regression this file exists for. The old field hashed a 3D lattice and
  // rendered concentric rings, because a cell's star only survived when the
  // cell centre sat at the right radius. Equal-area bands catch that: uniform
  // dispersion puts a proportional share of stars in each band, and any
  // latitude-structured artifact skews the counts.
  it('disperses stars evenly across equal-area latitude bands', () => {
    const pos   = starsOf(createMarsSky({ starCount: 8000 })).geometry.getAttribute('position');
    const bands = [0, 0, 0, 0];

    for (let i = 0; i < pos.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(pos, i);
      // Equal height slices are equal area on a sphere, so each band should
      // hold a quarter of the stars.
      bands[Math.min(3, Math.floor((v.y / v.length() + 1) * 2))] += 1;
    }

    // Expect 2000 each; ±20% is roughly 9 sigma, so this fails on structure
    // rather than on an unlucky seed.
    for (const count of bands) {
      expect(count).toBeGreaterThan(1600);
      expect(count).toBeLessThan(2400);
    }
  });

  it('shares uTime with the star material, so SkyFollow drives the twinkle', () => {
    // skyUniforms is spread from two materials' uniform objects. Spreading
    // copies references, so this holds — but a stray clone here would leave
    // the stars frozen with no error anywhere.
    const sky = createMarsSky();
    sky.skyUniforms.uTime.value = 12.5;

    expect(starsOf(sky).material.uniforms.uTime.value).toBe(12.5);
  });

  it('does not bunch stars around the poles', () => {
    // Sampling the polar ANGLE uniformly instead of the height is the classic
    // way to get this wrong, and it crowds stars into caps at each pole.
    const pos = starsOf(createMarsSky({ starCount: 8000 })).geometry.getAttribute('position');
    let nearPole = 0;

    for (let i = 0; i < pos.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(pos, i);
      if (Math.abs(v.y / v.length()) > 0.9) nearPole += 1;
    }

    // |y| > 0.9 is 10% of the sphere's area, so ~800 of 8000.
    expect(nearPole).toBeGreaterThan(600);
    expect(nearPole).toBeLessThan(1000);
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

  it('frames Deimos from mid-room and puts Phobos above it, up the glass', () => {
    // The window spans roughly ±41° across. Vertically the ceiling depends on
    // where the player stands: the opening tops out 1.225 m above eye height,
    // so it is ~14° from mid-room (4.8 m back) and ~31° from 2 m away.
    //
    // The two moons straddle that on purpose. Deimos stays inside the mid-room
    // box, so a moon is always in the window. Phobos sits above it and only
    // comes into view as the player walks up to the glass.
    const ceiling = { Phobos: 31, Deimos: 14 };

    for (const [name, limit] of Object.entries(ceiling)) {
      const moon = moonBody(createMarsSky(), name);
      const azimuth   = THREE.MathUtils.radToDeg(Math.atan2(moon.position.x, -moon.position.z));
      const elevation = THREE.MathUtils.radToDeg(
        Math.asin(moon.position.y / moon.position.length()),
      );

      expect(Math.abs(azimuth)).toBeLessThan(41);
      expect(elevation).toBeGreaterThan(0);
      expect(elevation).toBeLessThan(limit);
    }

    // And the ordering itself, which is the point of the arrangement.
    const high = moonBody(createMarsSky(), 'Phobos').position;
    const low  = moonBody(createMarsSky(), 'Deimos').position;
    expect(high.y / high.length()).toBeGreaterThan(low.y / low.length());
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
