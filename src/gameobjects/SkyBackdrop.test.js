import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createSkyBackdrop, starAlpha } from './SkyBackdrop.js';
import {
  createMarsSky,
  DEFAULT_MOONS,
  skyRotation,
  celestialPole,
  directionFromAngles,
} from './MarsSky.js';

// ─────────────────────────────────────────────
// SkyBackdrop — the real sky, faintly, behind the radar grid
// ─────────────────────────────────────────────

/** The pole the default sky turns about (sunAzimuth −35°, latitude 35°). */
const POLE = celestialPole(-35, 35);

/** A sky small enough to reason about: 40 stars, everything else default. */
const makeSky = () => createMarsSky({ starCount: 40 });

/** Celestial (midnight) direction of star i, straight from the geometry. */
function starDir(sky, i) {
  const stars = sky.object3d.getObjectByName('MarsSkyStars');
  return new THREE.Vector3().fromBufferAttribute(stars.geometry.attributes.position, i).normalize();
}

/** World direction → the game's (yaw, pitch): the sky's own azimuth/elevation
 *  convention — yaw 0 = −Z (out the office window), pitch negative = up. */
const anglesOf = (dir) => ({
  yaw: Math.atan2(dir.x, -dir.z),
  pitch: -Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1)),
});

/** Rebuild a unit direction from the game's angles (the inverse of anglesOf). */
const dirOf = (yaw, pitch) => {
  const elev = -pitch;
  return new THREE.Vector3(
    Math.cos(elev) * Math.sin(yaw),
    Math.sin(elev),
    -Math.cos(elev) * Math.cos(yaw),
  );
};

describe('starAlpha', () => {
  it('is zero at and below the horizon — the rim is the horizon', () => {
    expect(starAlpha(1, 0, 0)).toBe(0);
    expect(starAlpha(1, 0.4, 0)).toBe(0);
  });

  it('brighter stars read brighter, up to a faint cap', () => {
    expect(starAlpha(1, -1, 0)).toBeGreaterThan(starAlpha(0.1, -1, 0));
    expect(starAlpha(1, -Math.PI / 2, 0)).toBeLessThanOrEqual(0.6);
    expect(starAlpha(1, -Math.PI / 2, 0)).toBeGreaterThan(0);
  });

  it('fades in over the first few degrees above the rim, like the real field', () => {
    expect(starAlpha(1, -0.05, 0)).toBeLessThan(starAlpha(1, -Math.PI / 2, 0));
  });

  it('drowns in the dawn', () => {
    expect(starAlpha(1, -1, 1)).toBe(0);
    expect(starAlpha(1, -1, 0.5)).toBeLessThan(starAlpha(1, -1, 0));
  });
});

