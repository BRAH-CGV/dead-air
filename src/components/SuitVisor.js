import * as THREE from 'three';
import { Component } from '../core/Component.js';

// ─────────────────────────────────────────────
// SuitVisor  –  the helmet glass, and the breathing behind it
// ─────────────────────────────────────────────
// Rides on the Player next to the EVASuit it watches. While the suit is on:
//
//   • a full-screen glass overlay fades in — dark seal in the corners, a
//     thin bright glass edge, a couple of soft reflections, faint smudges.
//     The centre of the view is left clear; it's a frame, not a filter.
//   • the mask breathing loop plays, fading in and out with the glass.
//   • the glass fogs up low in the view on each breath and clears between
//     them. The fog is driven by the breathing clip's own loudness (see
//     breathEnvelope), so it lands on the sound rather than on a guess.
//
//   player.addComponent(new SuitVisor({ suit }));
//
// The overlay is a ShaderMaterial quad that writes clip space directly, so
// it covers the screen whatever the camera does and needs no second render
// pass. It hangs off the camera only so it lives in the scene graph; its
// world transform is never used.
// ─────────────────────────────────────────────

/** Fog builds fast on an exhale and clears slowly, the way breath on cold
 *  glass does. Rates are per second, for an exponential approach. */
const FOG_ATTACK  = 8;
const FOG_RELEASE = 1.5;

/**
 * A clip's loudness over time: RMS per window, rescaled so its quietest
 * moment is 0 and its loudest is 1 — the room tone in a recording never
 * reaches silence, and a fog level that never clears would read as dirt.
 *
 * @param {{ sampleRate: number, duration: number, getChannelData: (c: number) => Float32Array }} buffer
 * @param {number} [rate=30]  Samples per second of the result.
 * @returns {{ rate: number, duration: number, values: Float32Array }}
 */
export function breathEnvelope(buffer, rate = 30) {
  const data   = buffer.getChannelData(0);
  const window = Math.max(1, Math.floor(buffer.sampleRate / rate));
  const values = new Float32Array(Math.ceil(data.length / window));

  let lo = Infinity, hi = 0;
  for (let i = 0; i < values.length; i++) {
    const start = i * window;
    const end   = Math.min(start + window, data.length);
    let sum = 0;
    for (let j = start; j < end; j++) sum += data[j] * data[j];
    values[i] = Math.sqrt(sum / (end - start));
    lo = Math.min(lo, values[i]);
    hi = Math.max(hi, values[i]);
  }

  const range = hi - lo;
  for (let i = 0; i < values.length; i++) {
    values[i] = range > 0 ? (values[i] - lo) / range : 0;
  }
  return { rate: buffer.sampleRate / window, duration: buffer.duration, values };
}

/**
 * Rebuild a clip so it loops without a click. Two things tear a loop:
 *   • MP3 encoders pad both ends with silence, so the loop hiccups through a
 *     gap. Leading and trailing silence is trimmed off first.
 *   • The last sample rarely meets the first, and the jump between them is
 *     an audible tick. The clip's tail is crossfaded (equal-power, which
 *     holds loudness steady for noisy sound like breath) into its own first
 *     `fadeSeconds`, and those opening samples dropped from the front — so
 *     the end flows into exactly the sample that follows it at the start.
 *
 * Pure: takes and returns raw channel data, one Float32Array per channel,
 * and never touches the input (it may be a cached, shared buffer).
 *
 * @param {Float32Array[]} channels
 * @param {number} sampleRate
 * @param {{ fadeSeconds?: number, silence?: number }} [opts]
 * @returns {Float32Array[]}  The input itself if the clip is too short to fade.
 */
export function seamlessLoop(channels, sampleRate, { fadeSeconds = 0.08, silence = 1e-4 } = {}) {
  // Trim on the widest extent across channels, so stereo stays aligned.
  let start = Infinity, end = 0;
  for (const data of channels) {
    for (let i = 0; i < data.length; i++) {
      if (Math.abs(data[i]) > silence) { start = Math.min(start, i); break; }
    }
    for (let i = data.length - 1; i >= 0; i--) {
      if (Math.abs(data[i]) > silence) { end = Math.max(end, i + 1); break; }
    }
  }

  const n = end - start;
  const f = Math.floor(fadeSeconds * sampleRate);
  if (!(n > 0) || f < 1 || f * 2 > n) return channels;

  return channels.map((data) => {
    const src = data.subarray(start, end);
    const out = new Float32Array(n - f);
    out.set(src.subarray(f));
    // The last f samples: the clip's tail fading out under its head fading
    // in, landing on src[f - 1] — the sample right before out[0].
    for (let k = 0; k < f; k++) {
      const t = ((k + 1) / f) * Math.PI / 2;
      out[n - 2 * f + k] = src[n - f + k] * Math.cos(t) + src[k] * Math.sin(t);
    }
    return out;
  });
}

// ── Shaders ─────────────────────────────────

