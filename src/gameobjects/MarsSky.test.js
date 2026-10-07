import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  createMarsSky, directionFromAngles, milkyWayFrame, celestialPole, DEFAULT_MOONS,
} from './MarsSky.js';

// ─────────────────────────────────────────────
// MarsSky  –  procedural night sky
// ─────────────────────────────────────────────
// Construction and wiring only. What the shader actually paints needs a real
// GL context, so the gradient and starfield are checked by eye in the browser
// — the same line Fullbright.test.js draws between material types and pixels.

const findMesh = (go, name) => go.object3d.children.find(c => c.name === name);

/** The moon's body, ignoring the halo quad sitting alongside it. */
const moonBody = (sky, name) => findMesh(sky.find(name), name);

/** Azimuth and elevation of a direction, in degrees, in the header's convention. */
const azEl = (v) => ({
  azimuth:   THREE.MathUtils.radToDeg(Math.atan2(v.x, -v.z)),
  elevation: THREE.MathUtils.radToDeg(Math.asin(v.y / v.length())),
});

describe('createMarsSky structure', () => {
  it('returns a group so the level editor treats it as a container', () => {
    // Non-group objects get a measured bounding box in the editor's save
    // format, and an 800 m box reloads as a giant grey placeholder.
    expect(createMarsSky().isGroup).toBe(true);
  });

  it('builds the dome with an unlit backside shader that the scene\'s fog does not wash out', () => {
    const dome = findMesh(createMarsSky(), 'MarsSkyDome');

    expect(dome.geometry.parameters.radius).toBe(400);
    expect(dome.material).toBeInstanceOf(THREE.ShaderMaterial);
    expect(dome.material.side).toBe(THREE.BackSide);
    // Fullbright only swaps lit materials, and FogExp2 by distance would
    // wash a 400 m dome into a flat blob. So the dome never takes three's
    // fog chunks. (Its `fog` flag is on only so three hands it the fog's
    // colour, which it uses at the horizon in a storm — see 'storm' below.)
    expect(dome.material.fragmentShader).not.toMatch(/#include <fog_fragment>/);
    expect(dome.material.fragmentShader).not.toMatch(/fogDensity|vFogDepth/);
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
  //
  // The Milky Way is switched off for this and the pole test. It concentrates
  // stars on purpose, so these check the uniform background sampler alone.
  it('disperses stars evenly across equal-area latitude bands', () => {
    const pos   = starsOf(createMarsSky({ starCount: 8000, milkyWay: { starFraction: 0 } }))
      .geometry.getAttribute('position');
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
    const pos = starsOf(createMarsSky({ starCount: 8000, milkyWay: { starFraction: 0 } }))
      .geometry.getAttribute('position');
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

describe('Milky Way', () => {
  const starsOf = (sky) => findMesh(sky, 'MarsSkyStars');

  /** Share of stars within ~8.6° of the band's plane. */
  const shareNearBand = (sky) => {
    const pos    = starsOf(sky).geometry.getAttribute('position');
    const normal = sky.skyUniforms.uBandNormal.value;
    let near = 0;
    for (let i = 0; i < pos.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(pos, i).normalize();
      if (Math.abs(v.dot(normal)) < 0.15) near += 1;
    }
    return near / pos.count;
  };

  it('builds an orthonormal frame whose circle passes through the pinned point', () => {
    const { center, tangent, normal } = milkyWayFrame(-5, 9, -20);

    for (const v of [center, tangent, normal]) expect(v.length()).toBeCloseTo(1);
    expect(center.dot(tangent)).toBeCloseTo(0);
    expect(center.dot(normal)).toBeCloseTo(0);
    expect(tangent.dot(normal)).toBeCloseTo(0);
  });

  it('reads tilt as the slope where the band crosses its pinned point', () => {
    // Flat: runs straight across, rightward. Upright: runs straight up.
    const flat = milkyWayFrame(0, 10, 0).tangent;
    expect(flat.x).toBeCloseTo(1);
    expect(flat.y).toBeCloseTo(0);

    const upright = milkyWayFrame(0, 10, 90).tangent;
    expect(upright.x).toBeCloseTo(0);
    expect(upright.y).toBeGreaterThan(0.9);

    // Negative tilt falls to the right.
    const falling = milkyWayFrame(0, 10, -20).tangent;
    expect(falling.x).toBeGreaterThan(0);
    expect(falling.y).toBeLessThan(0);
  });

  it('crosses the window from mid-room by default', () => {
    // Same box the moons are framed against: ±41° across, 0–14° up.
    const { center } = milkyWayFrame(-5, 9, -20);
    const normal = createMarsSky().skyUniforms.uBandNormal.value;

    expect(normal.dot(center)).toBeCloseTo(0);
    const azimuth   = THREE.MathUtils.radToDeg(Math.atan2(center.x, -center.z));
    const elevation = THREE.MathUtils.radToDeg(Math.asin(center.y));
    expect(Math.abs(azimuth)).toBeLessThan(41);
    expect(elevation).toBeGreaterThan(0);
    expect(elevation).toBeLessThan(14);
  });

  it('concentrates stars along the band', () => {
    // |dot| < 0.15 is 15% of the sphere's area, so a uniform field puts ~15%
    // of its stars there. The band should roughly double that.
    const withBand    = shareNearBand(createMarsSky({ starCount: 10000 }));
    const withoutBand = shareNearBand(createMarsSky({ starCount: 10000, milkyWay: { starFraction: 0 } }));

    expect(withBand).toBeGreaterThan(0.3);
    expect(withoutBand).toBeLessThan(0.2);
  });

  it('passes band options through to the dome', () => {
    const sky = createMarsSky({ milkyWay: { intensity: 0, color: 0x445566 } });

    expect(sky.skyUniforms.uBandIntensity.value).toBe(0);
    expect(sky.skyUniforms.uBandColor.value.getHex()).toBe(0x445566);
    // Unspecified fields keep their defaults rather than going undefined.
    expect(sky.skyUniforms.uBandWidth.value).toBeGreaterThan(0);
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

// ─────────────────────────────────────────────
// Dawn — the state-driven uniform
// ─────────────────────────────────────────────
// uDawn runs 0 (night) → 1 (day). Daylight sets it from the game clock; the
// shaders do the blending. What they paint is checked in the browser — here,
// only that the uniform exists, is shared and is actually read.

describe('dawn uniform', () => {
  const starsOf = (sky) => findMesh(sky, 'MarsSkyStars');
  const domeOf  = (sky) => findMesh(sky, 'MarsSkyDome');

  it('starts at night', () => {
    expect(createMarsSky().skyUniforms.uDawn.value).toBe(0);
  });

  it('is one uniform shared by the dome and the stars, so one write drives both', () => {
    const sky = createMarsSky({ starCount: 10 });
    sky.skyUniforms.uDawn.value = 0.4;

    expect(domeOf(sky).material.uniforms.uDawn.value).toBe(0.4);
    expect(starsOf(sky).material.uniforms.uDawn.value).toBe(0.4);
  });

  it('is read by both fragment shaders', () => {
    const sky = createMarsSky({ starCount: 10 });
    expect(domeOf(sky).material.fragmentShader).toMatch(/uniform float uDawn;/);
    expect(starsOf(sky).material.fragmentShader).toMatch(/uniform float uDawn;/);
  });

  it('carries a butterscotch day gradient, tunable like the night one', () => {
    const sky = createMarsSky({ dayHorizonColor: 0x112233, dayZenithColor: 0x445566 });
    expect(sky.skyUniforms.uDayHorizonColor.value.getHex()).toBe(0x112233);
    expect(sky.skyUniforms.uDayZenithColor.value.getHex()).toBe(0x445566);

    // Default day: warm — more red than blue, at the horizon and overhead.
    const day = createMarsSky().skyUniforms;
    for (const key of ['uDayHorizonColor', 'uDayZenithColor']) {
      const { r, b } = day[key].value;
      expect(r).toBeGreaterThan(b);
    }
  });

  it('glows blue around the rising Sun — Martian twilight is blue', () => {
    const { uSunriseColor } = createMarsSky().skyUniforms;
    const { r, b } = uSunriseColor.value;
    expect(b).toBeGreaterThan(r);
  });

  it('rises on the horizon inside the office window at 6 AM, so the dawn is seen from the desk', () => {
    const sky = createMarsSky({ starCount: 10 });
    sky.setHour(6);
    const dir = sky.skyUniforms.uSunDir.value;
    expect(dir.length()).toBeCloseTo(1);
    expect(Math.abs(dir.y)).toBeLessThan(0.05);               // on the horizon
    expect(azEl(dir).azimuth).toBeCloseTo(-35, 1);            // where sunAzimuth puts it
    expect(Math.abs(azEl(dir).azimuth)).toBeLessThan(41);     // window: ±41°
  });
});

// ─────────────────────────────────────────────
// The night turns
// ─────────────────────────────────────────────
// setHour(h) turns the stars, the Milky Way, the moons and the Sun together
// about the celestial pole, 15° an hour. Midnight is the sky as authored, so
// every framing test above is the midnight sky.

describe('the night turns', () => {
  const starsOf = (sky) => findMesh(sky, 'MarsSkyStars');
  const domeOf  = (sky) => findMesh(sky, 'MarsSkyDome');
  const turnOf  = (sky) => starsOf(sky).quaternion;
  const deg     = THREE.MathUtils.radToDeg;
  const authored = (key) => directionFromAngles(DEFAULT_MOONS[key].azimuth, DEFAULT_MOONS[key].elevation);

  it('starts at midnight, with the moons where they are aimed', () => {
    const sky = createMarsSky({ starCount: 10 });

    expect(sky.hour).toBe(0);
    expect(turnOf(sky).angleTo(new THREE.Quaternion())).toBeCloseTo(0);
    for (const key of ['phobos', 'deimos']) {
      expect(sky.directions[key].distanceTo(authored(key))).toBeCloseTo(0);
    }
  });

  it('turns about a pole due north, as high as the latitude', () => {
    // North is a quarter-turn left of where the Sun rises (a compass bearing
    // 90° less), and a pole stands as high above the horizon as you are far
    // from the equator.
    const pole = celestialPole(-35, 35);
    expect(azEl(pole).azimuth).toBeCloseTo(-125);
    expect(azEl(pole).elevation).toBeCloseTo(35);

    const sky = createMarsSky({ starCount: 10 });
    sky.setHour(3.7);
    expect(pole.clone().applyQuaternion(turnOf(sky)).distanceTo(pole)).toBeCloseTo(0);
  });

  it('turns westward — the east climbs, the west sinks', () => {
    const sky  = createMarsSky({ starCount: 10 });
    const east = directionFromAngles(-35, 0);      // where the Sun comes up
    const west = directionFromAngles(145, 0);
    let prev = { east: -Infinity, west: Infinity };

    for (let hour = 0; hour <= 6; hour++) {
      sky.setHour(hour);
      const now = {
        east: east.clone().applyQuaternion(turnOf(sky)).y,
        west: west.clone().applyQuaternion(turnOf(sky)).y,
      };
      expect(now.east).toBeGreaterThan(prev.east);
      expect(now.west).toBeLessThan(prev.west);
      prev = now;
    }
  });

  it('turns 15° an hour — a sol turns the sky 360° in its 24 hours', () => {
    const sky = createMarsSky({ starCount: 10 });
    sky.setHour(2);
    expect(deg(turnOf(sky).angleTo(new THREE.Quaternion()))).toBeCloseTo(30);
    sky.setHour(6);
    expect(deg(turnOf(sky).angleTo(new THREE.Quaternion()))).toBeCloseTo(90);
    expect(sky.hour).toBe(6);
  });

  it('carries the stars, the moons and the Milky Way round as one sky', () => {
    const sky = createMarsSky({ starCount: 10 });
    sky.setHour(4.2);
    const q = turnOf(sky);

    for (const name of ['Phobos', 'Deimos']) {
      expect(sky.find(name).object3d.quaternion.angleTo(q)).toBeCloseTo(0);
    }

    // The dome shader reads the same turn as a matrix, to take each pixel's
    // direction back into the sky's own frame before it looks up the band.
    const m = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(q));
    const u = sky.skyUniforms.uSkyRotation.value;
    expect(domeOf(sky).material.uniforms.uSkyRotation.value).toBe(u);
    u.elements.forEach((e, i) => expect(e).toBeCloseTo(m.elements[i]));
  });

  it('keeps the live moon directions on the moons actually drawn', () => {
    const sky = createMarsSky({ starCount: 10 });
    sky.setHour(2.5);
    sky.object3d.updateMatrixWorld(true);

    for (const [key, name] of [['phobos', 'Phobos'], ['deimos', 'Deimos']]) {
      const drawn = moonBody(sky, name).getWorldPosition(new THREE.Vector3()).normalize();
      expect(drawn.distanceTo(sky.directions[key])).toBeCloseTo(0);
      expect(drawn.distanceTo(authored(key))).toBeGreaterThan(0.1);   // it did move
    }
  });

  it('turns the Milky Way in the dome shader, and fades stars at the real horizon', () => {
    const sky = createMarsSky({ starCount: 10 });
    const dome = domeOf(sky).material.fragmentShader;
    expect(dome).toMatch(/uniform mat3\s+uSkyRotation;/);
    expect(dome).toMatch(/dir \* uSkyRotation/);
    // The star field turns as an object, so its horizon fade has to look at
    // the world direction, not the star's position in the field.
    expect(starsOf(sky).material.vertexShader).toMatch(/modelMatrix/);
  });

  it('keeps the Sun below the horizon all night, climbing to it for 6 AM', () => {
    const sky = createMarsSky({ starCount: 10 });
    expect(sky.directions.sun).toBe(sky.skyUniforms.uSunDir.value);

    let prev = -Infinity;
    for (let hour = 0; hour <= 6; hour += 0.5) {
      sky.setHour(hour);
      const { y } = sky.directions.sun;
      if (hour < 6) expect(y).toBeLessThan(0);
      expect(y).toBeGreaterThan(prev);
      prev = y;
    }
    expect(Math.abs(prev)).toBeLessThan(1e-6);
  });

  it('never has the Sun next to the moons — they are across the sky from it all night', () => {
    // The two discs are drawn full, so they have to be well away from the
    // Sun: 125° out, they would really be gibbous.
    const sky = createMarsSky({ starCount: 10 });
    for (let hour = 0; hour <= 6; hour += 0.5) {
      sky.setHour(hour);
      for (const key of ['phobos', 'deimos']) {
        expect(deg(sky.directions[key].angleTo(sky.directions.sun)), `${key} at ${hour}`).toBeGreaterThan(110);
      }
    }
  });

  it('keeps both moons up all night — Phobos high, lighting the valley', () => {
    // The moonlight follows Phobos, so Phobos has to stay well up.
    const sky = createMarsSky({ starCount: 10 });
    for (let hour = 0; hour <= 6; hour += 0.25) {
      sky.setHour(hour);
      expect(azEl(sky.directions.phobos).elevation, `Phobos at ${hour}`).toBeGreaterThanOrEqual(29.9);
      expect(azEl(sky.directions.deimos).elevation, `Deimos at ${hour}`).toBeGreaterThan(5);
    }
  });

  it('takes the latitude, the turn rate and the sunrise hour as options', () => {
    const sky = createMarsSky({ starCount: 10, latitude: 50, hourRate: 30, sunriseHour: 2 });
    sky.setHour(1);
    expect(deg(turnOf(sky).angleTo(new THREE.Quaternion()))).toBeCloseTo(30);

    const pole = celestialPole(-35, 50);
    expect(pole.clone().applyQuaternion(turnOf(sky)).distanceTo(pole)).toBeCloseTo(0);

    sky.setHour(2);
    expect(Math.abs(sky.directions.sun.y)).toBeLessThan(1e-6);
    expect(azEl(sky.directions.sun).azimuth).toBeCloseTo(-35);
  });

  it('allocates nothing to turn — the same objects every hour', () => {
    const sky = createMarsSky({ starCount: 10 });
    const before = { ...sky.directions, rot: sky.skyUniforms.uSkyRotation.value };
    sky.setHour(3);
    expect(sky.directions.sun).toBe(before.sun);
    expect(sky.directions.phobos).toBe(before.phobos);
    expect(sky.directions.deimos).toBe(before.deimos);
    expect(sky.skyUniforms.uSkyRotation.value).toBe(before.rot);
  });
});

describe('storm', () => {
  const starsOf = (sky) => findMesh(sky, 'MarsSkyStars');
  const domeOf  = (sky) => findMesh(sky, 'MarsSkyDome');
  const glowOf  = (sky, name) => findMesh(sky.find(name), `${name}Glow`);

  it('starts clear', () => {
    expect(createMarsSky().skyUniforms.uStorm.value).toBe(0);
  });

  it('is one uniform shared by the dome and the stars, read by both shaders', () => {
    const sky = createMarsSky({ starCount: 10 });
    sky.setStorm(0.7);
    expect(domeOf(sky).material.uniforms.uStorm.value).toBe(0.7);
    expect(starsOf(sky).material.uniforms.uStorm.value).toBe(0.7);
    expect(domeOf(sky).material.fragmentShader).toMatch(/uniform float uStorm;/);
    expect(starsOf(sky).material.fragmentShader).toMatch(/uniform float uStorm;/);
  });

  it('takes the scene\'s fog at its foot in a storm, so the land runs into the sky without a line', () => {
    // The ground and hills sink into the storm's fog; the dome is its own
    // shader and took none, so the fogged land ended in a hard edge against
    // a darker sky. With `fog` on, three hands the dome the very fogColor it
    // gives the ground, and the shader lays it on at the horizon.
    const dome = domeOf(createMarsSky({ starCount: 10 }));
    const { fragmentShader, uniforms } = dome.material;
    expect(dome.material.fog).toBe(true);
    expect(uniforms.fogColor.value.isColor).toBe(true);
    expect(uniforms.fogDensity).toBeDefined();    // three writes it with the colour
    expect(fragmentShader).toMatch(/uniform vec3 fogColor;/);
    // Only as far as there is a storm, and laid on where three lays its own
    // fog: after tone mapping, or the same colour would come out as another.
    expect(fragmentShader).toMatch(/mix\(gl_FragColor\.rgb, fogColor, uStorm \* /);
    expect(fragmentShader.indexOf('fogColor, uStorm')).toBeGreaterThan(fragmentShader.indexOf('#include <colorspace_fragment>'));
  });

  it('carries the fog well up the sky, over the trees and hills, but never to the top of it', () => {
    // uStormHaze is how high it reaches, as the sine of the elevation. At
    // 0.35 it was gone by 20 degrees: from the ground the trees and the hills
    // still stood against a dark sky. It has to clear them (30 degrees and
    // more), and stop short of the zenith, which stays dark.
    const { uniforms } = domeOf(createMarsSky({ starCount: 10 })).material;
    expect(uniforms.uStormHaze.value).toBeGreaterThanOrEqual(0.5);
    expect(uniforms.uStormHaze.value).toBeLessThan(1);
  });

  it('loses the moons in the dust, and gives them back after', () => {
    const sky = createMarsSky({ starCount: 10 });
    const glow = glowOf(sky, 'Phobos').material.uniforms.uGlowIntensity.value;
    sky.setStorm(1);
    expect(moonBody(sky, 'Phobos').material.opacity).toBeLessThan(0.2);
    expect(glowOf(sky, 'Phobos').material.uniforms.uGlowIntensity.value).toBeLessThan(glow * 0.2);
    sky.setStorm(0);
    expect(moonBody(sky, 'Phobos').material.opacity).toBe(1);
    expect(glowOf(sky, 'Phobos').material.uniforms.uGlowIntensity.value).toBe(glow);
  });
});
