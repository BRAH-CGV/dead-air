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
// when the room around them changes:
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
// box, so there is always a moon in the window wherever the player stands.
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

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Build the sky dome and its moons.
 *
 * @param {Object} [opts]
 * @param {number} [opts.radius]           Dome radius in metres.
 * @param {number} [opts.horizonColor]     Hex colour at the horizon.
 * @param {number} [opts.zenithColor]      Hex colour straight up.
 * @param {number} [opts.horizonExponent]  Higher keeps the horizon haze lower.
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
 * @returns {GameObject} a group carrying the dome mesh and one child per moon
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
  const uTime = { value: 0 };

  const domeUniforms = {
    uHorizonColor:    { value: new THREE.Color(horizonColor) },
    uZenithColor:     { value: new THREE.Color(zenithColor) },
    uHorizonExponent: { value: horizonExponent },
    uBandNormal:      { value: band.normal },
    uBandCenter:      { value: band.center },
    uBandWidth:       { value: milkyWay.width },
    uBandIntensity:   { value: milkyWay.intensity },
    uBandColor:       { value: new THREE.Color(milkyWay.color) },
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
    brightness: starBrightness, color: starColor, uTime,
    // Stars hug the plane more tightly than the glow does, so the band reads
    // as a dense stream of stars sitting inside a softer haze.
    band: { ...band, fraction: milkyWay.starFraction, spread: milkyWay.width * 0.7 },
  });
  sky.object3d.add(stars);

  for (const [key, name] of [['phobos', 'Phobos'], ['deimos', 'Deimos']]) {
    const moon = { ...DEFAULT_MOONS[key], ...opts[key] };
    sky.addChild(createMoon(name, moon, radius));
  }

  sky.skyUniforms = { ...domeUniforms, ...stars.material.uniforms };
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
function createStarField({ count, radius, size, brightness, color, uTime, band }) {
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
  // no seam and no pinch at the poles.
  vec3 milkyWay(vec3 dir) {
    float offset = dot(dir, uBandNormal);
    float band   = gaussian(offset / uBandWidth);
    if (band < 0.002) return vec3(0.0);

    float core   = gaussian(distance(dir, uBandCenter) / 0.7);
    float clumps = fbm(dir * 7.0);
    // Dust lanes, kept to the middle of the band like the real Great Rift.
    float dust   = smoothstep(0.45, 0.75, fbm(dir * 4.0 + 19.0))
                 * gaussian(offset / (uBandWidth * 0.35));
    // Starlight crosses more air near the horizon, so the band dims there too.
    float extinction = smoothstep(-0.02, 0.2, dir.y);

    float glow = band * (0.4 + 0.6 * core) * (0.35 + 0.9 * clumps) * (1.0 - 0.6 * dust);
    return uBandColor * glow * uBandIntensity * extinction;
  }

  void main() {
    // Interpolation across each triangle shortens the direction slightly, which
    // the band's plane and core distances would pick up as drift.
    vec3 dir = normalize(vWorldDir);

    vec3 color = mix(
      uHorizonColor,
      uZenithColor,
      pow(clamp(dir.y, 0.0, 1.0), 1.0 / uHorizonExponent)
    );
    color += milkyWay(dir);

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
    float horizonFade = smoothstep(-0.03, 0.09, normalize(position).y);

    vBrightness  = (0.25 + 0.75 * aMagnitude) * twinkle * horizonFade;
    gl_PointSize = uStarSize * (0.5 + 0.5 * aMagnitude);
  }
`;

const STAR_FRAGMENT_SHADER = /* glsl */`
  #include <common>
  #include <dithering_pars_fragment>

  uniform vec3  uStarColor;
  uniform float uStarBrightness;

  varying float vBrightness;

  void main() {
    // Point sprites are square, so round them off here or the sky fills with
    // tiny boxes.
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float falloff = 1.0 - smoothstep(0.0, 1.0, d);
    if (falloff <= 0.0) discard;

    float alpha = falloff * falloff * vBrightness * uStarBrightness;
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
