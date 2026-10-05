import * as THREE from 'three';
import { GameObject } from '../core/GameObject.js';
import { Component } from '../core/Component.js';
import { makeRandom, randRange } from '../core/Random.js';

// ─────────────────────────────────────────────
// WindDust  –  low clouds of dust drifting on the wind, outside
// ─────────────────────────────────────────────
// The wind, made visible: soft, ragged clouds of dust
// blowing across the ground of the yard and past the office window. They hug
// the ground — nothing reaches 2.5 m — so the sky above them stays clear.
//
//   this._sceneRoot.addChild(createWindDust({ cutouts }));
//
// ── Why it is cheap ──
// One mesh, one draw call: a quad per cloud, all in one buffer that is
// written at build and never again. Each quad carries a seed and a shape,
// and the vertex shader works out where its cloud is now, and turns it to
// face the camera, from three uniforms. The CPU's whole share per frame is
// those uniforms.
//
//   uDrift   how far the wind has carried the dust (windDrift)
//   uCenter  the camera: the clouds are scattered over an area around it
//   uTime    everything a cloud does on its own (below)
//
// ── Not a conveyor belt ──
// Carried on uDrift alone, every cloud would slide past at one speed in one
// straight line. So each also moves on its own, off phases taken from its
// seed, all of it worked out in the vertex shader:
//
//   surge    it runs ahead of the wind and falls back, so clouds overtake
//            one another
//   meander  it wanders across the wind
//   swell    it sinks and rises, and spreads as it sinks
//   thin     it thins out and thickens again, like dust kicked up and
//            settling
//
// and inside each cloud the billows roll: the noise it is cut from slides
// up through it and along it. The wind as a whole gusts and lulls too
// (windDrift).
//
// The area rides the camera, but the clouds don't: a cloud's place is its
// seed plus the drift, wrapped into the area around uCenter. Walk forward
// and the dust stays where it was; a cloud leaving the back of the area
// comes in at the front. So a couple of dozen clouds read as dust everywhere.
//
// What a billboard effect costs is overdraw — big see-through quads stacked
// on the same pixels — so that is what is kept down:
//
//   • a couple of dozen clouds, low and small on screen: most sit out toward
//     the horizon line, a few metres wide and no taller than 2.5 m;
//   • none right at the camera: they fade out inside `nearFade`, which is
//     where a quad would cover the screen (and where you would see it turn);
//   • a faded cloud is collapsed in the vertex shader, so it costs no pixels;
//   • two texture reads per pixel, from a 64 px noise tile made at build.
//
// It is unlit, casts and receives no shadows, writes no depth and takes no
// fog, so it adds nothing to the lit shaders or the frozen shadow maps. It
// keeps its own colour at any distance; a sandstorm's fog is matched to that
// colour instead (SANDSTORM.dustColor), so the clouds and the murk agree.
//
// ── A dust storm ──
// `WindDustMotion.setStorm(level)` takes it from this calm, 0, to a storm,
// 1, and anywhere between: more clouds, bigger and taller, thicker, and
// blowing harder (WIND_DUST.storm). Sandstorm calls it every frame with its
// own level, so the clouds build and die down with the fog, the sky and the
// grit. The extra clouds are in the same buffer from the start — a storm
// changes how much of it is drawn, and a few uniforms. A storm does cost
// more to draw: the clouds are many times the size on screen, and tall
// enough to take most of the view. The near
// fade still holds.
//
// ── Not indoors ──
// The area follows the camera into the base, so two things keep the dust
// out of the rooms and corridors (`cutouts`, their shells):
//
//   • the vertex shader drops every cloud whose middle is within
//     `clearance` of a shell's footprint. Calm, that is over half the widest
//     cloud, so not even an edge reaches a wall. A cloud drifting up to
//     that line thins out over the last `wallFade` metres, so it is never
//     seen to vanish;
//   • the fragment shader throws away any pixel that falls inside a shell.
//     That is what lets a storm's clouds, far wider than their clearance,
//     come right up to the walls and stand over the roof.
//
// From the desk that leaves the dust beyond the back wall, in the window. It is why this is not under the scene's Outside
// group: things there are sorted into occlusion zones by where they stand,
// and this stands wherever the camera is.
// ─────────────────────────────────────────────

