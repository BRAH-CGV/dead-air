import * as THREE from 'three';
import { GameObject } from '../core/GameObject.js';
import { makeNoise2D, fbm } from '../core/Noise.js';
import { makeRandom, randRange } from '../core/Random.js';

// ─────────────────────────────────────────────
// WindowGlass  –  the pane you can tell is there
// ─────────────────────────────────────────────
// Clean glass with nothing reflected in it is invisible, and reflections
// cost a second render of the scene. So this glass is dirty instead: a thin
// film of dust, thick along the bottom of each pane and in its corners,
// streaked where a sleeve was dragged across it, with a few handprints.
//
//   const glass = room.root.addChild(new WindowGlass({
//     width: 8.5, height: 2.35,
//     dividers: { x: [2.83, 5.67], y: [1.175], width: 0.08 },   // mullions, crossbar
//   }));
//   glass.object3d.position.set(0, 1.65, -5);   // the middle of the opening
//   glass.addLight(ceilingLight, 0.06);         // what the film shows by
//
// The pane faces +Z, centred on its origin. It is only the look: the solid
// part of a window is the collider Room builds in the opening.
//
// What it costs, since it covers half the screen from the desk:
//
// - **Unlit.** One texture read per pixel. A lit material would run every
//   lamp in the base, shadows included, over the whole window.
// - **The film is baked** once (smudgeMap) into a one-byte-a-texel texture,
//   256 KB, and shared by every glass built from the same numbers — a
//   restart rebuilds the scene, not the map.
// - **It still answers to the light.** The film has no light of its own, so
//   it would glow in a dark room. Each draw, onBeforeRender adds up the
//   lamps it was given (addLight) into the uLight uniform: colour × level ×
//   gain. The power grid zeroes lights and never hides them, so a power cut,
//   a blown bulb, the flicker of a surge and the dawn all show on the glass
//   without anyone telling it.
// - **Seen edge-on it thickens** (uGrazing): a look along the pane goes
//   through more film than a look straight through it. That is the one
//   view-dependent thing glass does that is nearly free.
//
// It never writes depth — a see-through card that does hides whatever is
// drawn after it from behind, here the dust and the eyes in the storm — and
// it casts no shadow, so the moonlight still comes in.
//
// It owns its geometry, material and texture; dispose() frees them.
// ─────────────────────────────────────────────

export const WINDOW_GLASS = {
  /** The film's own colour: pale dust. */
  color: 0x9a8b7a,
  /** How much of the view the film takes where it is thickest, looked at
   *  straight on. The one number to turn for "more / less dirty". */
  opacity: 0.12,
  /** How many times thicker the film can look, seen edge-on. */
  grazing: 2,
  /** Texels across and up. One byte each. */
  size: [1024, 256],
  seed: 1977,
};

/** The film, layer by layer. Densities are 0 … 1 of `opacity`; distances
 *  are metres. */
const FILM = {
  /** The haze, in patches with clear glass between them — an even coat
   *  would only grey the whole view — and the size of those patches. */
  haze: 0.2, hazeScale: 0.9,
  /** Dust settled on the bottom edge: how dense, how high it drifts up the
   *  glass, and how much that height wanders along the edge. */
  settled: 1, settledHeight: 0.06, settledWander: 0.7,
  /** Dust caught down the sides and under the top edge. */
  sides: 0.5, sidesReach: 0.035,
  top: 0.3, topReach: 0.025,
  /** The fillet of dust in the two bottom corners. */
  corners: 0.8, cornersReach: 0.13,
  /** Wipe marks: thin streaks, slightly off level, in patches. */
  streaks: 0.4, streakSpacing: 0.045, streakSlope: 0.12, streakPatch: 0.7,
  /** Handprints and smears, about where a hand reaches. */
  smears: 7, smear: [0.3, 0.55], smearRadius: [0.1, 0.2], smearHeight: [0.35, 0.8],
};

/** Baked maps by their numbers: every glass of one size shares one array. */
const MAPS = new Map();

