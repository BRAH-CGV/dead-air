import * as THREE from 'three';
import { GameObject } from '../core/GameObject.js';

// ─────────────────────────────────────────────
// MarsSky  –  procedural night sky for a terraformed Mars
// ─────────────────────────────────────────────
// An inverted sphere carrying a shader that fades a faint cool haze at the
// horizon up into a dark slate sky crossed by the Milky Way, with a star field
// and Phobos and Deimos hanging at sky distance. Nothing here loads a file, so
// every colour and angle is a tunable rather than a texture to re-author.
//
// ── Why it isn't rust ──
// Mars's butterscotch sky is sunlit dust — a daytime colour — and its famous
// blue appears only around the Sun at sunset. After dark the rovers' own
// cameras show a cool slate-grey sky turning grey-teal toward the horizon (see
// Curiosity's PIA17936 and Perseverance's PIA26556), and that is what this
// matches. It reads closer to an Earth night than a warm sky would; that is the
// accurate trade, and the Mars identity is left to the red ground and the two
// moons. The thin, dry air is also why the Milky Way is so vivid here.
//
//   const sky = createMarsSky();
//   sky.addComponent(new SkyFollow());   // keeps it centred on the camera
//   someGroup.addChild(sky);
//
// ── Aiming the moons ──
// Moons are placed by ANGLE, not by hand-tuned XYZ, so they can be re-aimed
// when the room around them changes. The angles are where they stand at
// midnight — see "The night turns" below for the rest of the night:
//
//   azimuth   0°  looks straight out the office window (−Z)
//             +   swings right (+X), −  swings left
//   elevation 0°  is the horizon, +  is up
//
// From mid-room the window opening covers roughly ±41° horizontally and
// −13°..+14° vertically (8.5 × 2.35 m opening centred y = 1.65 at z = −4.84,
// eye ≈1.6 m, ~4.8 m back). The vertical ceiling is not fixed: the opening
// tops out 1.225 m above eye height, so it is ~14° from mid-room but ~31° from
// 2 m away and higher still at the glass.
//
// The two moons use that deliberately. Deimos sits at 10°, inside the mid-room
// box, so a shift opens with a moon in the window wherever the player stands.
// Phobos sits at 30°, above it — you have to walk up to the glass to find it,
// which is worth more than having both hang there at once. It also means the
// MoonLight aimed at Phobos comes in steeper, so the ground outside is lit
// rather than raked.
//
// If the office layout moves, redo that arithmetic rather than nudging
// positions by eye.
//
// ── Aiming the Milky Way ──
// Same angle convention. The band is a great circle, pinned by one point it
// passes through (azimuth/elevation) and its slope there (tilt: degrees above
// horizontal, rising to the right; negative falls to the right). The defaults
// bring it in across the top-left of the window and set it into the horizon on
// the right, just under Deimos. Its brightest stretch is at the pinned point.
//
// ── The night turns ──
// `sky.setHour(hour)` turns the whole sky — stars, Milky Way, both moons and
// the Sun — about the celestial pole, 15° an hour: a sol turns it 360° in its
// 24 hours, and the base keeps local Mars time. Daylight calls it from the
// night clock. Midnight is the sky exactly as authored above.
//
//   pole      due north, a quarter-turn left of where the Sun rises
//             (azimuth sunAzimuth − 90°), standing `latitude` degrees up —
//             35°: the base is at northern mid-latitudes
//   turn      westward: what is in the east climbs, what is in the west sets
//   Sun       on the celestial equator, placed so the turn brings it onto the
//             horizon at sunAzimuth at `sunriseHour` (6 AM). All night it is
//             below the horizon behind the base, climbing
//
// The moons ride the turn with the stars, so their distance from the Sun
// never changes: ~125°, across the sky from it, which is why they are drawn
// as (nearly) full discs. Both stay up all night: Phobos climbs from 30° to
// ~58° and is still 45° up at 6 AM, off to the right behind the office.
// Deimos leaves the mid-room window view at about 2 AM. At this rate nothing
// can stay in an 82° window for six hours; `hourRate` is the knob if the
// team wants a slower sky.
//
// Real Phobos laps Mars faster than Mars turns, so it rises in the WEST and
// crosses the sky in about four hours; real Deimos, only a little slower
// than the turn, takes days. Here both simply ride the sky — a simplification,
// kept so the pair stays together and clear of the Sun.
//
// How the pieces turn: the stars and the moons are objects, so they get the
// turn as a quaternion. The dome can't rotate — its gradient and horizon
// haze belong to the ground — so it gets the same turn as the mat3 uniform
// `uSkyRotation`, and the fragment shader looks the Milky Way up at the
// pixel's direction turned back onto the sky. `sky.directions` holds the
// live world directions of the Sun and both moons, for aiming lights.
//
// ── Dawn ──
// `skyUniforms.uDawn` runs 0 (night) → 1 (day) and is the other knob the
// game turns — Daylight sets it from the clock. Both shaders read it: the dome
// blends the night gradient (Milky Way included) into the butterscotch day
// gradient, and the stars fade out. On top, a blue glow gathers round the
// Sun on the horizon: Martian dust scatters blue light forward, so the sky
// is blue around the Sun at sunrise — the reverse of Earth. The Sun rises
// inside the office window (sunAzimuth, same convention as the moons), so the
// dawn is seen from the desk.
//
// ── Storm ──
// `sky.setStorm(k)` (0 clear → 1 full storm) is Sandstorm's knob. It writes
// `skyUniforms.uStorm`, shared by the dome and the stars like uDawn: the
// dome sinks toward a dust-brown murk, darker overhead, and the stars are
// lost in it. The moons fade too, body and halo, back to exactly what they
// were when the storm passes.
// ─────────────────────────────────────────────