/** Tuning. Metres and seconds unless stated. */
export const WIND_DUST = {
  seed: 20261004,
  /** Clouds in the area on a calm night: a rare few. One draw call
   *  whatever the number. */
  count: 24,
  /** The patch of ground around the camera they are scattered over: x, z. */
  area: [90, 90],
  /** A cloud's width and height. Wider than tall, and low. */
  width: [4.8, 8.8],
  height: [1.375, 2.5],
  /** Height of a cloud's bottom edge off the ground (y = 0, the yard): a
   *  little sunk, so its soft foot is in the ground. With `height`, nothing
   *  reaches above 2.6 m: the sky stays clear. */
  base: [-0.5, 0.1],
  /** Clouds fade in between these distances from the camera: none close. */
  nearFade: [6, 14],
  /** No cloud's middle comes this close to the building: over half the
   *  widest, so not even an edge reaches a wall. */
  clearance: 5.5,
  /** Metres outside the clearance over which a cloud fades away as it
   *  drifts up to the building — so it never pops out at the wall. */
  wallFade: 5,
  /** A cloud's own movement, on top of the wind (see the header).
   *  Metres it runs ahead of the wind and falls back… */
  surge: 2.4,
  /** …metres it wanders to either side… */
  meander: 3,
  /** …the fraction of its height it sinks by (it never grows past
   *  `height`, so the ceiling above holds)… */
  swell: 0.3,
  /** …and the fraction of its density it thins out by. */
  thin: 0.6,
  /** How fast the billows roll up through a cloud, in noise tiles a second. */
  roll: 0.03,
  /** Which way it blows, x and z: along the grass's sway (MarsVegetation). */
  direction: [0.874, 0.486],
  /** Mean wind speed. */
  speed: 2.6,
  /** Gusts: the speed swings by this fraction either side of the mean, once
   *  every `gustPeriod`. Below 1, so it never blows backwards. */
  gust: 0.45,
  gustPeriod: 11,
  /** How fast a cloud's shape churns, in noise tiles a second. */
  churn: 0.012,
  /** Dust colour at night and by day: dark rust under the moons, a lit
   *  orange-brown in the sun (0xaf5b27 on screen, after tone mapping). Not
   *  pale: the day's sky and fog are butterscotch (0xd9b48a), and clouds
   *  near that colour read as white wisps. It goes from one to the other
   *  with the dawn (Daylight's factor, handed to WindDustMotion as
   *  `daylight`). */
  nightColor: 0x583427,
  dayColor: 0xa05a2e,
  /** The densest a cloud gets on a calm night: faint. */
  opacity: 0.22,

  /** A dust storm: what the values above become at `setStorm(1)`. */
  storm: {
    /** Clouds drawn (calm: `count`), and how dense each gets: a wall of
     *  dust. At 160 it read as scattered clouds with clear air between
     *  them. This is what the storm costs to draw — quads this size, stacked
     *  — so it is the first number to lower if the frame rate drops. */
    count: 240,
    opacity: 0.65,
    /** A cloud's width and height, as multiples of the calm ones. At
     *  [2.5, 5] they run to 22 m wide and 7 to 12.5 m tall: from 20 m off the
     *  tallest fill the top of the screen, so the storm takes the view and
     *  not just the horizon. */
    size: [2.5, 5],
    /** How many times faster everything blows. */
    speed: 2.2,
    /** A storm comes right up to the walls, to close the view in from the
     *  window (the per-pixel cutout keeps it out of the rooms): its clouds
     *  stand from half a metre off them, at full strength by two… */
    clearance: 0.5,
    wallFade: 1.5,
    /** …and closer to the camera than the calm clouds do: at full strength
     *  by 7 m, which from the desk is the dust just outside the glass. */
    nearFade: [3, 7],
    /** Seconds to go from calm to a full storm, or back, if handed the
     *  level all at once. Short: Sandstorm has already eased the level it
     *  hands over, and drops to calm at once on a new night. */
    ramp: 0.6,
  },
};

