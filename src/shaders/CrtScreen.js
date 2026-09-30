import * as THREE from 'three';

// ─────────────────────────────────────────────
// CrtScreen  –  the terminal monitor's picture: a green radar on a tube
// ─────────────────────────────────────────────
// A ShaderMaterial for a thin plane in front of the retro computer's glass.
// Four uniforms carry the game's state into it, and nothing else:
//
//   uTime    seconds; turns the sweep and reshuffles the static
//   uSignal  0 … 1, how far the dish's scan has got — the sweep's afterglow
//            shortens and a lock ring closes on the target as it rises
//   uNoise   0 … 1, how much static: some while the dish sits idle, almost
//            none mid-scan, all of it while the power stutters or a Watcher
//            peers in
//   uPower   0 … 1, the tube's supply; the picture squashes to a line and
//            goes black as it drops, the way an old set switches off
//
// The CrtScreen component (src/components/CrtScreen.js) writes them every
// frame. The vertex shader bows the plane's middle out like curved glass;
// the fragment shader does everything else. Every GLSL line says what it
// does in plain words, so anyone on the team can walk through it.
//
// Unlit on purpose: a screen makes its own light. It skips the fog (it is a
// metre from the eye) but keeps three's tone mapping and colour space, like
// the sky does, so it sits in the same picture as every lit material.
// ─────────────────────────────────────────────

export const CRT_VERTEX_SHADER = /* glsl */`
  // Handed to the fragment shader: where on the screen this point is,
  // (0,0) bottom-left to (1,1) top-right.
  varying vec2 vUv;

  void main() {
    // Pass the texture coordinate straight through.
    vUv = uv;

    // The same point, but centred: -1 … 1 across and up.
    vec2 c = uv * 2.0 - 1.0;

    // How far to push this vertex out of the plane: BULGE at the centre,
    // falling to 0 along every edge, so the plane curves like a tube's glass.
    float bow = BULGE * (1.0 - c.x * c.x) * (1.0 - c.y * c.y);

    // The plane faces its own +Z, so pushing along Z bows it toward the eye.
    vec3 bulged = position + vec3(0.0, 0.0, bow);

    // The usual last step: model → camera → screen.
    gl_Position = projectionMatrix * modelViewMatrix * vec4(bulged, 1.0);
  }
`;