/** Sphere radius for the dome, in metres. Comfortably inside the camera's
 *  far plane (1000) while leaving room for the noclip camera to fly. */
const DEFAULT_RADIUS = 400;

/** Moons sit just inside the dome surface so they always render against it. */
const MOON_DISTANCE_FRACTION = 0.95;

/** Stars sit beyond the moons, so a moon's disc occludes the stars behind it. */
const STAR_DISTANCE_FRACTION = 0.98;

/** Exported so scene lighting can aim itself at a moon rather than repeating
 *  its angles — see OfficeScene's MoonLight. */
export const DEFAULT_MOONS = {
  // Enlarged on purpose. From the surface Phobos is really 0.176° across (a
  // third of Earth's Moon, ~2.5 px at 1080p) and Deimos 0.032°, under a pixel —
  // accurate, but too small to notice and smaller than the star sprites. These
  // give Phobos ~0.7° (~10 px) and Deimos ~0.27° (~4 px): still clearly
  // unequal, both still discs. `size` is the mesh radius, angle × distance / 2
  // with the distance at 0.95 × radius, so scale these with `radius` or the
  // angles drift. Tinted apart, warm against cool, so they don't read as one
  // moon twice.
  phobos: { azimuth: -16, elevation: 30, size: 2.3, color: 0xc0a189, glow: 1.0 },
  deimos: { azimuth:  14, elevation: 10, size: 0.9, color: 0x9aa0aa, glow: 0.8 },
};

/** Halo width as a multiple of the moon's radius. */
const GLOW_EXTENT = 5;

const DEFAULT_MILKY_WAY = {
  azimuth: -5, elevation: 9, tilt: -20,
  // Sine of the angle from the band's centre line at which the glow falls to
  // 1/e — 0.14 is ~8°, so the visible band is ~15° across.
  width: 0.14,
  intensity: 0.09,
  color: 0xaeb6c8,
  // Share of the star field drawn from the band rather than the whole sphere.
  starFraction: 0.35,
};

const DEFAULT_DAY = {
  // Sunlit dust: pale butterscotch at the horizon, deeper and browner overhead.
  horizonColor: 0xd9b48a,
  zenithColor:  0xa8764f,
  // The blue that gathers round the rising Sun.
  sunriseColor: 0x5b8fd6,
  // Left of centre in the window, clear of both moons.
  sunAzimuth:   -35,
};

