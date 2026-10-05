import * as THREE from 'three';
import { GameObject } from '../core/GameObject.js';
import { Component } from '../core/Component.js';
import { WIND_DIRECTION } from '../gameplay/Sandstorm.js';

// ─────────────────────────────────────────────
// DustClouds  –  low billowing dust drifting past outside
// ─────────────────────────────────────────────
// Soft, ragged clouds of dust rolling along the ground in the yard and past
// the office window — a rare few on a calm night, faint and blended into the
// dark (mostly the fog's own colour, uBlend), and a wall of them in a
// sandstorm (DustCloudsMotion.setStorm, driven by Sandstorm). They stay low,
// so the sky stays above them.
//
// One mesh, one draw call: a quad per cloud, written once at build. The
// vertex shader does the rest —
//
//   where     each cloud is a fixed seed in a CLOUDS.area square that
//             follows the camera; the wind's drift (windDrift: steady, with
//             gusts) carries them all downwind along WIND_DIRECTION, and each
//             surges, meanders and swells on its own phases. Positions wrap
//             into the square, so walking never drags the dust along.
//   facing    each quad turns to the camera about the vertical — a cloud
//             stands upright, never tips over.
//   fading    out toward the square's edge (no dust beyond ~45 m), out close
//             to the camera (CLOUDS…near: a cloud never fills the screen),
//             and thinning and thickening on its own.
//   indoors   a cloud fades away as its centre drifts up to the building
//             (uFootprint: over uWallFade metres outside uClearance), and
//             inside the clearance isn't drawn — no popping at the window.
//
// The fragment shader cuts the cloud's outline: a billowing top line read
// from a small tiling noise texture (built here, no file) twice, scrolling,
// so the billows roll; inside, the same noise for texture. Any pixel inside
// a room or corridor (uCutoutMin/Max) is thrown away, so dust never shows
// through a wall into a room. It is fogged by hand with the scene's own fog
// (uFogColor, uFogDensity), so in a storm the far clouds sink into the murk
// with everything else. Rust at night, pale dust by day (setDaylight).
//
// A storm (0 … 1, eased over storm.ramp) brings more clouds (the draw range),
// bigger, thicker, faster (their clock runs quicker), and closer — to the
// walls and to the player. Nothing is rebuilt; it is all uniforms.
//
// Unlit, no shadows, no depth write. Parented on the scene root, not Outside:
// it follows the camera, so the occlusion sort must never file it away.
// ─────────────────────────────────────────────

/** Tuning. Metres, seconds. */
export const CLOUDS = {
  /** The square of ground the clouds are scattered over, on the camera. */
  area: 90,
  /** A cloud's size on a calm night: width and height ranges. */
  width: [4.8, 8.8],
  height: [1.4, 2.5],
  /** The wind: speed (m/s), how hard it gusts (fraction), and how often (s). */
  speed: 2.6,
  gust: 0.45,
  gustPeriod: 11,
  /** Rust at night, pale dust by day. */
  nightColor: 0x583427,
  dayColor: 0xc9a27a,
  /** Metres outside the clearance over which a cloud fades away as it
   *  drifts up to the building — so it never pops out at the wall. */
  wallFade: 5,
  /** A calm night: a rare few, faint, and mostly the fog's own colour
   *  (blend: 0 their own colour … 1 the fog's), so they barely stand out. */
  calm: {
    count: 24,
    opacity: 0.22,
    blend: 0.5,
    /** Kept this far off the building's walls. */
    clearance: 5.5,
    /** Faded in between these distances from the camera. */
    near: [6, 14],
  },
  storm: {
    /** Fewer and fainter than they might be: the storm fog carries most of
     *  the density, and these quads cost overdraw. */
    count: 160,
    opacity: 0.6,
    /** Size, times the calm size. */
    width: 2.5,
    height: 3.4,
    /** Their clock runs this much faster. */
    speed: 2.2,
    clearance: 2.5,
    near: [3.5, 9],
    /** Their own dust colour, in the storm. */
    blend: 0,
    /** Seconds to ease between calm and storm — short: Sandstorm has
     *  already eased the level it hands over. */
    ramp: 0.6,
  },
};

const MAX_CUTOUTS = 8;
const WIND = new THREE.Vector2(WIND_DIRECTION[0], WIND_DIRECTION[1]).normalize();

/**
 * How far the wind has carried the dust by `time`: steadily downwind, with a
 * gust cycle — the integral of speed × (1 + gust · cos), so it surges and
 * slackens but never blows backward.
 * @param {number} time  Seconds (the clouds' own clock).
 * @param {THREE.Vector2} out  (x, z)
 */