const TWO_PI = Math.PI * 2;
const NOISE_SIZE = 64;
const _night = new THREE.Color(WIND_DUST.nightColor);
const _day = new THREE.Color(WIND_DUST.dayColor);

/**
 * How far the wind has carried the dust by `time`, wrapped into one area.
 *
 * The speed gusts as `speed * (1 + gust * cos(2πt / gustPeriod))`; this is its
 * integral, so the dust speeds up and slows down smoothly instead of jumping
 * when the gust changes. Wrapped here, in doubles, so the shader never adds
 * a kilometre of drift to a seed and loses the cloud in the rounding.
 *
 * @param {number} time
 * @param {THREE.Vector3} [out]  x and z; y stays 0
 */
export function windDrift(time, out = new THREE.Vector3()) {
  const { direction, speed, gust, gustPeriod, area } = WIND_DUST;
  const along = speed * (time + gust * Math.sin(TWO_PI * time / gustPeriod) * gustPeriod / TWO_PI);
  return out.set(wrap(direction[0] * along, area[0]), 0, wrap(direction[1] * along, area[1]));
}

function wrap(value, size) {
  // + 0 turns a −0 into 0: the drift is compared and printed.
  return ((value % size) + size) % size + 0;
}

/**
 * @param {object} [opts]
 * @param {{min: THREE.Vector3, max: THREE.Vector3}[]} [opts.cutouts]  Boxes
 *        no cloud is drawn in or near: the building's rooms and corridors.
 * @param {number} [opts.count]  Clouds when calm.
 * @param {number} [opts.stormCount]  Clouds in a full storm.
 * @returns {GameObject} a group carrying the one mesh, its `dustUniforms`,
 *          its `dustTexture` (for the scene to free), and the component that
 *          drives the uniforms
 */