/** How the sky turns through the night — see "The night turns" above. */
/** The murk a sandstorm turns the sky to. */
const STORM_COLOR = 0x2e2119;
/** How much of a moon is left at the height of a storm. */
const STORM_MOON_LEFT = 0.08;

const DEFAULT_TURN = {
  // Northern mid-latitudes. The pole stands this high, so the sky wheels at
  // a slant and both moons stay up all night.
  latitude:    35,
  // Degrees an hour: 360° over a sol's 24 hours.
  hourRate:    15,
  // The hour the Sun is on the horizon: the end of the shift.
  sunriseHour: 6,
};

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Build the sky dome and its moons.
 *
 * @param {Object} [opts]
 * @param {number} [opts.radius]           Dome radius in metres.
 * @param {number} [opts.horizonColor]     Hex colour at the horizon.
 * @param {number} [opts.zenithColor]      Hex colour straight up.
 * @param {number} [opts.horizonExponent]  Higher keeps the horizon haze lower.
 * @param {number} [opts.dayHorizonColor]  Hex horizon colour at full day.
 * @param {number} [opts.dayZenithColor]   Hex zenith colour at full day.
 * @param {number} [opts.sunriseColor]     Hex colour of the glow round the Sun.
 * @param {number} [opts.sunAzimuth]       Where the Sun rises, in degrees.
 * @param {number} [opts.sunriseHour]      When it rises, on the night clock.
 * @param {number} [opts.latitude]         Degrees north: how high the pole stands.
 * @param {number} [opts.hourRate]         Degrees the sky turns an hour.
 * @param {number} [opts.starCount]        Number of stars over the whole sphere.
 * @param {number} [opts.starSize]         Star sprite size in pixels.
 * @param {number} [opts.starBrightness]
 * @param {number} [opts.starColor]        Hex tint for the star sprites.
 * @param {Object} [opts.milkyWay]  `{ azimuth, elevation, tilt, width,
 *                                  intensity, color, starFraction }` — angles
 *                                  in degrees; `intensity: 0` drops the glow and
 *                                  `starFraction: 0` spreads stars uniformly.
 * @param {Object} [opts.phobos]  `{ azimuth, elevation, size, color, glow }`,
 *                                angles in degrees, `glow` 0 to disable.
 * @param {Object} [opts.deimos]  Same shape.
 * @returns {GameObject} a group carrying the dome mesh and one child per moon,
 *          plus `skyUniforms`, `setHour(hour)`, `hour` and `directions`
 */