export function windDrift(time, out) {
  const { speed, gust, gustPeriod } = CLOUDS;
  const w = (2 * Math.PI) / gustPeriod;
  const along = speed * time + (gust * speed / w) * Math.sin(w * time);
  return out.copy(WIND).multiplyScalar(along);
}

export class DustClouds extends GameObject {
  /**
   * @param {object} [opts]
   * @param {THREE.FogExp2|null} [opts.fog]  The scene fog, read every frame.
   * @param {() => number} [opts.random]
   */
  constructor({ fog = null, random = Math.random } = {}, name = 'DustClouds') {
    super(name);
    this.fog = fog;

    const n = CLOUDS.storm.count;
    const corners = [[-0.5, 0], [0.5, 0], [0.5, 1], [-0.5, 1]];
    const positions = new Float32Array(n * 4 * 3);
    const cloud = new Float32Array(n * 4 * 4);
    const more = new Float32Array(n * 4 * 2);
    const index = new Uint16Array(n * 6);
    for (let i = 0; i < n; i++) {
      const seed = [random(), random(), random(), random(), random(), random()];
      for (let v = 0; v < 4; v++) {
        const k = i * 4 + v;
        positions.set([corners[v][0], corners[v][1], 0], k * 3);
        cloud.set(seed.slice(0, 4), k * 4);
        more.set(seed.slice(4), k * 2);
      }
      index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aCloud', new THREE.BufferAttribute(cloud, 4));
    geometry.setAttribute('aMore', new THREE.BufferAttribute(more, 2));
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    geometry.setDrawRange(0, CLOUDS.calm.count * 6);

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime:        { value: 0 },
        uArea:        { value: CLOUDS.area },
        uDrift:       { value: new THREE.Vector2() },
        uWind:        { value: WIND.clone() },
        uCamera:      { value: new THREE.Vector3() },
        uWidth:       { value: new THREE.Vector2(...CLOUDS.width) },
        uHeight:      { value: new THREE.Vector2(...CLOUDS.height) },
        uSizeScale:   { value: new THREE.Vector2(1, 1) },
        uOpacity:     { value: CLOUDS.calm.opacity },
        uClearance:   { value: CLOUDS.calm.clearance },
        uNear:        { value: new THREE.Vector2(...CLOUDS.calm.near) },
        uFootprint:   { value: new THREE.Vector4(1e6, 1e6, -1e6, -1e6) },
        uCutoutMin:   { value: Array.from({ length: MAX_CUTOUTS }, () => new THREE.Vector3()) },
        uCutoutMax:   { value: Array.from({ length: MAX_CUTOUTS }, () => new THREE.Vector3()) },
        uCutoutCount: { value: 0 },
        uNoise:       { value: makeNoiseTexture(64) },
        uColor:       { value: new THREE.Color(CLOUDS.nightColor) },
        uFogColor:    { value: new THREE.Color() },
        uFogDensity:  { value: 0 },
        uBlend:       { value: CLOUDS.calm.blend },
        uWallFade:    { value: CLOUDS.wallFade },
      },
      vertexShader: CLOUD_VERTEX_SHADER,
      fragmentShader: CLOUD_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    });

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = 'DustCloudsMesh';
    // The shader places every cloud round the camera; three's bounds are of
    // the unplaced quads at the origin.
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.visible = CLOUDS.calm.count > 0;
    this.object3d.add(this.mesh);

    this.addComponent(new DustCloudsMotion());
  }

  /**
   * The building it must stay out of: every room's and corridor's shell.
   * Each is cut out pixel by pixel (at most 8), and their joint footprint
   * keeps whole clouds off the walls.
   * @param {THREE.Box3[]} boxes
   */
  setBuilding(boxes) {
    const u = this.mesh.material.uniforms;
    const n = Math.min(boxes.length, MAX_CUTOUTS);
    if (boxes.length > MAX_CUTOUTS) console.warn(`DustClouds: ${boxes.length} cutouts, only ${MAX_CUTOUTS} used`);
    const fp = u.uFootprint.value.set(Infinity, Infinity, -Infinity, -Infinity);
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (i < n) {
        u.uCutoutMin.value[i].copy(b.min);
        u.uCutoutMax.value[i].copy(b.max);
      }
      fp.set(Math.min(fp.x, b.min.x), Math.min(fp.y, b.min.z), Math.max(fp.z, b.max.x), Math.max(fp.w, b.max.z));
    }
    u.uCutoutCount.value = n;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.uniforms.uNoise.value.dispose();
    this.mesh.material.dispose();
  }
}

const _camera = new THREE.Vector3();
const _night = new THREE.Color();
const _day = new THREE.Color();

/** Drives the clouds: the storm level, the clock, the camera, the light. */
export class DustCloudsMotion extends Component {
  /** Where the storm has got to, 0 … 1. */
  storm = 0;

