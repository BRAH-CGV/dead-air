import * as THREE from 'three';
import { GameObject } from '../core/GameObject.js';

// ─────────────────────────────────────────────
// DustStorm  –  the grit streaming past the player in a sandstorm
// ─────────────────────────────────────────────
// One point cloud, moved entirely on the GPU. Every grain is a fixed point
// in a box `DUST.box` metres across; the vertex shader blows it along
// uWind by uTime and wraps it back into a box centred on the player
// (uCenter), so the cloud never runs out and nothing is rewritten per
// frame but four uniforms:
//
//   uTime    seconds the storm has run — the drift
//   uWind    the storm's wind, m/s, horizontal (setWind)
//   uCenter  where the player's eye is (tick)
//   uLevel   0 … 1, how hard it blows here (setLevel) — fades it in and out
//
// Each grain carries a seed: its own speed off the wind, a gusting wobble,
// and its size. Grains fade out near the box's edge, so the wrap never
// shows, and right in front of the eye, so none sticks to the lens.
//
//   const dust = new DustStorm();
//   dust.setWind(angle, 9);  dust.setLevel(k);  dust.tick(dt, eye);
//
// The building is cut out of it (setCutouts, the rooms' and corridors'
// bounds, as for the UFO's beam): a grain inside one is dropped in the
// vertex shader, so the grit can be shown from indoors and blow past the
// window without ever drifting through a room.
//
// Undrawn (visible = false) while calm. It is not a light, so hiding it
// recompiles nothing; WarmUp shows hidden objects to compile them at boot.
// Parent it on the scene root: it follows the player, so the occlusion
// sort must never file it away.
// ─────────────────────────────────────────────

/** Tuning. Metres unless stated. */
export const DUST = {
  count: 5000,
  /** Side of the box of grains around the player. */
  box: 36,
  /** Height of that box — grains blow low. */
  height: 10,
  /** Point size, in pixels at 1 m. */
  size: 38,
  /** Largest a grain is ever drawn, in pixels. */
  maxSize: 22,
  /** Grain colour: sunless dust lit by the base. */
  color: 0x8a6a4e,
  /** Peak alpha per grain. */
  opacity: 0.55,
};

/** Boxes the shader can cut out — at least every room and corridor. */
const MAX_CUTOUTS = 8;

export class DustStorm extends GameObject {
  constructor({ count = DUST.count } = {}, name = 'DustStorm') {
    super(name);

    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      positions[i * 3]     = (Math.random() - 0.5) * DUST.box;
      positions[i * 3 + 1] = (Math.random() - 0.5) * DUST.height;
      positions[i * 3 + 2] = (Math.random() - 0.5) * DUST.box;
      seeds[i] = Math.random();
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime:    { value: 0 },
        uLevel:   { value: 0 },
        uWind:    { value: new THREE.Vector3(9, 0, 0) },
        uCenter:  { value: new THREE.Vector3() },
        uBox:     { value: new THREE.Vector3(DUST.box, DUST.height, DUST.box) },
        uSize:    { value: DUST.size },
        uMaxSize: { value: DUST.maxSize },
        uColor:   { value: new THREE.Color(DUST.color) },
        uOpacity: { value: DUST.opacity },
        uCutoutMin:   { value: Array.from({ length: MAX_CUTOUTS }, () => new THREE.Vector3()) },
        uCutoutMax:   { value: Array.from({ length: MAX_CUTOUTS }, () => new THREE.Vector3()) },
        uCutoutCount: { value: 0 },
      },
      vertexShader: DUST_VERTEX_SHADER,
      fragmentShader: DUST_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
    });

    this.points = new THREE.Points(geometry, material);
    this.points.name = 'DustStormGrains';
    // The shader moves every grain to wherever the player is; the bounds
    // three.js would cull against are the unmoved box at the origin.
    this.points.frustumCulled = false;
    this.points.visible = false;
    this.object3d.add(this.points);
  }

  /** How hard it blows where the player is, 0 … 1. 0 stops drawing it. */
  setLevel(level) {
    this.points.material.uniforms.uLevel.value = level;
    this.points.visible = level > 0;
  }

  /** Boxes no grain is drawn in — the building's rooms and corridors.
   *  @param {THREE.Box3[]} boxes  At most MAX_CUTOUTS are used. */
  setCutouts(boxes) {
    const u = this.points.material.uniforms;
    const n = Math.min(boxes.length, MAX_CUTOUTS);
    if (boxes.length > MAX_CUTOUTS) console.warn(`DustStorm: ${boxes.length} cutouts, only ${MAX_CUTOUTS} used`);
    for (let i = 0; i < n; i++) {
      u.uCutoutMin.value[i].copy(boxes[i].min);
      u.uCutoutMax.value[i].copy(boxes[i].max);
    }
    u.uCutoutCount.value = n;
  }

  /** The wind: `angle` radians round from +X, `speed` m/s. */
  setWind(angle, speed) {
    this.points.material.uniforms.uWind.value.set(Math.cos(angle) * speed, 0, Math.sin(angle) * speed);
  }

  /** Advance the drift and keep the box on the player. Nothing while calm. */
  tick(dt, center) {
    if (!this.points.visible) return;
    const u = this.points.material.uniforms;
    u.uTime.value += dt;
    u.uCenter.value.copy(center);
  }

  dispose() {
    this.points.geometry.dispose();
    this.points.material.dispose();
  }
}