export function createMarsSky(opts = {}) {
  const {
    radius          = DEFAULT_RADIUS,
    horizonColor    = 0x243142,
    zenithColor     = 0x080c14,
    horizonExponent = 3.2,
    starCount       = 10000,
    starSize        = 6,
    starBrightness  = 1.0,
    starColor       = 0xdfe6f0,
    dayHorizonColor = DEFAULT_DAY.horizonColor,
    dayZenithColor  = DEFAULT_DAY.zenithColor,
    sunriseColor    = DEFAULT_DAY.sunriseColor,
    sunAzimuth      = DEFAULT_DAY.sunAzimuth,
    sunriseHour     = DEFAULT_TURN.sunriseHour,
    latitude        = DEFAULT_TURN.latitude,
    hourRate        = DEFAULT_TURN.hourRate,
  } = opts;

  const milkyWay = { ...DEFAULT_MILKY_WAY, ...opts.milkyWay };
  const band = milkyWayFrame(milkyWay.azimuth, milkyWay.elevation, milkyWay.tilt);

  const sky = new GameObject('MarsSky');
  // Marked a group so the level editor treats it as a container: its
  // serialiser measures a bounding box for every non-group object, and an
  // 800 m box round-trips through save/load as a giant grey placeholder.
  sky.makeGroup();

  // Shared by reference with the star material, so ticking skyUniforms.uTime
  // drives both without SkyFollow needing to know there are two materials.
  // uDawn is shared the same way, for Daylight.
  const uTime = { value: 0 };
  const uDawn = { value: 0 };
  const uStorm = { value: 0 };

  const domeUniforms = {
    uHorizonColor:    { value: new THREE.Color(horizonColor) },
    uZenithColor:     { value: new THREE.Color(zenithColor) },
    uHorizonExponent: { value: horizonExponent },
    uBandNormal:      { value: band.normal },
    uBandCenter:      { value: band.center },
    uBandWidth:       { value: milkyWay.width },
    uBandIntensity:   { value: milkyWay.intensity },
    uBandColor:       { value: new THREE.Color(milkyWay.color) },
    uDawn,
    uDayHorizonColor: { value: new THREE.Color(dayHorizonColor) },
    uDayZenithColor:  { value: new THREE.Color(dayZenithColor) },
    uSunriseColor:    { value: new THREE.Color(sunriseColor) },
    uStorm,
    uStormColor:      { value: new THREE.Color(STORM_COLOR) },
    // Both written by setHour, below.
    uSunDir:          { value: new THREE.Vector3() },
    uSkyRotation:     { value: new THREE.Matrix3() },
  };

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 32, 16),
    new THREE.ShaderMaterial({
      uniforms: domeUniforms,
      vertexShader: DOME_VERTEX_SHADER,
      fragmentShader: DOME_FRAGMENT_SHADER,
      side: THREE.BackSide,
      depthWrite: false,
      // Gates the DITHERING define the shader's chunks sit behind.
      dithering: true,
    }),
  );
  dome.name = 'MarsSkyDome';
  // Straight onto the group's Object3D rather than its own GameObject, for
  // the same editor reason as makeGroup() above.
  sky.object3d.add(dome);

  const stars = createStarField({
    count: starCount, radius, size: starSize,
    brightness: starBrightness, color: starColor, uTime, uDawn, uStorm,
    // Stars hug the plane more tightly than the glow does, so the band reads
    // as a dense stream of stars sitting inside a softer haze.
    band: { ...band, fraction: milkyWay.starFraction, spread: milkyWay.width * 0.7 },
  });
  sky.object3d.add(stars);

  const moons = {};
  const turning = [stars];
  for (const [key, name] of [['phobos', 'Phobos'], ['deimos', 'Deimos']]) {
    moons[key] = { ...DEFAULT_MOONS[key], ...opts[key] };
    const moon = createMoon(name, moons[key], radius);
    sky.addChild(moon);
    turning.push(moon.object3d);
  }

  sky.skyUniforms = { ...domeUniforms, ...stars.material.uniforms };

  // What the storm dims, at full strength. The bodies go transparent from
  // the start, so fading them never changes the program they compile to.
  const moonParts = turning.slice(1).flatMap(moon => moon.children).map(mesh => {
    if (mesh.material.isMeshBasicMaterial) mesh.material.transparent = true;
    return { material: mesh.material, glow: mesh.material.uniforms?.uGlowIntensity.value };
  });
  /** Bury the sky in dust, 0 (clear) … 1 (full storm). Allocates nothing. */
  sky.setStorm = (k) => {
    uStorm.value = k;
    const left = 1 - (1 - STORM_MOON_LEFT) * k;
    for (const part of moonParts) {
      if (part.glow !== undefined) part.material.uniforms.uGlowIntensity.value = part.glow * left;
      else part.material.opacity = left;
    }
  };

  // ── The turn ──
  const pole = celestialPole(sunAzimuth, latitude);
  // Where each lies on the turning sky, which is the world at midnight. The
  // Sun is wound back from its sunrise point by the turn up to sunriseHour.
  const home = {
    sun:    directionFromAngles(sunAzimuth, 0)
      .applyQuaternion(skyRotation(-sunriseHour, pole, hourRate)),
    phobos: directionFromAngles(moons.phobos.azimuth, moons.phobos.elevation),
    deimos: directionFromAngles(moons.deimos.azimuth, moons.deimos.elevation),
  };
  /** Live world directions, rewritten in place by setHour. `sun` is the
   *  dome's uSunDir itself. */
  sky.directions = {
    sun:    domeUniforms.uSunDir.value,
    phobos: new THREE.Vector3(),
    deimos: new THREE.Vector3(),
  };

  const turn = new THREE.Quaternion();
  const turnMatrix = new THREE.Matrix4();
  /** Turn the sky to `hour` on the night clock (0 = midnight). Allocates
   *  nothing, so it can run every frame. */
  sky.setHour = (hour) => {
    skyRotation(hour, pole, hourRate, turn);
    for (const object of turning) object.quaternion.copy(turn);
    domeUniforms.uSkyRotation.value.setFromMatrix4(turnMatrix.makeRotationFromQuaternion(turn));
    sky.directions.sun.copy(home.sun).applyQuaternion(turn);
    sky.directions.phobos.copy(home.phobos).applyQuaternion(turn);
    sky.directions.deimos.copy(home.deimos).applyQuaternion(turn);
    sky.hour = hour;
  };
  sky.setHour(0);

  return sky;
}