  constructor() {
    super();
    this._target = 0;
    this._daylight = 0;
    this._clock = 0;
    /** Something with a `factor` 0 (night) … 1 (day) — Daylight — read every frame. */
    this.daylightSource = null;
  }

  /** 0 = calm … 1 = full storm. Eased over storm.ramp. */
  setStorm(level) {
    this._target = Math.min(Math.max(level, 0), 1);
  }

  /** 0 = night … 1 = day. */
  setDaylight(factor) {
    this._daylight = factor;
  }

  onUpdate(dt) {
    const camera = this.gameObject?.scene?.userData?.engine?.camera;
    if (!camera) return;
    this.advance(dt, camera.getWorldPosition(_camera));
  }

  /** One frame: ease the storm, run the clock, follow the camera. Allocates nothing. */
  advance(dt, cameraPosition) {
    const clouds = /** @type {DustClouds} */ (this.gameObject);
    const u = clouds.mesh.material.uniforms;
    const { calm, storm } = CLOUDS;

    const step = dt / storm.ramp;
    this.storm += Math.max(-step, Math.min(step, this._target - this.storm));
    const k = this.storm;
    const lerp = (a, b) => a + (b - a) * k;

    this._clock += dt * lerp(1, storm.speed);
    u.uTime.value = this._clock;
    windDrift(this._clock, u.uDrift.value);
    u.uCamera.value.copy(cameraPosition);

    u.uSizeScale.value.set(lerp(1, storm.width), lerp(1, storm.height));
    u.uOpacity.value = lerp(calm.opacity, storm.opacity);
    u.uBlend.value = lerp(calm.blend, storm.blend);
    u.uClearance.value = lerp(calm.clearance, storm.clearance);
    u.uNear.value.set(lerp(calm.near[0], storm.near[0]), lerp(calm.near[1], storm.near[1]));
    const count = Math.round(lerp(calm.count, storm.count));
    clouds.mesh.geometry.setDrawRange(0, count * 6);
    // Not drawn at all with none to draw.
    clouds.mesh.visible = count > 0;

    if (this.daylightSource) this._daylight = this.daylightSource.factor ?? 0;
    u.uColor.value.lerpColors(_night.setHex(CLOUDS.nightColor), _day.setHex(CLOUDS.dayColor), this._daylight);

    if (clouds.fog) {
      u.uFogColor.value.copy(clouds.fog.color);
      u.uFogDensity.value = clouds.fog.density ?? 0;
    }
  }
}

/**
 * A tiling value-noise texture, three octaves, in the red channel. Built
 * from raw pixels with a seeded generator: no file, no canvas (which a
 * headless test has not got), and the same clouds every time.
 */
