import * as THREE from 'three';
import { GameObject } from '../core/GameObject.js';

// ─────────────────────────────────────────────
// MonsterFigure  –  procedural stand-in for a monster model
// ─────────────────────────────────────────────
// A tall, thin, dark capsule — or, as a shade, a pitch-black silhouette no
// light shows (createShadeMaterial) — with two small eyes that ignore the
// lighting, so they read in the dark and through the fog, and a pale grin
// under them,
// hidden until a threat shows it (`smile`): a wide crescent of
// interlocking teeth wrapped round the face. It is a placeholder: swap
// in a real model by replacing what this returns; `placeholderFor` records
// the file it waits for.
//
// Origin on the floor, facing +Z — Object3D.lookAt turns +Z toward its
// target, so a threat aims the figure with one call. Built hidden, with no
// rigid body or collider: monsters are not physics.
//
// The body casts a shadow unless asked not to (castShadow: false), and the
// shadow maps are frozen between redraws (ShadowScheduler): whoever moves,
// shows or hides a casting figure invalidates them. The geometry and
// materials are fresh per call, so the caller owns them
// (BaseScene._ownResourcesOf).
// ─────────────────────────────────────────────

/** How far in from its outline a shade is fully black: the share of the way
 *  from edge-on (0) to facing the eye (1). Past it, pitch black. */
const SHADE_EDGE = 0.55;

const SHADE_VERTEX = /* glsl */ `
  varying vec3 vNormalView;
  varying vec3 vToEye;
  void main() {
    vec4 view = modelViewMatrix * vec4(position, 1.0);
    vNormalView = normalize(normalMatrix * normal);
    vToEye = -view.xyz;
    gl_Position = projectionMatrix * view;
  }
`;

// Black, always: no lights, no fog, nothing for a torch to show. Only how
// much it hides changes — `opacity` (the fade), and how square-on the eye
// meets the surface, so the outline thins to nothing and the middle is a
// hole in the room.
const SHADE_FRAGMENT = /* glsl */ `
  uniform float opacity;
  uniform float uEdge;
  varying vec3 vNormalView;
  varying vec3 vToEye;
  void main() {
    float facing = abs(dot(normalize(vNormalView), normalize(vToEye)));
    gl_FragColor = vec4(vec3(0.0), opacity * smoothstep(0.0, uEdge, facing));
  }
`;

/**
 * A shadow in itself: pitch black whatever light falls on it, its edges
 * soft. Transparent from the start, and its `opacity` is the shader's, so a
 * fade (the Sleep Demon's _applyOpacity) works on it as on any material.
 */
export function createShadeMaterial({ edge = SHADE_EDGE } = {}) {
  const material = new THREE.ShaderMaterial({
    uniforms: { opacity: { value: 1 }, uEdge: { value: edge } },
    vertexShader: SHADE_VERTEX,
    fragmentShader: SHADE_FRAGMENT,
    transparent: true,
    lights: false,
    fog: false,
  });
  return opacityFromUniform(material);
}

/** The grin: how far round the face it reaches, either side of the front,
 *  radians; and how many teeth fit across it, upper and lower rows offset
 *  by half a tooth so they interlock. */
const GRIN_SWEEP = 60 * Math.PI / 180;
const GRIN_TEETH = 12;

const GRIN_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// The band it is drawn on wraps the face; this cuts the crescent out of it
// and fills it with teeth. x runs corner to corner (−1 … 1), y up the band.
// The lower edge dips deep in the middle and the upper one shallow, both
// rising to meet in a point at each corner. Inside, a row of teeth hangs
// from the top and a row stands from the bottom, half a tooth apart; where
// they meet is a zigzag, so each point bites between two of the other row.
// Dark gaps part the teeth, and they dim a little toward the edges.
const GRIN_FRAGMENT = /* glsl */ `
  uniform float opacity;
  uniform float uTeeth;
  uniform vec3 uColor;
  varying vec2 vUv;
  void main() {
    float x = vUv.x * 2.0 - 1.0;
    float xx = x * x;
    float bottom = 0.95 * xx;
    float top = 0.6 + 0.4 * xx;
    float y = vUv.y;
    if (y <= bottom || y >= top) discard;
    float t = (y - bottom) / (top - bottom);          // 0 lower edge … 1 upper edge
    float k = vUv.x * uTeeth;
    float zig = abs(fract(k) - 0.5) * 2.0;            // 0 mid-tooth … 1 between teeth
    float meet = 0.5 + (zig - 0.5) * 0.2;             // where the rows bite together
    float upper = step(meet, t);
    float f = fract(k + 0.5 * (1.0 - upper));
    float gap = min(f, 1.0 - f);                      // 0 on a gap between teeth
    float tooth = smoothstep(0.07, 0.13, gap) * smoothstep(0.035, 0.075, abs(t - meet));
    float shade = mix(0.7, 1.0, smoothstep(0.0, 0.35, min(t, 1.0 - t)));
    float edge = smoothstep(0.0, 0.03, y - bottom) * smoothstep(0.0, 0.03, top - y);
    gl_FragColor = vec4(uColor * tooth * shade, opacity * edge);
    #include <colorspace_fragment>
  }
`;