/**
 * The star field, as a point cloud rather than anything derived from the dome
 * shader.
 *
 * Stars used to be hashed out of a 3D lattice in the fragment shader, which
 * produced concentric rings: a fragment only ever tested its own cell, so a
 * cell's star rendered only when the cell centre happened to sit at the right
 * radius, and which cells qualified was decided by how a cubic lattice slices
 * a sphere. Raising the count sharpened the pattern instead of filling it in.
 * Real points have no lattice to disagree with, so density is a plain number
 * and dispersion is uniform by construction.
 */
function createStarField({ count, radius, size, brightness, color, uTime, uDawn, uStorm, band }) {
  const positions  = new Float32Array(count * 3);
  const phases     = new Float32Array(count);
  const magnitudes = new Float32Array(count);
  const distance   = radius * STAR_DISTANCE_FRACTION;
  const dir        = new THREE.Vector3();

  for (let i = 0; i < count; i++) {
    if (Math.random() < band.fraction) {
      // Anywhere along the band's great circle, offset from its plane by a
      // Gaussian, so the band thins out at its edges instead of stopping at a
      // hard line.
      const along  = Math.random() * Math.PI * 2;
      const across = gaussian() * band.spread;
      dir.copy(band.center).multiplyScalar(Math.cos(along))
        .addScaledVector(band.tangent, Math.sin(along))
        .multiplyScalar(Math.cos(across))
        .addScaledVector(band.normal, Math.sin(across));
    } else {
      // Archimedes' hat-box theorem: a uniform height paired with a uniform
      // longitude covers a sphere evenly. Picking the polar ANGLE uniformly
      // instead — the obvious way — bunches stars into caps at the poles.
      const y   = 1 - 2 * Math.random();
      const r   = Math.sqrt(Math.max(0, 1 - y * y));
      const phi = Math.random() * Math.PI * 2;
      dir.set(Math.cos(phi) * r, y, Math.sin(phi) * r);
    }

    positions[i * 3]     = dir.x * distance;
    positions[i * 3 + 1] = dir.y * distance;
    positions[i * 3 + 2] = dir.z * distance;

    phases[i] = Math.random() * Math.PI * 2;
    // Skewed toward the faint end, so a dense field still reads as a sky with
    // a few bright stars in it rather than a flat spray of identical dots.
    magnitudes[i] = Math.pow(Math.random(), 2.5);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  geometry.setAttribute('aMagnitude', new THREE.BufferAttribute(magnitudes, 1));

  const stars = new THREE.Points(geometry, new THREE.ShaderMaterial({
    uniforms: {
      uTime,
      uDawn,
      uStorm,
      uStarSize:       { value: size },
      uStarBrightness: { value: brightness },
      uStarColor:      { value: new THREE.Color(color) },
    },
    vertexShader: STAR_VERTEX_SHADER,
    fragmentShader: STAR_FRAGMENT_SHADER,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    dithering: true,
  }));
  stars.name = 'MarsSkyStars';
  return stars;
}

/** One moon as its own GameObject, so it shows up in the editor outliner. */
function createMoon(name, { azimuth, elevation, size, color, glow }, domeRadius) {
  const go = new GameObject(name);
  const position = directionFromAngles(azimuth, elevation)
    .multiplyScalar(domeRadius * MOON_DISTANCE_FRACTION);

  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(size, 24, 16),
    // fog:false is not optional. MeshBasicMaterial is fogged by default, and
    // at sky distance FogExp2 resolves to ~100% fog colour, which renders the
    // moon as a flat dark disc inside its own halo.
    new THREE.MeshBasicMaterial({ color, fog: false }),
  );
  mesh.name = name;
  mesh.position.copy(position);
  go.object3d.add(mesh);

  if (glow > 0) go.object3d.add(createMoonGlow(name, position, size, color, glow));
  return go;
}

