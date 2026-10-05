import * as THREE from 'three';
import { GameObject } from '../core/GameObject.js';

// ─────────────────────────────────────────────
// DustEye  –  two floating eyes in the storm, and the jaw beneath them
// ─────────────────────────────────────────────
// What DustEyes spawns: a face of quads turned to the player, all custom shaders.
//
//   passive     two yellow eyes, hanging in the murk, bobbing a little —
//               a darker orange once agitated (setAgitated)
//   growl       the eyes burn red and swell; beneath them the jaws, shut —
//               the lower jaw up against the fangs and front teeth
//   aggressive  the jaws gape (uOpen → 1, uClosed → 0): fangs and front
//               teeth along the top, jagged lines of teeth down each side,
//               and a lower jaw across the bottom with its own canines —
//               only teeth, nothing behind them
//
//   const eye = new DustEye();
//   eye.setMode('growl');  eye.setFade(k);  eye.tick(dt, playerEye);
//
// The face turns to look straight at the point it is given — the player's
// eye — every tick, wherever they stand, so it is never seen edge-on; every
// part is drawn from both sides as well.
//
// The eyes are additive and ignore the fog (fog: false) — they are meant to
// glow through the storm. DustEyes dims them with distance itself, a gentler
// curve than the fog's, so they read as lights deep in the dust.
//
// The jaws are drawn in their fragment shader, no texture, on a quad hung
// just under the eyes — and they are only teeth: no mouth behind them, no
// gums. Along the top, a row of small front teeth between two long canines;
// from under the canines, the sides run down and in, writhing slightly, set
// with jagged inward teeth (each its own length); across the bottom, the
// lower jaw — a curve of upward teeth with its own canines. uOpen is how far
// the lower jaw has dropped; shut (uClosed) it is up against the top teeth.
//
// Behind it all, the silhouette: a circle of dust round the face, its edge
// ragged and moving.
//
// Behind both hangs the silhouette: a tall, soft-edged shape of denser
// dust — a head round the eyes and a body tapering away below, its edges
// writhing — drawn in the storm's own brown, a shade darker
// (setSilhouetteColor; DustEyes feeds it the live fog colour). It dissolves
// into the storm toward its feet.
// ─────────────────────────────────────────────

/** Tuning. Metres unless stated. */
export const DUST_EYE = {
  passiveColor:    0xffcf33,
  /** Watching, but agitated (an eye that was seen through the window). */
  agitatedColor:   0xb8560c,
  aggressiveColor: 0xc4420a,
  /** One eye's glow quad, and the gap between the eyes' centres. The quad
   *  is mostly halo, so it reads from across the yard in the storm. */
  eyeSize: 0.75,
  eyeSpacing: 0.36,
  /** How bright the eyes burn. */
  eyeIntensity: 1.6,
  /** The eyes swell by this much when it turns. */
  aggressiveScale: 1.35,
  /** The jaw's quad, hung just below the eyes. */
  jawSize: [0.8, 0.85],
  jawDrop: 0.1,
  /** How fast the jaw grows in (and opens), per second. */
  jawRate: 3,
  /** How much of the jaw shows while it is shut. */
  closedLength: 0.2,
  /** The silhouette: a circle of dust round the face — its quad (square),
   *  and how far it reaches above the eyes. */
  bodySize: [2.0, 2.0],
  bodyAbove: 0.55,
  /** Its colour until the scene tints it: storm brown, darker. */
  bodyColor: 0x3a2818,
  /** Peak alpha — dense, but the storm still shows through. */
  bodyOpacity: 0.9,
  /** Bob: metres and radians per second. */
  bobHeight: 0.08,
  bobRate: 1.3,
};

export class DustEye extends GameObject {
  /** 'passive', 'growl' or 'aggressive'. */
  mode = 'passive';
  /** Agitated: watching eyes burn darker orange (setAgitated). */
  agitated = false;

