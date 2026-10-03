import * as THREE from 'three';

// ─────────────────────────────────────────────
// SkyBackdrop  –  the real night sky, faintly, behind the radar grid
// ─────────────────────────────────────────────
// The radar disc is the sky seen from above: the rim is the horizon, the
// centre the zenith. So the actual Mars sky — its stars, the Milky Way band
// and both moons — can be drawn faintly behind the grid, through the SAME
// sky-to-canvas mapping the blips use, and each blip then sits on the patch
// of sky it belongs to.
//
//   overlay.setSky(sky);   // scenes wire it; drawing needs nothing more
//
// Everything is read live from the sky each refresh, so the backdrop turns
// with the night (setHour) and drowns in the dawn (uDawn) exactly as the
// window view does. Yaw/pitch use the sky's own azimuth convention —
// yaw 0 = −Z, straight out the office window, pitch negative = up — which
// is what the game's radar angles mean too (see DishRig.skyToCursor). The
// radar draws bearing 0 at its bottom, so the disc reads like the window
// view: what climbs in the window climbs on the radar.
//
// The dots are a subsample of the real star field (every Nth star), not a
// re-roll: what clusters along the band in the window clusters on the radar.
// Nothing is allocated in refresh(), so it can run every frame.
// ─────────────────────────────────────────────

/** Star dots fade in over the first few degrees above the rim, matching the
 *  field's own horizon fade — the rim IS the horizon. */
const HORIZON_FADE_LOW = -0.03;
const HORIZON_FADE_HIGH = 0.09;

/** Backdrop dots stay faint by cap: this is set dressing, not a second sky. */
const STAR_ALPHA_CAP = 0.5;

function smoothstep(a, b, x) {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
}

/**
 * Display alpha for one backdrop star dot.
 * @param {number} magnitude  The star's aMagnitude, 0..1.
 * @param {number} pitch      Game pitch, radians — negative = up.
 * @param {number} dawn       Sky uDawn, 0 (night) .. 1 (day).
 * @returns {number} alpha 0..STAR_ALPHA_CAP
 */
export function starAlpha(magnitude, pitch, dawn) {
  if (pitch >= 0) return 0;
  const fade = smoothstep(HORIZON_FADE_LOW, HORIZON_FADE_HIGH, Math.sin(-pitch));
  return Math.min(STAR_ALPHA_CAP, (0.25 + 0.75 * magnitude) * fade * (1 - dawn) * STAR_ALPHA_CAP);
}

/** A THREE.Color as "r, g, b" canvas channels (sRGB, like the dome renders). */
function cssChannels(color) {
  const hex = color.getHex();
  return `${(hex >> 16) & 255}, ${(hex >> 8) & 255}, ${hex & 255}`;
}

/**
 * Build a sky backdrop for a radar overlay.
 *
 * @param {import('./MarsSky.js').MarsSky} sky  A sky from createMarsSky().
 * @param {object} [opts]
 * @param {number} [opts.maxStars=500]     Star dots to sample from the field.
 * @param {number} [opts.bandSamples=90]   Samples along the Milky Way circle.
 * @returns {{stars: Float32Array, band: Float32Array, moons: object[],
 *            dawn: number, starBase: string, bandBase: string,
 *            bandWidthRad: number, bandIntensity: number, refresh(): void}}
 *   stars is flat [yaw, pitch, sizePx, alpha] × dots; band is flat
 *   [yaw, pitch] × samples with NaN marking the stretch under the horizon.
 */