const VISOR_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    // A 2×2 plane is already the clip-space square: skip every matrix and the
    // quad covers the screen exactly, whatever the camera is doing.
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const VISOR_FRAGMENT_SHADER = /* glsl */ `
  uniform float uTime;     // seconds — drifts the condensation pattern
  uniform float uOpacity;  // 0..1 — fades the whole visor with the suit
  uniform float uBreath;   // 0..1 — how fogged the glass is right now
  uniform float uAspect;   // width / height, so shapes aren't stretched

  varying vec2 vUv;

  // Value noise + fBm — cheap, smooth, and enough for smudges and fog.
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i),                  hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
    return v;
  }

  // A soft line of half-width w at x = 0. x*x rather than pow(x, 2.0): GLSL
  // leaves pow undefined for a negative base, and some GPUs return NaN.
  float band(float x, float w) {
    float t = x / w;
    return exp(-t * t);
  }

  // Layers are composited front-over-back in premultiplied alpha, so the
  // material blends with ONE, ONE_MINUS_SRC_ALPHA (premultipliedAlpha: true).
  void over(inout vec4 acc, vec3 color, float alpha) {
    acc = vec4(color * alpha, alpha) + acc * (1.0 - alpha);
  }

  void main() {
    // Centred, aspect-correct: y runs -0.5..0.5, x by the aspect.
    vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);

    // Distance to the visor frame — a squircle that is 1 just inside the side
    // edges and at the top and bottom, and well past 1 in the corners.
    vec2 q = p / vec2(0.5 * uAspect, 0.5);
    float d = pow(pow(abs(q.x), 4.0) + pow(abs(q.y), 4.0), 0.25);

    vec4 acc = vec4(0.0);

    // Glass: the faintest cool tint, everywhere.
    over(acc, vec3(0.55, 0.75, 0.85), 0.03);

    // Smudges: high-frequency blotches, barely there.
    float smudge = smoothstep(0.62, 0.8, fbm(p * 9.0 + 3.7));
    over(acc, vec3(0.8), smudge * 0.035);

    // Condensation, low in the view where the breath hits the glass. Noise
    // eats into the patch's edge, so it grows from the middle as the breath
    // builds instead of fading in as a flat disc.
    float r    = length((p - vec2(0.0, -0.62)) / vec2(1.4, 1.0));
    float zone = 1.0 - smoothstep(0.05, 0.6, r);
    float fog  = fbm(p * 5.0 + vec2(0.0, uTime * 0.04));
    float cond = clamp(uBreath * zone * 1.6 - (1.0 - fog) * 0.7, 0.0, 1.0);
    over(acc, vec3(0.86, 0.9, 0.93), cond * 0.24);

    // Reflections: two soft diagonal streaks in the upper left, the window
    // and room lights caught on the curved glass.
    float s      = p.x * 0.8 + p.y;
    float corner = (1.0 - smoothstep(-0.5, 0.2, p.x)) * smoothstep(-0.2, 0.4, p.y);
    float streak = band(s + 0.32, 0.07) * 0.05
                 + band(s + 0.47, 0.018) * 0.04;
    over(acc, vec3(1.0), streak * corner);

    // The glass edge catching light, brighter along the top.
    float edge = band(d - 0.9, 0.02);
    over(acc, vec3(0.8, 0.9, 1.0), edge * 0.09 * (0.4 + 0.6 * smoothstep(-0.5, 0.5, p.y)));

    // The helmet seal: solid black in the corners, feathering to clear
    // glass just inside the screen edges.
    float rim = smoothstep(0.9, 0.99, d);
    over(acc, vec3(0.004, 0.005, 0.006), rim);

    gl_FragColor = acc * uOpacity;
  }
`;

// ── Component ───────────────────────────────

export class SuitVisor extends Component {
  /** @type {THREE.Mesh|null} */
  overlay = null;

  uniforms = {
    uTime:    { value: 0 },
    uOpacity: { value: 0 },
    uBreath:  { value: 0 },
    uAspect:  { value: 1 },
  };

  _worn = false;
  _startedAt = 0;
  _envelope = null;
  _off = null;
  _destroyed = false;

  /**
   * @param {object} [opts]
   * @param {import('./EVASuit.js').EVASuit} [opts.suit]  The suit to follow.
   * @param {THREE.Audio} [opts.sound]  Breathing to play. Left out, it is built
   *        from `soundKey` on `engine.audioListener` once the asset loads.
   * @param {string} [opts.soundKey='sfx:mask-breathing']
   * @param {number} [opts.volume=0.4]       Breathing volume with the visor fully on.
   * @param {number} [opts.fadeSeconds=0.6]  Time to fade glass and breath in or out.
   */
  constructor({
    suit = null,
    sound = null,
    soundKey = 'sfx:mask-breathing',
    volume = 0.4,
    fadeSeconds = 0.6,
  } = {}) {
    super();
    this.suit = suit;
    this.sound = sound;
    this.soundKey = soundKey;
    this.volume = volume;
    this.fadeSeconds = fadeSeconds;
  }