export function createWindDust({
  cutouts = [], count = WIND_DUST.count, stormCount = WIND_DUST.storm.count,
} = {}) {
  const dust = new GameObject('WindDust').makeGroup();
  const rand = makeRandom(WIND_DUST.seed);
  // Every cloud a storm will need is built now; the calm ones come first,
  // so calm draws just the front of the buffer.
  const total = Math.max(count, stormCount);

  // Four vertices a cloud, all carrying the same seed and shape; the corner
  // says which way each is pushed out from the cloud's middle.
  //   position  seed: x, z in the unit area; y picks the base height
  //   aShape    width, height, and where in the noise tile it reads
  //   aCorner   (-1,-1) … (1,1)
  //   aStorm    1 for a cloud that only a storm brings
  const seeds   = new Float32Array(total * 4 * 3);
  const shapes  = new Float32Array(total * 4 * 4);
  const corners = new Float32Array(total * 4 * 2);
  const storms  = new Float32Array(total * 4);
  const index   = new Uint16Array(total * 6);
  const unit = () => Math.min(rand(), 0.999999);

  for (let c = 0; c < total; c++) {
    const seed  = [unit(), unit(), unit()];
    const shape = [
      randRange(rand, ...WIND_DUST.width),
      randRange(rand, ...WIND_DUST.height),
      rand(), rand(),
    ];
    for (let k = 0; k < 4; k++) {
      const v = c * 4 + k;
      seeds.set(seed, v * 3);
      shapes.set(shape, v * 4);
      corners.set([k % 2 ? 1 : -1, k < 2 ? -1 : 1], v * 2);
      storms[v] = c < count ? 0 : 1;
    }
    index.set([c * 4, c * 4 + 1, c * 4 + 2, c * 4 + 2, c * 4 + 1, c * 4 + 3], c * 6);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(seeds, 3));
  geometry.setAttribute('aShape',   new THREE.BufferAttribute(shapes, 4));
  geometry.setAttribute('aCorner',  new THREE.BufferAttribute(corners, 2));
  geometry.setAttribute('aStorm',   new THREE.BufferAttribute(storms, 1));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  geometry.setDrawRange(0, count * 6);

  // Its own generator, so the cloud shapes don't change with the counts.
  const texture = makeNoiseTexture(makeRandom(WIND_DUST.seed + 1));
  const uniforms = {
    uTime:     { value: 0 },
    uDrift:    { value: new THREE.Vector3() },
    uCenter:   { value: new THREE.Vector3() },
    uArea:     { value: new THREE.Vector2(...WIND_DUST.area) },
    uBase:     { value: new THREE.Vector2(...WIND_DUST.base) },
    uNearFade: { value: new THREE.Vector2(...WIND_DUST.nearFade) },
    uChurn:    { value: WIND_DUST.churn },
    uRoll:     { value: WIND_DUST.roll },
    uWind:     { value: new THREE.Vector2(...WIND_DUST.direction) },
    // surge, meander, swell, thin
    uOwn:      { value: new THREE.Vector4(WIND_DUST.surge, WIND_DUST.meander, WIND_DUST.swell, WIND_DUST.thin) },
    uNoise:    { value: texture },
    uColor:    { value: new THREE.Color(WIND_DUST.nightColor) },
    uOpacity:  { value: WIND_DUST.opacity },
    // The building's shells, and how far a cloud's middle keeps off them.
    uBoxMin:   { value: cutouts.map(box => new THREE.Vector3().copy(box.min)) },
    uBoxMax:   { value: cutouts.map(box => new THREE.Vector3().copy(box.max)) },
    uClearance: { value: WIND_DUST.clearance },
    uWallFade:  { value: WIND_DUST.wallFade },
    // 0 calm … 1 a full storm, and how much bigger its clouds are.
    uStorm:     { value: 0 },
    uStormSize: { value: new THREE.Vector2(...WIND_DUST.storm.size) },
  };

  const mesh = new THREE.Mesh(geometry, new THREE.ShaderMaterial({
    uniforms,
    defines: { CUTOUTS: cutouts.length },
    vertexShader: DUST_VERTEX_SHADER,
    fragmentShader: DUST_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  }));
  mesh.name = 'WindDustClouds';
  // The buffer holds seeds; where the clouds really are is only known to the
  // shader. So no bounds to cull by, and nothing for a ray to hit.
  mesh.frustumCulled = false;
  mesh.raycast = () => {};
  mesh.castShadow = mesh.receiveShadow = false;

  dust.object3d.add(mesh);
  dust.dustUniforms = uniforms;
  dust.dustTexture = texture;
  dust.addComponent(new WindDustMotion(uniforms, {
    geometry, calmIndices: count * 6, stormIndices: total * 6,
  }));
  return dust;
}

/**
 * A small tile of soft, cloudy noise that repeats without a seam: a few
 * octaves of value noise on a lattice that wraps. Made once, at build — the
 * fragment shader reads it instead of working noise out per pixel.
 */