export function createSkyBackdrop(sky, { maxStars = 500, bandSamples = 90 } = {}) {
  const starsObj = sky.object3d.getObjectByName('MarsSkyStars');
  const uniforms = sky.skyUniforms;

  // ── Sampled stars: every Nth of the real field, kept as local directions ──
  const position  = starsObj.geometry.attributes.position;
  const magnitude = starsObj.geometry.attributes.aMagnitude;
  const total  = position.count;
  const stride = Math.max(1, Math.ceil(total / maxStars));
  const dots   = Math.min(maxStars, Math.ceil(total / stride));

  const localDirs = new Float32Array(dots * 3);
  const mags      = new Float32Array(dots);
  const sizes     = new Float32Array(dots);
  const dir = new THREE.Vector3();
  for (let k = 0; k < dots; k++) {
    dir.fromBufferAttribute(position, k * stride).normalize();
    localDirs[k * 3]     = dir.x;
    localDirs[k * 3 + 1] = dir.y;
    localDirs[k * 3 + 2] = dir.z;
    mags[k]  = magnitude.getX(k * stride);
    sizes[k] = 0.6 + 1.4 * mags[k];   // dot radius, px on the 400px canvas
  }

  // ── The Milky Way's great circle, as authored (the turn is applied live) ──
  // Only the center and normal are uniforms; the tangent is their cross
  // product (the frame is right-handed: normal = center × tangent).
  const center  = uniforms.uBandCenter.value;
  const tangent = new THREE.Vector3().crossVectors(uniforms.uBandNormal.value, center);
  const bandDirs = new Float32Array(bandSamples * 3);
  for (let k = 0; k < bandSamples; k++) {
    const along = (k / bandSamples) * Math.PI * 2;
    const c = Math.cos(along), s = Math.sin(along);
    bandDirs[k * 3]     = center.x * c + tangent.x * s;
    bandDirs[k * 3 + 1] = center.y * c + tangent.y * s;
    bandDirs[k * 3 + 2] = center.z * c + tangent.z * s;
  }

  // ── The moons: their meshes sit at their authored angles inside the sky ──
  const moons = [];
  for (const name of ['Phobos', 'Deimos']) {
    const root = sky.object3d.children.find(child => child.name === name);
    const mesh = root?.children.find(child => child.isMesh);
    if (!mesh) continue;
    const local  = mesh.position.clone();
    const radius = mesh.geometry.parameters?.radius ?? 1;
    moons.push({
      name,
      yaw: 0,
      pitch: 0,
      base: cssChannels(mesh.material.color),
      angularRadius: radius / local.length(),
      _root: root,
      _local: local,
    });
  }

  // One scratch vector for all of refresh — it runs every frame.
  const scratch = new THREE.Vector3();

  const backdrop = {
    /** [yaw, pitch, sizePx, alpha] per sampled star. */
    stars: new Float32Array(dots * 4),
    /** [yaw, pitch] per band sample; NaN pitch = below the horizon. */
    band: new Float32Array(bandSamples * 2),
    /** The moons, in draw order (Phobos, Deimos). */
    moons,
    /** The dawn at the last refresh — moons dim with it too. */
    dawn: 0,
    starBase: cssChannels(uniforms.uStarColor.value),
    bandBase: cssChannels(uniforms.uBandColor.value),
    bandWidthRad: 2 * Math.asin(uniforms.uBandWidth.value),
    bandIntensity: uniforms.uBandIntensity.value,

    /** Re-read the sky: the turn (setHour) and the dawn (uDawn) are live. */
    refresh() {
      const turn = starsObj.quaternion;
      this.dawn = uniforms.uDawn.value;

      for (let k = 0; k < dots; k++) {
        scratch.set(localDirs[k * 3], localDirs[k * 3 + 1], localDirs[k * 3 + 2])
          .applyQuaternion(turn);
        const pitch = -Math.asin(Math.min(Math.max(scratch.y, -1), 1));
        this.stars[k * 4]     = Math.atan2(scratch.x, -scratch.z);
        this.stars[k * 4 + 1] = pitch;
        this.stars[k * 4 + 2] = sizes[k];
        this.stars[k * 4 + 3] = starAlpha(mags[k], pitch, this.dawn);
      }

      for (let k = 0; k < bandSamples; k++) {
        scratch.set(bandDirs[k * 3], bandDirs[k * 3 + 1], bandDirs[k * 3 + 2])
          .applyQuaternion(turn);
        if (scratch.y <= 0) {
          this.band[k * 2]     = NaN;
          this.band[k * 2 + 1] = NaN;
        } else {
          this.band[k * 2]     = Math.atan2(scratch.x, -scratch.z);
          this.band[k * 2 + 1] = -Math.asin(scratch.y);
        }
      }

      for (const moon of moons) {
        scratch.copy(moon._local).applyQuaternion(moon._root.quaternion).normalize();
        moon.yaw   = Math.atan2(scratch.x, -scratch.z);
        moon.pitch = -Math.asin(Math.min(Math.max(scratch.y, -1), 1));
      }
    },
  };

  backdrop.refresh();
  return backdrop;
}