/**
 * The halo around a moon: an additive quad sitting just beyond it, so the
 * moon's own disc occludes the middle and only the surrounding glow shows.
 *
 * It needs no billboarding. SkyFollow pins the sky's origin to the camera, so
 * a quad turned to face that origin is always facing the viewer.
 */
function createMoonGlow(name, position, size, color, intensity) {
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(size * GLOW_EXTENT, size * GLOW_EXTENT),
    new THREE.ShaderMaterial({
      uniforms: {
        uGlowColor:     { value: new THREE.Color(color) },
        uGlowIntensity: { value: intensity },
      },
      vertexShader: GLOW_VERTEX_SHADER,
      fragmentShader: GLOW_FRAGMENT_SHADER,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      dithering: true,
    }),
  );
  glow.name = `${name}Glow`;
  glow.position.copy(position).multiplyScalar(1.01);
  glow.lookAt(0, 0, 0);
  return glow;
}

/** Unit vector for an azimuth/elevation pair in degrees, in the convention
 *  documented in the header: azimuth 0° is −Z, positive swings toward +X. */
export function directionFromAngles(azimuthDeg, elevationDeg) {
  const azimuth   = THREE.MathUtils.degToRad(azimuthDeg);
  const elevation = THREE.MathUtils.degToRad(elevationDeg);
  return new THREE.Vector3(
     Math.cos(elevation) * Math.sin(azimuth),
     Math.sin(elevation),
    -Math.cos(elevation) * Math.cos(azimuth),
  );
}

/** The celestial pole the sky turns about: due north — a quarter-turn left
 *  of where the Sun rises — and as high above the horizon as the latitude. */
export function celestialPole(sunAzimuthDeg, latitudeDeg) {
  return directionFromAngles(sunAzimuthDeg - 90, latitudeDeg);
}

/**
 * The sky's turn at `hour`, from midnight: `hourRate` degrees an hour,
 * westward about `pole`. Negative about the pole, because the sky wheels
 * clockwise to someone looking up at it — what is in the east climbs.
 *
 * @param {number} hour
 * @param {THREE.Vector3} pole  Unit vector, from celestialPole().
 * @param {number} [hourRate]   Degrees an hour.
 * @param {THREE.Quaternion} [out]
 * @returns {THREE.Quaternion} `out`
 */
export function skyRotation(hour, pole, hourRate = DEFAULT_TURN.hourRate, out = new THREE.Quaternion()) {
  return out.setFromAxisAngle(pole, -THREE.MathUtils.degToRad(hourRate * hour));
}

/**
 * Orthonormal frame for the Milky Way's great circle: `center` is the point
 * it is pinned to, `tangent` runs along the band there, and `normal` is the
 * band's pole — a direction's offset from the band is its dot with `normal`.
 */
export function milkyWayFrame(azimuthDeg, elevationDeg, tiltDeg) {
  const center = directionFromAngles(azimuthDeg, elevationDeg);
  const right  = new THREE.Vector3().crossVectors(center, UP).normalize();
  const up     = new THREE.Vector3().crossVectors(right, center);
  const tilt   = THREE.MathUtils.degToRad(tiltDeg);

  const tangent = right.multiplyScalar(Math.cos(tilt)).addScaledVector(up, Math.sin(tilt));
  const normal  = new THREE.Vector3().crossVectors(center, tangent).normalize();
  return { center, tangent, normal };
}

/** Standard normal sample (Box–Muller). */
function gaussian() {
  // 1 - random() is in (0, 1], so the log never sees a zero.
  return Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
}