/** A material's `opacity` read and written through its shader's own uniform,
 *  so a fade (the Sleep Demon's _applyOpacity) works on it as on any other. */
function opacityFromUniform(material) {
  Object.defineProperty(material, 'opacity', {
    get: () => material.uniforms.opacity.value,
    set: value => { material.uniforms.opacity.value = value; },
    configurable: true,
  });
  return material;
}

/**
 * The grin's band: `segments` strips round a circle of `around` metres about
 * the figure's axis, ±GRIN_SWEEP off its front (+Z), from `low` to `low +
 * tall` metres up. uv runs corner to corner (u) and up the band (v).
 */
function grinBand(around, low, tall, segments = 32) {
  const positions = [];
  const uvs = [];
  const index = [];
  for (let i = 0; i <= segments; i++) {
    const u = i / segments;
    const a = (u * 2 - 1) * GRIN_SWEEP;
    for (const v of [0, 1]) {
      positions.push(Math.sin(a) * around, low + v * tall, Math.cos(a) * around);
      uvs.push(u, v);
    }
    if (i < segments) {
      const n = i * 2;
      index.push(n, n + 2, n + 1, n + 1, n + 2, n + 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(index);
  geometry.computeBoundingSphere();
  return geometry;
}

/** The grin's look: bone-pale teeth, unlit, never fogged. */
function createGrinMaterial(color) {
  return opacityFromUniform(new THREE.ShaderMaterial({
    uniforms: {
      opacity: { value: 1 },
      uTeeth: { value: GRIN_TEETH },
      uColor: { value: new THREE.Color(color) },
    },
    vertexShader: GRIN_VERTEX,
    fragmentShader: GRIN_FRAGMENT,
    transparent: true,
    lights: false,
    fog: false,
  }));
}

/**
 * @param {object} [opts]
 * @param {string} [opts.name]
 * @param {number} [opts.height]   metres, floor to crown
 * @param {number} [opts.radius]   metres
 * @param {number} [opts.color]    body colour
 * @param {number} [opts.eyeColor]
 * @param {string|null} [opts.placeholderFor]
 * @param {number} [opts.smileColor]
 * @param {boolean} [opts.castShadow]  false: nothing on the floor gives it away
 * @param {boolean} [opts.shade]  a shadow in itself: a pitch-black, unlit body
 *        whose edges thin out to nothing (createShadeMaterial), not a solid one
 * @returns {GameObject & { eyes: THREE.Mesh[], smile: THREE.Mesh, placeholderFor: string|null }}
 */
export function createMonsterFigure({
  name = 'Monster', height = 2.4, radius = 0.2,
  color = 0x0b0a0c, eyeColor = 0xff3a22, smileColor = 0xe8e0cc, castShadow = true, shade = false, placeholderFor = null,
} = {}) {
  const go = new GameObject(name);

  // CapsuleGeometry's `length` is the straight middle; the caps add a
  // radius at each end. Lift it so its lowest point is the floor. Both
  // materials are laid down transparent up front: a fade (the Sleep Demon)
  // never swaps a shader state mid-game.
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(radius, height - radius * 2, 4, 10),
    shade ? createShadeMaterial()
      : new THREE.MeshStandardMaterial({ color, roughness: 0.95, metalness: 0, transparent: true }),
  );
  body.name = `${name}Body`;
  body.position.y = height / 2;
  body.castShadow = castShadow;
  go.object3d.add(body);

  // One geometry and one material for both eyes.
  const eyeGeometry = new THREE.SphereGeometry(radius * 0.14, 8, 6);
  const eyeMaterial = new THREE.MeshBasicMaterial({ color: eyeColor, fog: false, transparent: true });
  go.eyes = [-1, 1].map(side => {
    const eye = new THREE.Mesh(eyeGeometry, eyeMaterial);
    eye.name = `${name}Eye`;
    eye.position.set(side * radius * 0.38, height - radius * 0.9, radius * 0.9);
    go.object3d.add(eye);
    return eye;
  });

  // The grin: a crescent of teeth on a band wrapped round the face, just
  // proud of the body below the eyes (see GRIN_FRAGMENT). Unlit like them;
  // hidden, and no shadow, so showing it redraws nothing.
  go.smile = new THREE.Mesh(
    grinBand(radius * 1.03, height - radius * 1.95, radius * 0.65),
    createGrinMaterial(smileColor),
  );
  go.smile.name = `${name}Smile`;
  go.smile.visible = false;
  go.object3d.add(go.smile);

  go.placeholderFor = placeholderFor;
  go.object3d.visible = false;
  return go;
}