  constructor(name = 'DustEye') {
    super(name);

    /** Everything that faces the camera; the GameObject itself only moves. */
    this.face = new THREE.Group();
    this.object3d.add(this.face);

    this.eyeMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uColor:     { value: new THREE.Color(DUST_EYE.passiveColor) },
        uFade:      { value: 1 },
        uIntensity: { value: DUST_EYE.eyeIntensity },
      },
      vertexShader: QUAD_VERTEX_SHADER,
      fragmentShader: EYE_FRAGMENT_SHADER,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      side: THREE.DoubleSide,
    });
    const eyeGeometry = new THREE.PlaneGeometry(DUST_EYE.eyeSize, DUST_EYE.eyeSize);
    this.eyes = [-1, 1].map(side => {
      const mesh = new THREE.Mesh(eyeGeometry, this.eyeMaterial);
      mesh.position.x = side * DUST_EYE.eyeSpacing / 2;
      mesh.name = side < 0 ? 'DustEyeLeft' : 'DustEyeRight';
      this.face.add(mesh);
      return mesh;
    });

    const [jw, jh] = DUST_EYE.jawSize;
    this.jawMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uOpen:     { value: 0 },
        uClosed:   { value: 1 },
        uFade:     { value: 1 },
        uTime:     { value: 0 },
      },
      vertexShader: QUAD_VERTEX_SHADER,
      fragmentShader: JAW_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      fog: false,
      side: THREE.DoubleSide,
    });
    this.jaw = new THREE.Mesh(new THREE.PlaneGeometry(jw, jh), this.jawMaterial);
    this.jaw.name = 'DustEyeJaw';
    this.jaw.position.y = -DUST_EYE.jawDrop - jh / 2;
    this.jaw.visible = false;
    this.face.add(this.jaw);

    const [bw, bh] = DUST_EYE.bodySize;
    this.bodyMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uColor:   { value: new THREE.Color(DUST_EYE.bodyColor) },
        uFade:    { value: 1 },
        uTime:    { value: 0 },
        uOpacity: { value: DUST_EYE.bodyOpacity },
        uSize:    { value: new THREE.Vector2(bw, bh) },
        // Where the eyes sit in the quad, metres from its bottom-left.
        uEyes:    { value: new THREE.Vector2(bw / 2, bh - DUST_EYE.bodyAbove) },
      },
      vertexShader: QUAD_VERTEX_SHADER,
      fragmentShader: BODY_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      fog: false,
      side: THREE.DoubleSide,
    });
    this.body = new THREE.Mesh(new THREE.PlaneGeometry(bw, bh), this.bodyMaterial);
    this.body.name = 'DustEyeBody';
    this.body.position.y = DUST_EYE.bodyAbove - bh / 2;
    this.face.add(this.body);

    // Silhouette first, then the jaw over it, then the eyes over both —
    // all after the dust grains.
    this.body.renderOrder = 9;
    this.jaw.renderOrder = 10;
    for (const eye of this.eyes) eye.renderOrder = 11;
    for (const mesh of [...this.eyes, this.jaw, this.body]) mesh.castShadow = false;

    this._time = Math.random() * 10;
  }

  /** @param {'passive'|'growl'|'aggressive'} mode */
  setMode(mode) {
    this.mode = mode;
    const angry = mode !== 'passive';
    this.eyeMaterial.uniforms.uColor.value.setHex(angry ? DUST_EYE.aggressiveColor : this._watchColor());
    const s = angry ? DUST_EYE.aggressiveScale : 1;
    for (const eye of this.eyes) eye.scale.setScalar(s);
    this.jaw.visible = angry;
    if (!angry) {
      this.jawMaterial.uniforms.uOpen.value = 0;
      this.jawMaterial.uniforms.uClosed.value = 1;
    }
  }

  /** 0 … 1, the whole face. */
  setFade(k) {
    this.eyeMaterial.uniforms.uFade.value = k;
    this.jawMaterial.uniforms.uFade.value = k;
    this.bodyMaterial.uniforms.uFade.value = k;
  }

  /** Agitated or not: how the watching eyes burn. */
  setAgitated(on) {
    this.agitated = !!on;
    if (this.mode === 'passive') this.eyeMaterial.uniforms.uColor.value.setHex(this._watchColor());
  }

  _watchColor() {
    return this.agitated ? DUST_EYE.agitatedColor : DUST_EYE.passiveColor;
  }

  /** How bright the eyes burn, as a fraction of eyeIntensity. */
  setIntensity(k) {
    this.eyeMaterial.uniforms.uIntensity.value = DUST_EYE.eyeIntensity * k;
  }

  /** The silhouette's colour — the storm's, a shade darker. */
  setSilhouetteColor(color) {
    this.bodyMaterial.uniforms.uColor.value.copy(color);
  }

  /** Look at `target` (the player's eye), bob, and grow the jaw in. */
  tick(dt, target) {
    this._time += dt;
    this.face.position.y = Math.sin(this._time * DUST_EYE.bobRate) * DUST_EYE.bobHeight;
    // +Z of the face (the quads' front) toward the player.
    this.face.lookAt(target);
    const u = this.jawMaterial.uniforms;
    u.uTime.value = this._time;
    this.bodyMaterial.uniforms.uTime.value = this._time;
    if (this.mode === 'passive') return;
    // Shut, a stub of jaw shows; gaping, the whole of it.
    const open = this.mode === 'aggressive' ? 1 : DUST_EYE.closedLength;
    const closed = this.mode === 'aggressive' ? 0 : 1;
    const step = dt * DUST_EYE.jawRate;
    u.uOpen.value += Math.max(-step, Math.min(step, open - u.uOpen.value));
    u.uClosed.value += Math.max(-step, Math.min(step, closed - u.uClosed.value));
  }

  dispose() {
    this.eyes[0].geometry.dispose();
    this.jaw.geometry.dispose();
    this.eyeMaterial.dispose();
    this.jawMaterial.dispose();
    this.body.geometry.dispose();
    this.bodyMaterial.dispose();
  }
}