export const CRT_FRAGMENT_SHADER = /* glsl */`
  // three's own snippets for the final colour step (see the end of main).
  #include <common>

  uniform float uTime;
  uniform float uSignal;
  uniform float uNoise;
  uniform float uPower;

  varying vec2 vUv;

  // The screen is wider than it is tall; this is width / height, used to
  // keep circles round.
  const float ASPECT = 1.84;
  // How strongly the picture bends at the edges, like the curved tube.
  const float BARREL = 0.12;
  // How many scanlines run down the screen.
  const float LINES = 150.0;
  // How fast the radar arm turns, in radians a second (one turn in ~2 s).
  const float SWEEP_SPEED = 3.0;
  // Where the dish's target sits on the radar, and how round the glass's
  // corners are.
  const vec2  TARGET = vec2(0.55, 0.25);
  const float CORNER = 0.25;
  // The colour of green phosphor.
  const vec3  PHOSPHOR = vec3(0.25, 1.0, 0.45);

  // A cheap random number: the same point always gives the same 0 … 1
  // value, but neighbouring points give unrelated ones.
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
  }

  void main() {
    // ── The glass ──

    // Centre the coordinates: (0,0) in the middle, -1 … 1 to the edges.
    vec2 p = vUv * 2.0 - 1.0;

    // Round the corners to match the glass: measure how far outside a
    // rounded rectangle this point is (in real proportions), and don't draw
    // it if it is outside.
    vec2 corner = abs(p * vec2(ASPECT, 1.0)) - (vec2(ASPECT, 1.0) - CORNER);
    if (length(max(corner, 0.0)) > CORNER) discard;

    // ── Interference ──

    // Static tears the picture sideways: each thin band of rows gets its own
    // random shift, reshuffled twenty times a second, scaled by uNoise.
    float band = floor(vUv.y * 60.0);
    float tear = hash(vec2(band, floor(uTime * 20.0))) - 0.5;
    p.x += tear * 0.08 * uNoise;

    // ── The tube ──

    // Barrel distortion: push each point outward the further it is from
    // the centre, so straight lines bow like they do on curved glass.
    vec2 d = p * (1.0 + BARREL * dot(p, p));

    // Power: as the supply drops, stretch the picture vertically so only a
    // thinner and thinner line of it stays on the screen.
    d.y /= max(uPower, 0.02);

    // 1 where the bent picture still lands on the tube, 0 in the black
    // border it has been pulled away from.
    float onTube = step(abs(d.x), 1.0) * step(abs(d.y), 1.0);

    // ── The radar ──

    // Position from the centre in real proportions, so the radar is round.
    vec2 r = d * vec2(ASPECT, 1.0);
    // Distance from the centre, and angle round it (-π … π).
    float dist = length(r);
    float ang = atan(r.y, r.x);

    // Faint range rings every third of a unit: fract() repeats 0 … 1 between
    // rings, so its distance from 0.5 peaks (0.5) exactly on each ring.
    float rings = smoothstep(0.46, 0.5, abs(fract(dist * 3.0) - 0.5)) * 0.25;

    // The sweep arm: how far behind the turning arm this point is, 0 … 2π.
    float behind = mod(uTime * SWEEP_SPEED - ang, 6.2831853);
    // The phosphor glows after the arm passes and fades — quickly once the
    // dish has locked on (uSignal near 1), slowly while it is still hunting.
    float sweep = exp(-behind * mix(1.5, 10.0, uSignal));

    // The lock ring: a circle round the target that closes in as the scan
    // progresses, from wide to tight. Hidden until a scan has started.
    float lockRadius = mix(0.9, 0.06, uSignal);
    float lockRing = smoothstep(0.025, 0.0, abs(length(r - TARGET) - lockRadius));
    lockRing *= step(0.001, uSignal);
    // The target itself: a dot that brightens as the signal comes in.
    float blip = smoothstep(0.07, 0.0, length(r - TARGET)) * uSignal;

    // Everything drawn on the radar, as one brightness, over a dim glow.
    float picture = 0.06 + rings + sweep * 0.8 + lockRing + blip;
    vec3 color = PHOSPHOR * picture;

    // ── Static ──

    // Snow: a random grey per little cell, changing thirty times a second,
    // blended in by uNoise.
    float snow = hash(floor(vUv * vec2(240.0, 130.0)) + floor(uTime * 30.0));
    color = mix(color, vec3(snow), uNoise * 0.7);

    // ── The finish ──

    // Scanlines: darken the gaps between the tube's lines.
    color *= 0.75 + 0.25 * sin(vUv.y * LINES * 3.14159);

    // Vignette: the tube is dimmer toward its corners.
    color *= 1.0 - 0.35 * dot(d, d);

    // Black outside the tube, and dimmer as the supply drops.
    color *= onTube * uPower;

    gl_FragColor = vec4(color, 1.0);

    // Hand-written shaders skip three's output stage; these two lines put it
    // back (ACES tone mapping, linear → sRGB), as the sky shader does.
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/**
 * @param {object} [opts]
 * @param {number} [opts.bulge]  How far the plane's centre bows out, in the
 *   mesh's own units (0 = flat). Compiled in: it never changes.
 * @returns {THREE.ShaderMaterial}
 */
export function createCrtMaterial({ bulge = 0 } = {}) {
  return new THREE.ShaderMaterial({
    name: 'CrtScreen',
    uniforms: {
      uTime:   { value: 0 },
      uSignal: { value: 0 },
      uNoise:  { value: 0.3 },
      uPower:  { value: 1 },
    },
    defines: { BULGE: bulge.toFixed(4) },
    vertexShader: CRT_VERTEX_SHADER,
    fragmentShader: CRT_FRAGMENT_SHADER,
    fog: false,
  });
}