// The dome never rotates — only its position follows the camera — so a
// vertex's direction from the local origin is already its world direction.
// The night's turn happens in the fragment shader instead (uSkyRotation), so
// the gradient and the horizon haze stay with the ground.
const DOME_VERTEX_SHADER = /* glsl */`
  varying vec3 vWorldDir;

  void main() {
    vWorldDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// The trailing includes are not optional: a hand-written ShaderMaterial skips
// the renderer's output stage, so without them the sky misses ACES tone
// mapping and the linear→sRGB conversion every other material gets, and
// renders darker and more saturated than the scene around it.
//
// Dithering is what keeps the gradient smooth. The framebuffer holds 8 bits a
// channel, and this ramp crosses only ~60 of those levels while covering most
// of the screen, so each level lands as a wide visible band. A half-LSB of
// noise before quantisation scatters the boundaries into grain the eye reads
// as a smooth ramp. `common` is included for the rand() the chunk calls.
const DOME_FRAGMENT_SHADER = /* glsl */`
  #include <common>
  #include <dithering_pars_fragment>

  uniform vec3  uHorizonColor;
  uniform vec3  uZenithColor;
  uniform float uHorizonExponent;

  uniform vec3  uBandNormal;
  uniform vec3  uBandCenter;
  uniform float uBandWidth;
  uniform float uBandIntensity;
  uniform vec3  uBandColor;

  uniform float uDawn;
  uniform vec3  uDayHorizonColor;
  uniform vec3  uDayZenithColor;
  uniform vec3  uSunriseColor;
  uniform vec3  uSunDir;
  uniform float uStorm;
  uniform vec3  uStormColor;

  // The night's turn, from the sky's own frame into the world.
  uniform mat3  uSkyRotation;

  varying vec3 vWorldDir;

  float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }

  float valueNoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    vec3 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash13(i),                       hash13(i + vec3(1.0, 0.0, 0.0)), u.x),
          mix(hash13(i + vec3(0.0, 1.0, 0.0)), hash13(i + vec3(1.0, 1.0, 0.0)), u.x), u.y),
      mix(mix(hash13(i + vec3(0.0, 0.0, 1.0)), hash13(i + vec3(1.0, 0.0, 1.0)), u.x),
          mix(hash13(i + vec3(0.0, 1.0, 1.0)), hash13(i + vec3(1.0, 1.0, 1.0)), u.x), u.y),
      u.z
    );
  }

  float fbm(vec3 p) {
    float sum = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 4; i++) {
      sum += amp * valueNoise(p);
      p = p * 2.03 + 1.7;
      amp *= 0.5;
    }
    return sum / 0.9375;
  }

  // x * x rather than pow(x, 2.0): GLSL leaves pow undefined for a negative
  // base, and the offset from the band's plane is signed.
  float gaussian(float x) { return exp(-x * x); }

  // Noise is sampled on the direction itself, not on UVs, so the structure has
  // no seam and no pinch at the poles. dir is on the turning sky, so the
  // band and its clumps turn with the stars; up is the world height, since
  // the air the starlight comes through does not turn.
  vec3 milkyWay(vec3 dir, float up) {
    float offset = dot(dir, uBandNormal);
    float band   = gaussian(offset / uBandWidth);
    if (band < 0.002) return vec3(0.0);

    float core   = gaussian(distance(dir, uBandCenter) / 0.7);
    float clumps = fbm(dir * 7.0);
    // Dust lanes, kept to the middle of the band like the real Great Rift.
    float dust   = smoothstep(0.45, 0.75, fbm(dir * 4.0 + 19.0))
                 * gaussian(offset / (uBandWidth * 0.35));
    // Starlight crosses more air near the horizon, so the band dims there too.
    float extinction = smoothstep(-0.02, 0.2, up);

    float glow = band * (0.4 + 0.6 * core) * (0.35 + 0.9 * clumps) * (1.0 - 0.6 * dust);
    return uBandColor * glow * uBandIntensity * extinction;
  }

  void main() {
    // Interpolation across each triangle shortens the direction slightly, which
    // the band's plane and core distances would pick up as drift.
    vec3 dir = normalize(vWorldDir);
    // The same direction on the turning sky. A row vector times a matrix is
    // the transpose times the vector — for a rotation, the turn undone.
    vec3 celestial = dir * uSkyRotation;

    float height = pow(clamp(dir.y, 0.0, 1.0), 1.0 / uHorizonExponent);

    vec3 night = mix(uHorizonColor, uZenithColor, height) + milkyWay(celestial, dir.y);
    vec3 day   = mix(uDayHorizonColor, uDayZenithColor, height);
    vec3 color = mix(night, day, uDawn);

    // Blue round the Sun, hugging the horizon. It builds with the dawn, peaks
    // just before full day, and settles to half in the morning while the Sun
    // is still low: uDawn * (1.5 - uDawn) is 0 → 0.56 at 0.75 → 0.5 at 1.
    float nearSun = pow(max(dot(dir, uSunDir), 0.0), 6.0);
    float lowSky  = 1.0 - smoothstep(0.0, 0.4, dir.y);
    color += uSunriseColor * nearSun * lowSky * uDawn * (1.5 - uDawn);

    // A sandstorm: dust-brown murk, thicker overhead where you look up
    // through the whole storm, lit up a little by whatever sky is behind it.
    vec3 murk = uStormColor * (1.0 - 0.35 * height) + color * 0.15;
    color = mix(color, murk, uStorm * (0.85 + 0.15 * height));

    gl_FragColor = vec4(color, 1.0);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <dithering_fragment>
  }