// The silhouette: a circle of dust round the face, in metres measured from
// between the eyes (p). Its edge is ragged and moving, and it is soft all
// round, thinning toward the rim.
const BODY_FRAGMENT_SHADER = /* glsl */`
  uniform vec3  uColor;
  uniform float uFade;
  uniform float uTime;
  uniform float uOpacity;
  uniform vec2  uSize;
  uniform vec2  uEyes;

  varying vec2 vUv;

  void main() {
    vec2 p = vUv * uSize - uEyes;   // metres from between the eyes
    // The circle's centre sits a little below the eyes, so it takes in the jaw.
    vec2 q = p - vec2(0.0, -(0.5 * uSize.y - (uSize.y - uEyes.y)));
    float r = 0.5 * uSize.x * 0.92;
    float a = atan(q.y, q.x);
    float ragged = 0.05 * sin(a * 5.0 + uTime * 1.1) + 0.035 * sin(a * 9.0 - uTime * 1.7) + 0.02 * sin(a * 17.0 + uTime * 2.3);
    float d = length(q) / (r * (1.0 + ragged));
    float shape = 1.0 - smoothstep(0.55, 1.0, d);
    float alpha = shape * uOpacity * uFade;
    if (alpha <= 0.002) discard;
    gl_FragColor = vec4(uColor, alpha);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const QUAD_VERTEX_SHADER = /* glsl */`
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// A white-hot core inside a coloured glow that falls off fast, so two of
// them side by side read as eyes, not as one smear — and a faint wide halo
// round both, the light caught in the dust, so they read from far off.
// Additive: the colour is the light added, so alpha is left at 1 rather
// than fading it twice.
const EYE_FRAGMENT_SHADER = /* glsl */`
  uniform vec3  uColor;
  uniform float uFade;
  uniform float uIntensity;

  varying vec2 vUv;

  void main() {
    float d = length(vUv - 0.5) * 2.0;
    if (d >= 1.0) discard;
    float core = 1.0 - smoothstep(0.0, 0.2, d);
    float glow = pow(1.0 - smoothstep(0.0, 0.55, d), 2.0);
    float halo = pow(1.0 - d, 2.0) * 0.35;
    vec3 color = uColor * (glow * 1.4 + core + halo) + vec3(1.0, 0.95, 0.85) * core * 0.7;
    gl_FragColor = vec4(color * uIntensity * uFade, 1.0);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

// The canine jaws, in the quad's uv: c across from the middle (-0.5 … 0.5),
// down from the top (0 … 1). Only teeth are drawn; everything else is
// discarded, so the silhouette and the storm show between them.
const JAW_FRAGMENT_SHADER = /* glsl */`
  uniform float uOpen;
  uniform float uClosed;
  uniform float uFade;
  uniform float uTime;

  varying vec2 vUv;

  // 0 at a tooth's tip, 1 between two teeth: a sawtooth.
  float row(float x, float n) {
    return abs(fract(x * n) - 0.5) * 2.0;
  }

  // A fixed 0 … 1 per tooth, so each is its own length.
  float hash(float n) {
    return fract(sin(n * 91.7 + 12.3) * 43758.5453);
  }

  // A tapering canine: t runs root 0 → tip 1.
  float canine(float ac, float t, float at, float halfW) {
    if (t < 0.0 || t > 1.0) return 0.0;
    return 1.0 - smoothstep(0.0, 0.012, abs(ac - at) - halfW * (1.0 - t));
  }

  void main() {
    float c = vUv.x - 0.5;
    float ac = abs(c);
    float down = 1.0 - vUv.y;
    float W = mix(1.0, 0.85, uClosed);
    // Where the lower jaw sits: dropped by uOpen, up against the top teeth shut.
    float bottom = mix(0.14, 0.94, clamp(uOpen, 0.0, 1.0));

    // The front teeth: a short row between the canines, hanging from a thin bar.
    float frontW = 0.17 * W;
    float bar = step(ac, frontW) * step(0.01, down) * step(down, 0.03);
    float frontTip = 0.03 + 0.055 * (1.0 - row(c, 24.0)) * (0.6 + 0.4 * hash(floor(c * 24.0)));
    float front = step(ac, frontW) * step(0.03, down) * step(down, frontTip);

    // The upper canines, curving in a little toward their tips.
    float fangT = down / 0.24;
    float fangs = canine(ac, fangT, (0.27 - 0.03 * clamp(fangT, 0.0, 1.0)) * W, 0.045);

    // The sides: from under the canines down to the lower jaw, drawing in a
    // little and writhing, set with inward teeth of uneven length.
    float lineX = W * (0.31 - 0.08 * down) + 0.008 * sin(down * 20.0 + uTime * 2.5);
    float side = step(0.12, down) * step(down, bottom);
    float edge = 1.0 - smoothstep(0.0, 0.012, abs(ac - lineX) - 0.013);
    float id = floor(down * 14.0);
    float sideTeeth = (0.025 + 0.035 * hash(id + 3.0)) * (1.0 - row(down, 14.0));
    float inward = step(lineX - 0.013 - sideTeeth, ac) * step(ac, lineX);
    float sides = side * max(edge, inward);

    // The lower jaw: a curve across the bottom between the sides, deepest in
    // the middle, set with upward teeth, a canine standing near each end.
    float xb = W * (0.31 - 0.08 * bottom);
    float across = clamp(ac / max(xb, 1e-3), 0.0, 1.0);
    float jawLine = bottom - 0.07 * across * across;
    float lowerJaw = step(ac, xb) * (1.0 - smoothstep(0.0, 0.012, abs(down - jawLine) - 0.014));
    float lowTeeth = (0.03 + 0.03 * hash(floor(c * 22.0) + 9.0)) * (1.0 - row(c, 22.0));
    float upward = step(ac, xb * 0.92) * step(jawLine - 0.014 - lowTeeth, down) * step(down, jawLine);
    float lowCanine = canine(ac, (jawLine - down) / 0.13, xb * 0.72, 0.035);

    float tooth = max(max(bar, front), max(fangs, max(sides, max(max(lowerJaw, upward), lowCanine))));
    if (tooth < 0.5) discard;
    gl_FragColor = vec4(vec3(1.0, 0.97, 0.92), uFade);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