function makeNoiseTexture(rand) {
  const size = NOISE_SIZE;
  const field = new Float32Array(size * size);
  let lo = Infinity, hi = -Infinity;

  for (let octave = 0, cells = 4, weight = 1; octave < 4; octave++, cells *= 2, weight *= 0.5) {
    const lattice = Float32Array.from({ length: cells * cells }, () => rand());
    const at = (x, y) => lattice[(y % cells) * cells + (x % cells)];
    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        const x = (px / size) * cells, y = (py / size) * cells;
        const x0 = Math.floor(x), y0 = Math.floor(y);
        const fx = smooth(x - x0), fy = smooth(y - y0);
        const top    = at(x0, y0)     + (at(x0 + 1, y0)     - at(x0, y0))     * fx;
        const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * fx;
        field[py * size + px] += (top + (bottom - top) * fy) * weight;
      }
    }
  }
  for (const v of field) { lo = Math.min(lo, v); hi = Math.max(hi, v); }

  // Stretched to the whole 0..255, so the shader's thresholds mean the same
  // whatever the seed.
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < field.length; i++) {
    const value = Math.round(((field[i] - lo) / (hi - lo)) * 255);
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = value;
    data[i * 4 + 3] = 255;
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function smooth(t) {
  return t * t * (3 - 2 * t);
}

/** The CPU's share: a handful of uniforms a frame, nothing allocated. Late
 *  in the frame, after the camera has moved. */
export class WindDustMotion extends Component {
  /**
   * @param {object} uniforms  The dust material's.
   * @param {object} [opts]
   * @param {THREE.BufferGeometry} [opts.geometry]  Its draw range is how
   *        many clouds are drawn: `calmIndices`, or `stormIndices` in a storm.
   */
  constructor(uniforms, { geometry = null, calmIndices = 0, stormIndices = 0 } = {}) {
    super();
    this.uniforms = uniforms;
    this.geometry = geometry;
    this.calmIndices = calmIndices;
    this.stormIndices = stormIndices;
    /** Something with a `factor`, 0 night … 1 day — Daylight — read every
     *  frame for the dust's colour. Night with none.
     *  @type {{ factor: number }|null} */
    this.daylight = null;
    /** Where the storm is heading, and where it has got to. */
    this._stormTarget = 0;
    this._storm = 0;
  }

  /** The storm now, 0 calm … 1 full. */
  get storm() {
    return this._storm;
  }

  /** Bring a storm on, or call it off: Sandstorm, every frame, with its own
   *  level. It closes on the level over `WIND_DUST.storm.ramp` seconds.
   *  @param {number} level  0..1 */
  setStorm(level) {
    this._stormTarget = Math.min(Math.max(level, 0), 1);
  }

  onLateUpdate(dt) {
    const u = this.uniforms;
    const storm = this._advanceStorm(dt);

    u.uTime.value += dt * (1 + (WIND_DUST.storm.speed - 1) * storm);
    windDrift(u.uTime.value, u.uDrift.value);
    // By the dawn, not the fog's brightness: a sandstorm turns the fog
    // dust-brown, brighter than the night's blue, and that is not daylight.
    u.uColor.value.lerpColors(_night, _day, Math.min(Math.max(this.daylight?.factor ?? 0, 0), 1));

    const engine = this.gameObject?.scene?.userData?.engine;
    if (!engine) return;

    // getWorldPosition, not .position: the camera rides the player, or the
    // scene root under the debug fly camera.
    engine.camera?.getWorldPosition(u.uCenter.value);

  }

  /** Move the storm toward where it is heading, and set everything that
   *  follows it. @returns {number} the storm now */
  _advanceStorm(dt) {
    const { storm: tuning, opacity, clearance, wallFade, nearFade } = WIND_DUST;
    const step = dt / tuning.ramp;
    const s = this._storm < this._stormTarget
      ? Math.min(this._stormTarget, this._storm + step)
      : Math.max(this._stormTarget, this._storm - step);
    this._storm = s;

    const u = this.uniforms;
    u.uStorm.value = s;
    u.uOpacity.value = opacity + (tuning.opacity - opacity) * s;
    u.uClearance.value = clearance + (tuning.clearance - clearance) * s;
    u.uWallFade.value = wallFade + (tuning.wallFade - wallFade) * s;
    u.uNearFade.value.set(
      nearFade[0] + (tuning.nearFade[0] - nearFade[0]) * s,
      nearFade[1] + (tuning.nearFade[1] - nearFade[1]) * s,
    );
    // The storm's own clouds are only sent to the GPU while there is one.
    this.geometry?.setDrawRange(0, s > 0 ? this.stormIndices : this.calmIndices);
    return s;
  }
}

// ── Shaders ─────────────────────────────────

const DUST_VERTEX_SHADER = /* glsl */ `
  uniform float uTime;      // seconds — everything a cloud does on its own
  uniform vec3  uDrift;     // how far the wind has carried the dust, wrapped (x, z)
  uniform vec2  uWind;      // unit wind direction, x and z
  uniform vec4  uOwn;       // surge (m), meander (m), swell, thin
  uniform float uRoll;
  uniform float uStorm;       // 0 calm … 1 a full storm
  uniform vec2  uStormSize;   // how much wider and taller its clouds are
  uniform float uClearance;   // metres a cloud's middle keeps off the building
  uniform float uWallFade;    // metres beyond that over which it fades away
  uniform vec3  uCenter;    // the camera, world space
  uniform vec2  uArea;      // the patch of ground the clouds are scattered over
  uniform vec2  uBase;      // lowest and highest a cloud's bottom edge sits
  uniform vec2  uNearFade;  // clouds fade in between these distances
  uniform float uChurn;
  #if CUTOUTS > 0
    uniform vec3 uBoxMin[CUTOUTS];   // the building's shells: no dust here
    uniform vec3 uBoxMax[CUTOUTS];
  #endif

  attribute vec4 aShape;    // width, height, noise offset
  attribute vec2 aCorner;   // which corner of the cloud's quad this is
  attribute float aStorm;   // 1: this cloud only comes with a storm

  varying vec2  vCorner;
  varying vec2  vNoiseUv;
  varying float vFade;
  varying vec3  vWorld;

  void main() {
    // Four phases of its own for each cloud, from its seed, each on its own
    // slow clock — so no two clouds, and no two of one cloud's movements,
    // keep time with each other.
    float seed = dot(position, vec3(37.0, 59.0, 91.0));
    float surge   = sin(uTime * (0.33 + 0.21 * aShape.z) + seed);
    float meander = sin(uTime * (0.24 + 0.17 * aShape.w) + seed * 1.7);
    float swell   = 0.5 + 0.5 * sin(uTime * (0.41 + 0.2 * aShape.w) + seed * 2.3);
    float thin    = 0.5 + 0.5 * sin(uTime * (0.19 + 0.13 * aShape.z) + seed * 3.1);

    // 'position' is the cloud's seed. Its place on the ground is the seed
    // scaled to the area, carried downwind, running ahead of the wind or
    // falling behind it, and wandering to either side…
    vec2 p = position.xz * uArea + uDrift.xz
           + uWind * surge * uOwn.x
           + vec2(-uWind.y, uWind.x) * meander * uOwn.y;
    // …then wrapped into the area around the camera — so the cloud keeps
    // its place in the world while the area moves, and one leaving it
    // re-enters on the far side.
    vec2 rel = mod(p - uCenter.xz + 0.5 * uArea, uArea) - 0.5 * uArea;
    vec2 ground = uCenter.xz + rel;

    // Fade toward the edge of the area, so the wrap is never seen, and
    // toward the camera, so no cloud ever covers the screen.
    float dist = length(rel);
    vec2 edge = abs(rel) / (0.5 * uArea);
    float fade = 1.0 - smoothstep(0.6, 1.0, max(edge.x, edge.y));
    fade *= smoothstep(uNearFade.x, uNearFade.y, dist);
    // Thinning out and thickening again.
    fade *= 1.0 - uOwn.w * thin;
    // A storm's own clouds come in with it.
    fade *= mix(1.0, uStorm, aStorm);

    // Not near the building: gone within uClearance of a shell's footprint,
    // and thinning over the uWallFade metres before that, so a cloud blowing
    // up to the wall fades away and is never seen to vanish.
    #if CUTOUTS > 0
      for (int i = 0; i < CUTOUTS; i++) {
        vec2 off = max(max(uBoxMin[i].xz - ground, ground - uBoxMax[i].xz), vec2(0.0));
        fade *= smoothstep(uClearance, uClearance + uWallFade, max(off.x, off.y));
      }
    #endif

    // The quad: upright, and turned about the vertical to face the camera.
    // The view matrix's first row is the camera's right, in world space.
    // Sinking and rising: lower and wider as it sinks. It only ever shrinks
    // from its full height, so the ceiling the clouds were built to holds.
    vec2 size = aShape.xy * vec2(1.0 + 0.5 * uOwn.z * swell, 1.0 - uOwn.z * swell);
    // A storm's clouds are bigger, and stand taller.
    size *= mix(vec2(1.0), uStormSize, uStorm);
    vec3 right = normalize(vec3(viewMatrix[0][0], 0.0, viewMatrix[2][0]));
    float bottom = mix(uBase.x, uBase.y, position.y);
    vec3 world = vec3(ground.x, bottom + 0.5 * size.y, ground.y)
               + right * aCorner.x * 0.5 * size.x
               + vec3(0.0, aCorner.y * 0.5 * size.y, 0.0);

    vCorner = aCorner;
    vFade = fade;
    vWorld = world;
    // Each cloud reads its own patch of the noise tile, sliding slowly: the
    // shape churns as it blows along. A bigger cloud reads a bigger patch,
    // so the billows stay the same size in the world.
    // The slide upward is the billows rolling.
    vNoiseUv = aShape.zw + vec2(aCorner.x * size.x * 0.045 + uTime * uChurn,
                                aCorner.y * size.y * 0.09 - uTime * uRoll);

    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
    // Nothing to draw: collapse the quad off screen, so it costs no pixels.
    if (fade <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  }
`;

const DUST_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uNoise;
  uniform vec3  uColor;
  uniform float uOpacity;
  uniform float uTime;
  #if CUTOUTS > 0
    uniform vec3 uBoxMin[CUTOUTS];   // the building's shells: no dust here
    uniform vec3 uBoxMax[CUTOUTS];
  #endif

  varying vec2  vCorner;
  varying vec2  vNoiseUv;
  varying float vFade;
  varying vec3  vWorld;

  void main() {
    // Nothing inside the building. A cloud is a flat quad facing the camera,
    // so a wide one near a wall can cut through it; this is what stops that
    // showing in a room. Above the roof it carries on, over the top.
    #if CUTOUTS > 0
      for (int i = 0; i < CUTOUTS; i++) {
        if (all(greaterThan(vWorld, uBoxMin[i])) && all(lessThan(vWorld, uBoxMax[i]))) discard;
      }
    #endif

    float y = vCorner.y * 0.5 + 0.5;                        // 0 at the ground, 1 at the top
    float ends = 1.0 - smoothstep(0.35, 1.0, abs(vCorner.x));   // thins out to each side

    // Two readings of the one tile: big billows, and finer ragged detail
    // that drifts through them.
    float big  = texture2D(uNoise, vNoiseUv).r;
    float fine = texture2D(uNoise, vNoiseUv * 2.7 + vec2(0.31, uTime * 0.01)).r;
    float noise = big * 0.7 + fine * 0.3;

    // The outline is the noise: the cloud stands as tall as the noise is
    // high, so its top is a row of billows and not the quad's straight edge.
    float reach = noise * ends;
    float body = smoothstep(y * 0.95 - 0.12, y * 0.95 + 0.22, reach);
    // Soft where it meets the ground, so there is no line along its foot.
    float foot = smoothstep(0.0, 0.18, y);

    float alpha = body * foot * ends * vFade * uOpacity * (0.55 + 0.45 * fine);
    if (alpha < 0.004) discard;

    gl_FragColor = vec4(uColor, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