function makeNoiseTexture(size) {
  let s = 1234567;
  const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const octave = (cells) => {
    const grid = Array.from({ length: cells * cells }, rand);
    const at = (x, y) => grid[((y % cells + cells) % cells) * cells + ((x % cells + cells) % cells)];
    return (x, y) => {
      const fx = x / size * cells, fy = y / size * cells;
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      let tx = fx - x0, ty = fy - y0;
      tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
      const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx;
      const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx;
      return a + (b - a) * ty;
    };
  };
  const octaves = [[octave(4), 0.55], [octave(8), 0.3], [octave(16), 0.15]];
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0;
      for (const [f, w] of octaves) v += f(x, y) * w;
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = Math.round(v * 255);
      data[i + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

const CLOUD_VERTEX_SHADER = /* glsl */`
  attribute vec4 aCloud;   // seed x, seed z, and two of the cloud's own randoms
  attribute vec2 aMore;    // two more

  uniform float uTime;
  uniform float uArea;
  uniform vec2  uDrift;
  uniform vec2  uWind;
  uniform vec3  uCamera;
  uniform vec2  uWidth;
  uniform vec2  uHeight;
  uniform vec2  uSizeScale;
  uniform float uOpacity;
  uniform float uClearance;
  uniform vec2  uNear;
  uniform vec4  uFootprint;   // minX, minZ, maxX, maxZ
  uniform float uWallFade;

  varying vec2  vUv;
  varying float vAlpha;
  varying float vSeed;
  varying float vDist;
  varying vec3  vWorld;

  void main() {
    float r1 = aCloud.z, r2 = aCloud.w, r3 = aMore.x, r4 = aMore.y;
    float t = uTime;

    // Downwind with everything, plus its own surge along the wind and
    // meander across it.
    vec2 across = vec2(-uWind.y, uWind.x);
    vec2 own = uWind * sin(t * (0.15 + 0.2 * r1) + r2 * 6.283) * 2.5
             + across * sin(t * (0.1 + 0.15 * r3) + r4 * 6.283) * 3.0;
    vec2 p = (aCloud.xy - 0.5) * uArea + uDrift + own;

    // Wrapped into the square on the camera.
    vec2 rel = mod(p - uCamera.xz + 0.5 * uArea, uArea) - 0.5 * uArea;
    vec2 centre = uCamera.xz + rel;

    // Its size, swelling and shrinking, and a slow rise and sink.
    float w = mix(uWidth.x, uWidth.y, r1) * uSizeScale.x;
    float h = mix(uHeight.x, uHeight.y, r2) * uSizeScale.y * (0.85 + 0.15 * sin(t * (0.2 + 0.3 * r3) + r4 * 9.0));
    float sink = -0.12 * h * (0.5 + 0.5 * sin(t * (0.12 + 0.1 * r4) + r1 * 6.283));

    // Upright, turned to the camera about the vertical.
    vec2 toCam = uCamera.xz - centre;
    toCam /= max(length(toCam), 1e-3);
    vec2 right = vec2(-toCam.y, toCam.x);
    vec3 world = vec3(centre.x + right.x * position.x * w, position.y * h + sink, centre.y + right.y * position.x * w);

    // Near the building it fades away as it comes — over uWallFade metres
    // outside the clearance — and inside the clearance it isn't drawn at all.
    vec2 off = max(max(uFootprint.xy - centre, centre - uFootprint.zw), vec2(0.0));
    float wallFade = smoothstep(uClearance, uClearance + uWallFade, length(off));
    bool nearWalls = wallFade <= 0.0;

    float dist = length(rel);
    float edge = 1.0 - smoothstep(0.38 * uArea, 0.5 * uArea, dist);
    float nearFade = smoothstep(uNear.x, uNear.y, dist);
    float thin = 0.75 + 0.25 * sin(t * (0.17 + 0.2 * r2) + r3 * 6.283);
    vAlpha = nearWalls ? 0.0 : edge * nearFade * thin * wallFade * uOpacity;

    vUv = vec2(position.x + 0.5, position.y);
    vSeed = r1 * 7.0 + r2 * 3.0;
    vWorld = world;
    vec4 mv = viewMatrix * vec4(world, 1.0);
    vDist = -mv.z;
    // A cloud by the walls is collapsed off-screen, not drawn.
    gl_Position = nearWalls ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * mv;
  }
`;

const CLOUD_FRAGMENT_SHADER = /* glsl */`
  uniform sampler2D uNoise;
  uniform float uTime;
  uniform vec3  uColor;
  uniform vec3  uFogColor;
  uniform float uFogDensity;
  uniform float uBlend;
  uniform vec3  uCutoutMin[${MAX_CUTOUTS}];
  uniform vec3  uCutoutMax[${MAX_CUTOUTS}];
  uniform int   uCutoutCount;

  varying vec2  vUv;
  varying float vAlpha;
  varying float vSeed;
  varying float vDist;
  varying vec3  vWorld;

  void main() {
    if (vAlpha <= 0.002) discard;
    // Never inside the building.
    for (int i = 0; i < ${MAX_CUTOUTS}; i++) {
      if (i >= uCutoutCount) break;
      if (all(greaterThan(vWorld, uCutoutMin[i])) && all(lessThan(vWorld, uCutoutMax[i]))) discard;
    }

    // The billowing top line: the noise read twice, scrolling apart, and
    // drawn down at the cloud's two ends.
    float n1 = texture2D(uNoise, vec2(vUv.x * 0.9 + vSeed + uTime * 0.03, vSeed * 0.37)).r;
    float n2 = texture2D(uNoise, vec2(vUv.x * 2.3 - uTime * 0.05 + vSeed * 1.7, vSeed * 0.71 + 0.5)).r;
    float top = (0.35 + 0.65 * (0.65 * n1 + 0.35 * n2)) * pow(sin(3.14159 * vUv.x), 0.6);
    float body = 1.0 - smoothstep(top - 0.25, top, vUv.y);

    // Inside: the same noise for texture, denser low down, rising off the ground.
    float inner = texture2D(uNoise, vUv * vec2(1.3, 0.8) + vec2(vSeed - uTime * 0.04, uTime * 0.02)).r;
    float a = body * (0.55 + 0.45 * inner) * (1.0 - 0.5 * vUv.y) * smoothstep(0.0, 0.08, vUv.y) * vAlpha;
    if (a <= 0.003) discard;

    // Fogged like everything else: far clouds sink into the storm.
    float f = 1.0 - exp(-pow(uFogDensity * vDist, 2.0));
    // Calm, mostly the fog's colour — they blend in; a storm, their own.
    vec3 own = mix(uColor * (0.85 + 0.3 * inner), uFogColor, uBlend);
    vec3 color = mix(own, uFogColor, f);
    gl_FragColor = vec4(color, a);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