/**
 * The film's density over a window, as a texture's worth of bytes.
 *
 * @param {object} opts
 * @param {number} opts.width   The opening, in metres.
 * @param {number} opts.height
 * @param {{x?: number[], y?: number[], width?: number}} [opts.dividers]
 *        Where the mullions (x) and crossbars (y) cut the opening into panes,
 *        in metres from its bottom-left corner, and how wide those bars are.
 *        Dust gathers against them as it does against the frame.
 * @param {number[]} [opts.size]  Texels, [columns, rows].
 * @param {number} [opts.seed]
 * @returns {{data: Uint8Array, columns: number, rows: number, width: number, height: number}}
 *          Row 0 is the bottom of the window. Shared — don't write to it.
 */
export function smudgeMap({ width, height, dividers = {}, size = WINDOW_GLASS.size, seed = WINDOW_GLASS.seed }) {
  const key = JSON.stringify([width, height, dividers, size, seed]);
  const cached = MAPS.get(key);
  if (cached) return cached;

  const [columns, rows] = size;
  const bar = (dividers.width ?? 0) / 2;
  const spansX = paneSpans(width, dividers.x, bar);
  const spansY = paneSpans(height, dividers.y, bar);

  const haze    = makeNoise2D(seed);
  const wander  = makeNoise2D(seed + 1);
  const streak  = makeNoise2D(seed + 2);
  const patch   = makeNoise2D(seed + 3);
  const mottle  = makeNoise2D(seed + 4);
  const smears  = placeSmears(width, height, seed + 5);

  const data = new Uint8Array(columns * rows);
  for (let r = 0; r < rows; r++) {
    const y = (r + 0.5) / rows * height;
    const [bottom, top] = edgeDistances(spansY, y);
    for (let c = 0; c < columns; c++) {
      const x = (c + 0.5) / columns * width;
      const [left, right] = edgeDistances(spansX, x);
      const side = Math.min(left, right);

      // Each layer is how much of the glass it covers; they pile up the way
      // coats of dust do (1 − Π(1 − layer)), so two thick ones never pass 1.
      let clear = 1;

      clear *= 1 - FILM.haze * smoothstep(-0.15, 0.5, fbm(haze, x / FILM.hazeScale, y / FILM.hazeScale, { octaves: 4 }));

      const drift = FILM.settledHeight * (1 + FILM.settledWander * fbm(wander, x * 4, y * 4, { octaves: 3 }));
      clear *= 1 - FILM.settled * Math.exp(-bottom / drift);
      clear *= 1 - FILM.sides * Math.exp(-side / FILM.sidesReach);
      clear *= 1 - FILM.top * Math.exp(-top / FILM.topReach);
      clear *= 1 - FILM.corners * Math.exp(-(bottom + side) / FILM.cornersReach);

      // Streaks: noise stretched along a line a little off level, cubed so
      // only its crests are left, and only in patches.
      const across = y - x * FILM.streakSlope;
      const line = 0.5 + 0.5 * streak(x * 1.3, across / FILM.streakSpacing);
      const where = smoothstep(0.05, 0.45, fbm(patch, x / FILM.streakPatch, y / FILM.streakPatch, { octaves: 2 }));
      clear *= 1 - FILM.streaks * line * line * line * where;

      for (const s of smears) {
        const dx = (x - s.x) / s.rx;
        const dy = (y - s.y) / s.ry;
        const d2 = dx * dx + dy * dy;
        if (d2 > 6) continue;
        const blotch = 0.7 + 0.3 * mottle(x * 14, y * 14);
        clear *= 1 - s.density * Math.exp(-d2) * blotch;
      }

      data[r * columns + c] = Math.round(255 * Math.min(1, Math.max(0, 1 - clear)));
    }
  }

  const map = { data, columns, rows, width, height };
  MAPS.set(key, map);
  return map;
}

/** The glass between the bars: [from, to] per pane along one axis, each bar
 *  taking half its width off the panes either side. */
function paneSpans(length, dividers = [], bar) {
  const cuts = [...dividers].sort((a, b) => a - b);
  const spans = [];
  let from = 0;
  for (const cut of cuts) {
    spans.push([from, cut - bar]);
    from = cut + bar;
  }
  spans.push([from, length]);
  return spans;
}

/** Distance from `at` to the near and far edge of the pane it is in — both
 *  zero under a bar. Returns a shared pair. */