const DUST_VERTEX_SHADER = /* glsl */`
  attribute float aSeed;

  uniform float uTime;
  uniform vec3  uWind;
  uniform vec3  uCenter;
  uniform vec3  uBox;
  uniform float uSize;
  uniform float uMaxSize;
  uniform vec3  uCutoutMin[${MAX_CUTOUTS}];
  uniform vec3  uCutoutMax[${MAX_CUTOUTS}];
  uniform int   uCutoutCount;

  varying float vFade;

  void main() {
    // Blown along the wind, each grain at its own speed, gusting up and
    // across as it goes.
    float speed = 0.6 + 0.8 * aSeed;
    vec3 p = position + uWind * uTime * speed;
    float phase = aSeed * 60.0;
    p.y += sin(uTime * (1.1 + aSeed) + phase) * 0.6;
    p += normalize(vec3(-uWind.z, 0.0, uWind.x) + 1e-5) * sin(uTime * 0.7 + phase) * 0.8;

    // Wrapped into a box on the player: a grain blown out one side comes
    // back in the other, so the cloud never runs out.
    vec3 rel = mod(p - uCenter + 0.5 * uBox, uBox) - 0.5 * uBox;
    vec3 world = uCenter + rel;
    vec4 mv = viewMatrix * vec4(world, 1.0);
    gl_Position = projectionMatrix * mv;

    float dist = max(-mv.z, 0.05);
    gl_PointSize = min(uSize * (0.4 + aSeed) / dist, uMaxSize);

    // Gone at the box's edge, so the wrap never shows; and right at the
    // eye, so no grain sticks to the lens.
    vec3 edge = abs(rel) / (0.5 * uBox);
    float atEdge = 1.0 - smoothstep(0.7, 1.0, max(max(edge.x, edge.y), edge.z));
    float atEye = smoothstep(0.4, 1.5, dist);
    vFade = atEdge * atEye;

    // Never inside the building: the fragment shader discards a faded grain.
    for (int i = 0; i < ${MAX_CUTOUTS}; i++) {
      if (i >= uCutoutCount) break;
      if (all(greaterThan(world, uCutoutMin[i])) && all(lessThan(world, uCutoutMax[i]))) vFade = 0.0;
    }
  }
`;

const DUST_FRAGMENT_SHADER = /* glsl */`
  uniform vec3  uColor;
  uniform float uLevel;
  uniform float uOpacity;

  varying float vFade;

  void main() {
    // Round, soft grains — point sprites are square.
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float soft = 1.0 - smoothstep(0.2, 1.0, d);
    float alpha = soft * vFade * uLevel * uOpacity;
    if (alpha <= 0.002) discard;
    gl_FragColor = vec4(uColor, alpha);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