describe('SkyBackdrop', () => {
  it('samples every Nth star and projects them onto the game angles at midnight', () => {
    const sky = makeSky();
    const b = createSkyBackdrop(sky, { maxStars: 10 });   // stride 4 → 10 dots
    expect(b.stars.length).toBe(40);                      // 10 × (yaw, pitch, size, alpha)

    for (let k = 0; k < 10; k++) {
      const { yaw, pitch } = anglesOf(starDir(sky, k * 4));
      expect(b.stars[k * 4], `star ${k} yaw`).toBeCloseTo(yaw);
      expect(b.stars[k * 4 + 1], `star ${k} pitch`).toBeCloseTo(pitch);
    }
  });

  it('refresh follows the sky\'s turn, so the backdrop matches the window', () => {
    const sky = makeSky();
    const b = createSkyBackdrop(sky, { maxStars: 10 });

    sky.setHour(2);          // Daylight does this every frame of the night
    b.refresh();

    const { yaw, pitch } = anglesOf(starDir(sky, 0).applyQuaternion(skyRotation(2, POLE)));
    expect(b.stars[0]).toBeCloseTo(yaw);
    expect(b.stars[1]).toBeCloseTo(pitch);
  });

  it('runs the Milky Way along its great circle, breaking where it dips under the horizon', () => {
    const sky = makeSky();
    const b = createSkyBackdrop(sky, { bandSamples: 40 });
    const normal = sky.skyUniforms.uBandNormal.value;

    let onBand = 0, belowHorizon = 0;
    for (let k = 0; k < 40; k++) {
      const yaw = b.band[k * 2], pitch = b.band[k * 2 + 1];
      if (Number.isNaN(pitch)) { belowHorizon++; continue; }
      onBand++;
      // A great circle: every visible sample lies in the band's plane.
      expect(Math.abs(dirOf(yaw, pitch).dot(normal)), `band sample ${k}`).toBeLessThan(1e-6);
      expect(pitch).toBeLessThan(0);   // above the horizon
    }
    // The default band is pinned 9° up and tilted, so it always has both.
    expect(onBand).toBeGreaterThan(0);
    expect(belowHorizon).toBeGreaterThan(0);
  });

  it('the band turns with the sky too', () => {
    const sky = makeSky();
    const b = createSkyBackdrop(sky, { bandSamples: 40 });
    const normal = sky.skyUniforms.uBandNormal.value;

    sky.setHour(1);
    b.refresh();

    const turnedNormal = normal.clone().applyQuaternion(skyRotation(1, POLE));
    let checked = 0;
    for (let k = 0; k < 40; k++) {
      const pitch = b.band[k * 2 + 1];
      if (Number.isNaN(pitch)) continue;
      expect(Math.abs(dirOf(b.band[k * 2], pitch).dot(turnedNormal)), `band sample ${k}`)
        .toBeLessThan(1e-6);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('shows both moons at their authored angles at midnight', () => {
    const sky = makeSky();
    const b = createSkyBackdrop(sky);

    const [phobos, deimos] = b.moons;
    expect(phobos.name).toBe('Phobos');
    expect(deimos.name).toBe('Deimos');
    expect(phobos.yaw).toBeCloseTo(THREE.MathUtils.degToRad(DEFAULT_MOONS.phobos.azimuth));
    expect(phobos.pitch).toBeCloseTo(-THREE.MathUtils.degToRad(DEFAULT_MOONS.phobos.elevation));
    expect(deimos.yaw).toBeCloseTo(THREE.MathUtils.degToRad(DEFAULT_MOONS.deimos.azimuth));
    expect(deimos.pitch).toBeCloseTo(-THREE.MathUtils.degToRad(DEFAULT_MOONS.deimos.elevation));
  });

  it('the moons ride the turn with the stars', () => {
    const sky = makeSky();
    const b = createSkyBackdrop(sky);

    sky.setHour(3);
    b.refresh();

    const expected = anglesOf(
      directionFromAngles(DEFAULT_MOONS.phobos.azimuth, DEFAULT_MOONS.phobos.elevation)
        .applyQuaternion(skyRotation(3, POLE)),
    );
    expect(b.moons[0].yaw).toBeCloseTo(expected.yaw);
    expect(b.moons[0].pitch).toBeCloseTo(expected.pitch);
  });

  it('reads the dawn at refresh and drowns the star dots in it', () => {
    const sky = makeSky();
    const b = createSkyBackdrop(sky, { maxStars: 10 });
    expect(b.dawn).toBe(0);

    sky.skyUniforms.uDawn.value = 1;
    b.refresh();

    expect(b.dawn).toBe(1);
    for (let k = 0; k < 10; k++) expect(b.stars[k * 4 + 3]).toBe(0);
  });

  it('carries the sky\'s colours and band width for the radar to draw with', () => {
    const sky = makeSky();
    const b = createSkyBackdrop(sky);

    for (const base of [b.starBase, b.bandBase, b.moons[0].base, b.moons[1].base]) {
      const parts = base.split(',');
      expect(parts).toHaveLength(3);
      for (const part of parts) {
        const v = Number(part.trim());
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(255);
      }
    }

    // The visible band is both fades wide: 2 · asin(uBandWidth).
    expect(b.bandWidthRad).toBeCloseTo(2 * Math.asin(sky.skyUniforms.uBandWidth.value));
    expect(b.bandIntensity).toBeCloseTo(sky.skyUniforms.uBandIntensity.value);
  });
});