  get _engine() {
    return this.gameObject?.scene?.userData?.engine ?? null;
  }

  onStart() {
    const engine = this._engine;
    const camera = engine?.camera;
    if (!camera) return;

    this.overlay = this._buildOverlay();
    camera.add(this.overlay);

    if (this.sound) this._useSound(this.sound);
    else this._loadSound(engine);

    this._off = this.suit?.onChange(worn => this._setWorn(worn)) ?? null;
    if (this.suit?.worn) this._setWorn(true);
  }

  onUpdate(dt) {
    if (!this.overlay) return;
    const u = this.uniforms;

    // ── Fade glass (and, below, breath) toward the suit's state ──
    const target = this._worn ? 1 : 0;
    const step = dt / this.fadeSeconds;
    const o = u.uOpacity.value;
    u.uOpacity.value = target > o ? Math.min(1, o + step) : Math.max(0, o - step);
    const opacity = u.uOpacity.value;
    this.overlay.visible = opacity > 0;

    u.uTime.value += dt;
    u.uAspect.value = this._engine?.camera?.aspect ?? u.uAspect.value;

    // ── Breathing, and the fog it leaves ──
    let level = 0;
    const sound = this.sound;
    if (sound?.isPlaying) {
      if (opacity === 0) {
        sound.stop();
      } else {
        sound.setVolume(this.volume * opacity);
        level = this._breathLevel(sound) * opacity;
      }
    }
    const fog = u.uBreath.value;
    const rate = level > fog ? FOG_ATTACK : FOG_RELEASE;
    u.uBreath.value = fog + (level - fog) * (1 - Math.exp(-rate * dt));
  }

  onDestroy() {
    this._destroyed = true;
    this._off?.();
    this._off = null;

    if (this.sound?.isPlaying) this.sound.stop();
    // THREE.Audio connects itself to the listener on construction; unhook it
    // so a restart doesn't leave one dead node per run in the audio graph.
    try { this.sound?.disconnect?.(); } catch (_) { /* never connected */ }

    if (this.overlay) {
      this.overlay.removeFromParent();
      this.overlay.geometry.dispose();
      this.overlay.material.dispose();
      this.overlay = null;
    }
  }

  // ── Internals ─────────────────────────────

  _buildOverlay() {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: VISOR_VERTEX_SHADER,
        fragmentShader: VISOR_FRAGMENT_SHADER,
        transparent: true,
        premultipliedAlpha: true,
        depthTest: false,
        depthWrite: false,
      }),
    );
    mesh.name = 'SuitVisor';
    mesh.frustumCulled = false;   // its vertices are clip space, not world space
    mesh.renderOrder = 1000;      // after every other transparent thing
    mesh.castShadow = mesh.receiveShadow = false;
    mesh.raycast = () => {};      // never pickable by the editor, never blocks a click
    mesh.visible = false;
    return mesh;
  }

  _loadSound(engine) {
    if (!engine.audioListener || !engine.assets) return;
    engine.assets.load(this.soundKey).then((buffer) => {
      if (this._destroyed) return;
      const sound = new THREE.Audio(engine.audioListener);
      sound.setBuffer(this._loopable(buffer, engine.audioListener.context));
      sound.setLoop(true);
      sound.setVolume(0);
      this._useSound(sound);
      if (this._worn) this._startBreathing();
    }).catch((err) => console.warn(`[SuitVisor] no breathing — ${err.message}`));
  }

  /** A click-free copy of `buffer` for looping (see seamlessLoop). A copy,
   *  because the asset cache's buffer is shared. */
  _loopable(buffer, context) {
    const channels = [];
    for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));
    const looped = seamlessLoop(channels, buffer.sampleRate);
    if (looped === channels) return buffer;

    const out = context.createBuffer(looped.length, looped[0].length, buffer.sampleRate);
    looped.forEach((data, c) => out.copyToChannel(data, c));
    return out;
  }

  _useSound(sound) {
    this.sound = sound;
    this._envelope = sound.buffer ? breathEnvelope(sound.buffer) : null;
  }

  _setWorn(worn) {
    this._worn = worn;
    if (worn) this._startBreathing();
    // Taking it off fades out in onUpdate, which stops the sound at zero.
  }

  _startBreathing() {
    const sound = this.sound;
    if (!sound || sound.isPlaying) return;
    sound.setVolume(this.volume * this.uniforms.uOpacity.value);
    sound.play();
    this._startedAt = sound.context.currentTime;
  }

  /** The clip's loudness at the current playback position, 0..1. Read off
   *  the audio clock, not summed frame times, so it can't drift off the
   *  sound over a long night. */
  _breathLevel(sound) {
    const env = this._envelope;
    if (!env) return 0;
    const t = (sound.context.currentTime - this._startedAt) % env.duration;
    return env.values[Math.min(env.values.length - 1, Math.floor(t * env.rate))];
  }
}
