import * as THREE from 'three';
import { GameObject } from '../core/GameObject.js';

// ─────────────────────────────────────────────
// MarsSky  –  procedural night sky for a terraformed Mars
// ─────────────────────────────────────────────
// An inverted sphere carrying a shader that fades a dusty rust horizon up
// into a near-black starfield, plus Phobos and Deimos hanging at sky
// distance. Nothing here loads a file, so every colour and angle is a
// tunable rather than a texture that has to be re-authored.
//
//   const sky = createMarsSky();
//   sky.addComponent(new SkyFollow());   // keeps it centred on the camera
//   someGroup.addChild(sky);
//
// ── Aiming the moons ──
// Moons are placed by ANGLE, not by hand-tuned XYZ, so they can be re-aimed
// when the room around them changes:
//
//   azimuth   0°  looks straight out the office window (−Z)
//             +   swings right (+X), −  swings left
//   elevation 0°  is the horizon, +  is up
//
// From mid-room the window opening covers roughly ±41° horizontally and
// −13°..+14° vertically (8.5 × 2.35 m opening centred y = 1.65 at z = −4.84,
// eye ≈1.6 m, ~4.8 m back). Keep both moons inside that box and they stay
// framed as the player crosses the room. If the office layout moves, redo
// that arithmetic rather than nudging positions by eye.
// ─────────────────────────────────────────────

/** Sphere radius for the dome, in metres. Comfortably inside the camera's
 *  far plane (1000) while leaving room for the noclip camera to fly. */
const DEFAULT_RADIUS = 400;

/** Moons sit just inside the dome surface so they always render against it. */
const MOON_DISTANCE_FRACTION = 0.95;

/** Exported so scene lighting can aim itself at a moon rather than repeating
 *  its angles — see OfficeScene's MoonLight. */
export const DEFAULT_MOONS = {
  // Still bigger than the real thing (Phobos is ~0.2° wide from Mars, this is
  // ~1.8°) — enough to read as wrong without dominating the window. The two
  // are tinted apart, warm against cool, so they don't read as one moon twice.
  phobos: { azimuth: -16, elevation: 12, size: 6.0, color: 0xc0a189, glow: 1.0 },
  deimos: { azimuth:  14, elevation: 16, size: 2.5, color: 0x9aa0aa, glow: 0.8 },
};

/** Halo width as a multiple of the moon's radius. */
const GLOW_EXTENT = 5;

/**
 * Build the sky dome and its moons.
 *
 * @param {Object} [opts]
 * @param {number} [opts.radius]           Dome radius in metres.
 * @param {number} [opts.horizonColor]     Hex colour at the horizon.
 * @param {number} [opts.zenithColor]      Hex colour straight up.
 * @param {number} [opts.horizonExponent]  Higher keeps the rust glow lower.
 * @param {number} [opts.starThreshold]    0..1; higher means fewer stars.
 * @param {number} [opts.starBrightness]
 * @param {number} [opts.starDensity]      Hash cells per unit direction.
 * @param {number} [opts.starSize]         Star radius, in unit-sphere chord
 *                                         units — 0.0035 is roughly 0.2°.
 * @param {Object} [opts.phobos]  `{ azimuth, elevation, size, color, glow }`,
 *                                angles in degrees, `glow` 0 to disable.
 * @param {Object} [opts.deimos]  Same shape.
 * @returns {GameObject} a group carrying the dome mesh and one child per moon
 */