`;

// Sizes are in pixels rather than world units, which is stable here because
// SkyFollow keeps the camera at the field's centre — every star is always the
// same distance away, so there is no perspective for a size to attenuate over.
const STAR_VERTEX_SHADER = /* glsl */`
  attribute float aPhase;
  attribute float aMagnitude;

  uniform float uTime;
  uniform float uStarSize;

  varying float vBrightness;

  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);

    // Its own phase, so the field shimmers instead of pulsing in unison.
    float twinkle = 0.75 + 0.25 * sin(uTime * 2.0 + aPhase);
    // Fade out just below the horizon, so stars don't sit on top of the haze.
    // The field turns through the night, so this is the star's WORLD height:
    // mat3 keeps the model matrix's turn and drops the camera-following
    // translation, and the sky is never scaled.
    float horizonFade = smoothstep(-0.03, 0.09, normalize(mat3(modelMatrix) * position).y);

    vBrightness  = (0.25 + 0.75 * aMagnitude) * twinkle * horizonFade;
    gl_PointSize = uStarSize * (0.5 + 0.5 * aMagnitude);
  }
`;

const STAR_FRAGMENT_SHADER = /* glsl */`
  #include <common>
  #include <dithering_pars_fragment>

  uniform vec3  uStarColor;
  uniform float uStarBrightness;
  uniform float uDawn;
  uniform float uStorm;

  varying float vBrightness;

  void main() {
    // Point sprites are square, so round them off here or the sky fills with
    // tiny boxes.
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float falloff = 1.0 - smoothstep(0.0, 1.0, d);
    if (falloff <= 0.0) discard;

    // Daylight drowns the stars; so does a sandstorm.
    float alpha = falloff * falloff * vBrightness * uStarBrightness * (1.0 - uDawn) * (1.0 - uStorm);
    gl_FragColor = vec4(uStarColor * alpha, alpha);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <dithering_fragment>
  }
`;

const GLOW_VERTEX_SHADER = /* glsl */`
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const GLOW_FRAGMENT_SHADER = /* glsl */`
  #include <common>
  #include <dithering_pars_fragment>

  uniform vec3  uGlowColor;
  uniform float uGlowIntensity;

  varying vec2 vUv;

  void main() {
    // 0 at the quad's centre, 1 at the inscribed circle — anything beyond
    // falls to zero, so the quad's corners never show as a visible square.
    float d = length(vUv - 0.5) * 2.0;
    float falloff = pow(1.0 - smoothstep(0.0, 1.0, d), 2.5);

    gl_FragColor = vec4(uGlowColor * uGlowIntensity * falloff, falloff);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <dithering_fragment>
  }
`;