const _edges = [0, 0];
function edgeDistances(spans, at) {
  _edges[0] = _edges[1] = 0;
  for (const [from, to] of spans) {
    if (at < from) break;
    if (at <= to) {
      _edges[0] = at - from;
      _edges[1] = to - at;
      break;
    }
  }
  return _edges;
}

/** A few handprints and smears: soft ellipses, wider than tall or the other
 *  way, at about the height a hand lands. */
function placeSmears(width, height, seed) {
  const rand = makeRandom(seed);
  const smears = [];
  for (let i = 0; i < FILM.smears; i++) {
    const radius = randRange(rand, ...FILM.smearRadius);
    const squash = randRange(rand, 0.6, 1.5);
    smears.push({
      x: randRange(rand, 0.06, 0.94) * width,
      y: randRange(rand, ...FILM.smearHeight) * height,
      rx: radius * squash,
      ry: radius / squash,
      density: randRange(rand, ...FILM.smear),
    });
  }
  return smears;
}

function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

const GLASS_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormal;     // view space
  varying vec3 vToCamera;   // view space, from the surface back to the eye

  void main() {
    vUv = uv;
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalMatrix * normal;
    vToCamera = -viewPosition.xyz;
    gl_Position = projectionMatrix * viewPosition;
  }
`;

const GLASS_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uSmudges;   // how thick the film is here, baked (red)
  uniform vec3 uColor;          // the film's own colour
  uniform vec3 uLight;          // the light on the glass right now
  uniform float uOpacity;       // how much the thickest film hides, straight on
  uniform float uGrazing;       // how many times thicker it can look edge-on

  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vToCamera;

  void main() {
    float film = texture2D(uSmudges, vUv).r;

    // A look along the glass passes through more film than a look straight
    // through it: 1 / cos of the angle off the pane's normal, capped. abs()
    // because the pane is seen from both sides.
    float facing = abs(dot(normalize(vNormal), normalize(vToCamera)));
    float thickness = min(1.0 / max(facing, 0.001), uGrazing);

    gl_FragColor = vec4(uColor * uLight, min(film * uOpacity * thickness, 1.0));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export class WindowGlass extends GameObject {
  /** The lamps the film shows by. @type {{light: THREE.Light, gain: number}[]} */
  _lights = [];

  /**
   * @param {object} opts  `width`, `height`, `dividers` as for smudgeMap.
   * @param {string} [opts.name='WindowGlass']
   */
  constructor({ name = 'WindowGlass', width, height, dividers } = {}) {
    super(name);

    const map = smudgeMap({ width, height, dividers });
    const texture = new THREE.DataTexture(map.data, map.columns, map.rows, THREE.RedFormat, THREE.UnsignedByteType);
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;

    const uLight = new THREE.Vector3();
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uSmudges: { value: texture },
        uColor:   { value: new THREE.Color(WINDOW_GLASS.color) },
        uLight:   { value: uLight },
        uOpacity: { value: WINDOW_GLASS.opacity },
        uGrazing: { value: WINDOW_GLASS.grazing },
      },
      vertexShader: GLASS_VERTEX_SHADER,
      fragmentShader: GLASS_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    /** @type {THREE.Mesh} */
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
    this.mesh.name = name;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;

    // Read the lamps as late as possible — at the draw — so whatever dimmed
    // them this frame is already in.
    const lights = this._lights;
    this.mesh.onBeforeRender = () => {
      uLight.set(0, 0, 0);
      for (let i = 0; i < lights.length; i++) {
        const { light, gain } = lights[i];
        const level = light.intensity * gain;
        uLight.x += light.color.r * level;
        uLight.y += light.color.g * level;
        uLight.z += light.color.b * level;
      }
    };

    this.object3d.add(this.mesh);
  }

  /**
   * A light the film shows by. Its colour and intensity are read live.
   * @param {THREE.Light} light
   * @param {number} gain  How much of it reaches the glass: for a lamp of
   *        `intensity` candela `d` metres off, about 1 / (π d).
   */
  addLight(light, gain) {
    this._lights.push({ light, gain });
    return this;
  }

  /** Free the geometry, the material and the film texture. */
  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.uniforms.uSmudges.value.dispose();
    this.mesh.material.dispose();
  }
}
