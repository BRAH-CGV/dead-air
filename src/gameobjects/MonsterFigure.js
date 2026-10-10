import * as THREE from 'three';
import { GameObject } from '../core/GameObject.js';

// ─────────────────────────────────────────────
// MonsterFigure  –  procedural stand-in for a monster model
// ─────────────────────────────────────────────
// A tall, thin, dark capsule — or, as a shade, a pitch-black silhouette no
// light shows (createShadeMaterial) — with two small eyes that ignore the
// lighting, so they read in the dark and through the fog, and a pale grin
// under them,
// hidden until a threat shows it (`smile`): a thin, wide, shallow curve
// wrapped round the face, its corners turned up. It is a placeholder: swap
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
  Object.defineProperty(material, 'opacity', {
    get: () => material.uniforms.opacity.value,
    set: value => { material.uniforms.opacity.value = value; },
    configurable: true,
  });
  return material;
}

/** Half the grin's sweep round the face, radians. */
const SMILE_SWEEP = 62 * Math.PI / 180;

/** The grin's line: round a circle of `around` metres about the figure's
 *  axis, ±SMILE_SWEEP off its front (+Z), `low` metres up in the middle and
 *  `rise` higher at the corners: one smooth, shallow arc. */
class SmileCurve extends THREE.Curve {
  constructor(around, low, rise) {
    super();
    Object.assign(this, { around, low, rise });
  }

  getPoint(t, target = new THREE.Vector3()) {
    const u = t * 2 - 1;                    // −1 … 1, corner to corner
    const a = u * SMILE_SWEEP;
    return target.set(Math.sin(a) * this.around, this.low + this.rise * u * u, Math.cos(a) * this.around);
  }
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

  // The grin: a thin tube along a shallow curve wrapped round the face, just
  // proud of the body below the eyes — lowest in the middle, its corners
  // turned up. Unlit like them; hidden, and no shadow, so showing it redraws
  // nothing.
  go.smile = new THREE.Mesh(
    new THREE.TubeGeometry(new SmileCurve(radius * 1.04, height - radius * 1.85, radius * 0.24), 32, radius * 0.025, 5),
    new THREE.MeshBasicMaterial({ color: smileColor, fog: false, transparent: true }),
  );
  go.smile.name = `${name}Smile`;
  go.smile.visible = false;
  go.object3d.add(go.smile);

  go.placeholderFor = placeholderFor;
  go.object3d.visible = false;
  return go;
}