export function createMarsSky(opts = {}) {
  const {
    radius          = DEFAULT_RADIUS,
    horizonColor    = 0x442e24,
    zenithColor     = 0x03040c,
    horizonExponent = 4.5,
    starThreshold   = 0.988,
    starBrightness  = 1.0,
    starDensity     = 110,
    starSize        = 0.002,
  } = opts;

  // A star is drawn only from its own hash cell, so one wider than the cell
  // gets sliced off at the boundary and renders as a hard-edged wedge. Keep
  // starSize within the margin the jitter leaves: 0.25 / starDensity.
  if (starSize > 0.25 / starDensity) {
    console.warn(
      `[MarsSky] starSize ${starSize} exceeds 0.25/starDensity (${0.25 / starDensity}) — stars will clip at cell edges`,
    );
  }

  const sky = new GameObject('MarsSky');
  // Marked a group so the level editor treats it as a container: its
  // serialiser measures a bounding box for every non-group object, and an
  // 800 m box round-trips through save/load as a giant grey placeholder.
  sky.makeGroup();

  const uniforms = {
    uHorizonColor:    { value: new THREE.Color(horizonColor) },
    uZenithColor:     { value: new THREE.Color(zenithColor) },
    uHorizonExponent: { value: horizonExponent },
    uStarThreshold:   { value: starThreshold },
    uStarBrightness:  { value: starBrightness },
    uStarDensity:     { value: starDensity },
    uStarSize:        { value: starSize },
    uTime:            { value: 0 },
  };

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 32, 16),
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: DOME_VERTEX_SHADER,
      fragmentShader: DOME_FRAGMENT_SHADER,
      side: THREE.BackSide,
      depthWrite: false,
    }),
  );
  dome.name = 'MarsSkyDome';
  // Straight onto the group's Object3D rather than its own GameObject, for
  // the same editor reason as makeGroup() above.
  sky.object3d.add(dome);

  for (const [key, name] of [['phobos', 'Phobos'], ['deimos', 'Deimos']]) {
    const moon = { ...DEFAULT_MOONS[key], ...opts[key] };
    sky.addChild(createMoon(name, moon, radius));
  }

  sky.skyUniforms = uniforms;
  return sky;
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

// The dome never rotates — only its position follows the camera — so a
// vertex's direction from the local origin is already its world direction.
const DOME_VERTEX_SHADER = /* glsl */`
  varying vec3 vWorldDir;

  void main() {
    vWorldDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Stars are hashed from the 3D direction rather than from spherical UVs,
// which would bunch them into a knot at the zenith where the UVs converge.
//
// Each grid cell contributes at most one star, and — this is the part that
// matters — the star is a POINT within that cell, not the cell itself. Cells
// are cubes slicing through a sphere, so lighting a whole cell paints a big
// ragged patch rather than a star. Normalising the cell centre puts the star
// back on the unit sphere, so `distance` measures a real angle and the falloff
// draws a small round dot.
//
// The two trailing includes are not optional: a hand-written ShaderMaterial
// skips the renderer's output stage, so without them the sky misses ACES
// tone mapping and the linear→sRGB conversion every other material gets,
// and renders darker and more saturated than the scene around it.
const DOME_FRAGMENT_SHADER = /* glsl */`
  uniform vec3  uHorizonColor;
  uniform vec3  uZenithColor;
  uniform float uHorizonExponent;
  uniform float uStarThreshold;
  uniform float uStarBrightness;
  uniform float uStarDensity;
  uniform float uStarSize;
  uniform float uTime;

  varying vec3 vWorldDir;

  float hash(vec3 cell) {
    return fract(sin(dot(cell, vec3(12.9898, 78.233, 45.164))) * 43758.5453);
  }

  void main() {
    float height = vWorldDir.y;

    vec3 color = mix(
      uHorizonColor,
      uZenithColor,
      pow(clamp(height, 0.0, 1.0), 1.0 / uHorizonExponent)
    );

    vec3  cell     = floor(vWorldDir * uStarDensity);
    float selected = step(uStarThreshold, hash(cell));

    // Jitter the star off its cell centre so the field doesn't read as a grid.
    // Capped at a quarter-cell so a star never reaches its cell boundary and
    // gets sliced in half — see the starSize check in createMarsSky.
    vec3 jitter = vec3(hash(cell + 11.3), hash(cell + 27.7), hash(cell + 41.9)) - 0.5;
    vec3 starDir = normalize(cell + 0.5 + jitter * 0.5);

    float dot_ = smoothstep(uStarSize, 0.0, distance(vWorldDir, starDir));
    // Offsetting the phase by the star's own hash stops them pulsing in unison.
    float twinkle = 0.6 + 0.4 * sin(uTime * 2.0 + hash(cell) * 62.83);
    // Starts just under the horizon so the field reaches down into the rust
    // rather than leaving a bare band above it.
    float horizonFade = smoothstep(-0.03, 0.09, height);

    color += vec3(selected * dot_ * twinkle * horizonFade * uStarBrightness);

    gl_FragColor = vec4(color, 1.0);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
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
  }
`;
