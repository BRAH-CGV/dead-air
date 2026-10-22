import * as THREE from 'three';
import { SCREEN_GLASS_GLSL } from '../gameobjects/ScreenGlass.js';

// ─────────────────────────────────────────────
// FeedDisplay  –  the security monitor's own picture (#161)
// ─────────────────────────────────────────────
// The camera on the monitor is drawn into a small render target, and the
// monitor's screen in the world shows it, always: from across the office as
// well as leaned in to it. The screen's shader is the CCTV look and the
// switch between cameras (CameraTransition's timeline): the last picture
// frozen, torn, rolling and drained of colour under grain, then the new one
// resolving out of it with a tear band sweeping down, and scanlines
// crawling over all of it.
//
//   display.attach(renderer);            // at scene build
//   engine.screenPasses.push(display);   // render() after each frame
//   screenMesh(surface, display.material);
//   display.show(camera);                // the SecurityCamera on it
//   display.want();                      // a new picture after this frame
//   display.set(transition); display.tick(dt);
//
// What it costs, and why it costs little:
//   • a picture only when CameraTerminal asks: every frame leaned in, a few
//     times a second from across the room, never while a switch holds the
//     frozen frame (not drawing *is* the freeze — no copy), and never when
//     the monitor can't be seen;
//   • small: FEED.idleHeight rows from across the room, closeHeight up close;
//   • the yard the outdoor cameras see is drawn for this picture alone
//     (OcclusionZones.drawFor): the player's own frame stays culled, and the
//     frozen shadow maps aren't redrawn — so the yard's own moon shadows are
//     missing from the feed while the player is indoors.
//
// The target is drawn without tone mapping (three only tone maps the
// screen), in half floats: the night stays smooth in the dark, and the
// screen's material tone maps it like the rest of the frame.
// ─────────────────────────────────────────────

export const FEED = {
  /** Rows of the picture from across the room, and leaned in to it. */
  idleHeight: 216,
  closeHeight: 720,
  /** Pictures a second from across the room: CCTV is choppy anyway. */
  idleFps: 10,
  /** The camera's gain: a security camera brightens the night. */
  gain: 1.6,
};

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D tFeed;
  uniform vec2 uRes;       // the picture's pixels
  uniform float uPower;    // 0: the screen is off
  uniform float uGain;
  uniform float uFrozen;   // 1: the last picture held (a switch)
  uniform float uBlank;    // 1: no picture to hold — black under the grain
  uniform float uNoise;    // 0..1
  uniform float uTear;     // 0..1
  uniform float uRoll;     // 0..1 of the screen
  uniform float uDesat;    // 0..1
  uniform float uBand;     // 0..1, the resolve's tear band, top to bottom
  uniform float uTime;
  uniform sampler2D tOverlay;  // the overlay's own picture (CameraOverlay, painted)
  uniform float uHasOverlay;
  uniform float uMotion;       // 0 under reduced motion: the lines and band hold still
  varying vec2 vUv;

  // A share of the screen, not of the picture's pixels, so the screen
  // looks the same drawn small or leaned in to.
  #define GRAIN 180.0
  ${SCREEN_GLASS_GLSL}

  // The CCTV's own lines, finer than the computers': a dark one every
  // third row of a 720-row picture, crawling down a line every 0.9 s.
  #define CCTV_LINES 240.0
  float cctvLines(vec2 uv) {
    return 1.0 - 0.2 * step(fract(uv.y * CCTV_LINES + uTime * uMotion / 0.9), 1.0 / 3.0);
  }

  // A faint band rolling down through the picture every 7 s: 40 % of the
  // screen tall, brightest (7 %) in its middle.
  float cctvRoll(vec2 uv) {
    float top = 1.0 - uv.y;
    float bandTop = mix(-0.9, 1.5, fract(uTime * uMotion / 7.0));
    float d = abs(top - (bandTop + 0.2)) / 0.4;
    return d < 0.05 ? mix(0.07, 0.045, d / 0.05) : d < 0.5 ? mix(0.045, 0.0, (d - 0.05) / 0.45) : 0.0;
  }

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  void main() {
    if (uPower < 0.5) {
      gl_FragColor = vec4(vec3(0.003), 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      return;
    }
    float aspect = uRes.x / uRes.y;
    vec2 cell = floor(vUv * vec2(GRAIN * aspect, GRAIN));

    // Grain: blocks of a fixed share of the screen, re-rolled ~24 times a
    // second, cool and dim, darker on alternate rows.
    float frame = floor(uTime * 24.0);
    float g = hash(cell + frame * 17.0);
    float line = 0.82 + 0.18 * step(1.0, mod(cell.y, 3.0));
    vec3 grain = vec3(0.6, 0.7, 0.85) * g * 0.25 * line;

    // A tear: bands of rows pushed sideways, changing ~12 times a second.
    float row = floor(vUv.y * 90.0);
    float pick = hash(vec2(row, floor(uTime * 12.0)));
    float shove = (hash(vec2(row * 1.7, floor(uTime * 12.0) + 3.0)) - 0.5)
                * step(0.86, pick) * uTear * 0.06;

    // The picture, rolling while it is held (a slipping vertical hold).
    float roll = uRoll * uFrozen;
    vec2 uv = vec2(vUv.x + shove, fract(vUv.y + roll));
    vec3 col = uBlank > 0.5 ? vec3(0.002) : texture2D(tFeed, uv).rgb * uGain;
    float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = mix(col, vec3(lum) * vec3(0.92, 1.0, 1.04), uDesat) * (1.0 - 0.35 * uDesat);
    // The roll's seam: a dark bar where the picture wraps, coming in as the
    // roll starts, so an unrolled picture has no bar at its edges.
    float bar = smoothstep(0.0, 0.035, min(uv.y, 1.0 - uv.y));
    col *= mix(1.0 - 0.75 * smoothstep(0.0, 0.02, roll), 1.0, bar);

    // Grain over it: heavy on a held picture; dying away over a live one,
    // with the resolve's band of brighter grain sweeping down.
    float band = (1.0 - smoothstep(0.0, 0.06, abs((1.0 - vUv.y) - uBand))) * (1.0 - uFrozen);
    float amount = mix(clamp(uNoise * 0.9 + band * uTear * 0.5, 0.0, 1.0), uNoise * 0.6, uFrozen);
    col = mix(col, grain * (1.0 + band), amount) + grain * uNoise * 0.25 * uFrozen;

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>

    // The overlay (its bytes are as painted), then the monitor's glass over
    // both: its lines, the rolling band, and the dark edge every screen has.
    vec4 ov = texture2D(tOverlay, vUv);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, ov.rgb, ov.a * uHasOverlay);
    gl_FragColor.rgb = mix(gl_FragColor.rgb * cctvLines(vUv), vec3(1.0), cctvRoll(vUv));
    gl_FragColor.rgb *= screenEdge(vUv);
  }
`;

export class FeedDisplay {
  /** The SecurityCamera on screen. */
  camera = null;
  powered = true;
  _renderer = null;
  _wanted = false;

  /**
   * @param {object} opts
   * @param {THREE.Scene} opts.scene  What the camera sees.
   * @param {import('../systems/OcclusionZones.js').OcclusionZones|null} [opts.zones]
   * @param {number} opts.aspect  The screen's width over its height.
   * @param {boolean} [opts.reducedMotion]  The lines and band hold still.
   */
  constructor({
    scene, zones = null, aspect,
    reducedMotion = typeof matchMedia === 'function' && !!matchMedia('(prefers-reduced-motion: reduce)')?.matches,
  }) {
    this.scene = scene;
    this.zones = zones;
    this.aspect = aspect;
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
    });
    this.material = new THREE.ShaderMaterial({
      name: 'SecurityFeed',
      uniforms: {
        tFeed: { value: this.target.texture },
        uRes: { value: new THREE.Vector2() },
        uPower: { value: 1 },
        uGain: { value: FEED.gain },
        uFrozen: { value: 0 },
        uBlank: { value: 0 },
        uNoise: { value: 0 },
        uTear: { value: 0 },
        uRoll: { value: 0 },
        uDesat: { value: 0 },
        uBand: { value: 0 },
        uTime: { value: 0 },
        tOverlay: { value: null },
        uHasOverlay: { value: 0 },
        uMotion: { value: reducedMotion ? 0 : 1 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
    });
    this.setDetail('idle');
    // Bound once: render() runs every frame and allocates nothing.
    this._draw = () => {
      const renderer = this._renderer;
      const before = renderer.getRenderTarget();
      renderer.setRenderTarget(this.target);
      renderer.render(this.scene, this.camera.lens);
      renderer.setRenderTarget(before);
    };
  }

  attach(renderer) {
    this._renderer = renderer;
    // Allocated now, behind the loading screen, not the first time the
    // monitor comes into view.
    renderer?.initRenderTarget?.(this.target);
  }

  /** Put a camera on the screen, in the screen's own shape. */
  show(camera) {
    this.camera = camera;
    const lens = camera?.lens;
    if (lens && lens.aspect !== this.aspect) {
      lens.aspect = this.aspect;
      lens.updateProjectionMatrix();
    }
  }

  /** 'idle' from across the room, 'close' leaned in to it. */
  setDetail(detail) {
    const height = detail === 'close' ? FEED.closeHeight : FEED.idleHeight;
    const width = Math.round(height * this.aspect);
    if (this.target.width !== width || this.target.height !== height) this.target.setSize(width, height);
    this.material.uniforms.uRes.value.set(width, height);
  }

  /** What goes over the picture: the camera's label, the controls, the
   *  map (CameraOverlay, painted into a ScreenCanvas texture). */
  setOverlay(texture) {
    this.material.uniforms.tOverlay.value = texture;
    this.material.uniforms.uHasOverlay.value = texture ? 1 : 0;
  }

  /** Draw a new picture after this frame. */
  want() {
    this._wanted = true;
  }

  setPowered(on) {
    this.powered = !!on;
    this.material.uniforms.uPower.value = this.powered ? 1 : 0;
  }

  /** The switch's look, from its timeline (CameraTransition). */
  set(t) {
    const u = this.material.uniforms;
    u.uFrozen.value = t.frozen ? 1 : 0;
    u.uBlank.value = t.blank ? 1 : 0;
    u.uNoise.value = t.noise;
    u.uTear.value = t.tear;
    u.uRoll.value = t.roll;
    u.uDesat.value = t.desat;
    u.uBand.value = t.band;
  }

  /** The grain's and the scanlines' clock. */
  tick(dt) {
    this.material.uniforms.uTime.value += dt;
  }

  /** After the frame: the picture, if one is wanted. */
  render() {
    if (!this._wanted || !this._renderer || !this.camera || !this.powered) return;
    this._wanted = false;
    if (this.zones) this.zones.drawFor(this.camera.zones, this._draw);
    else this._draw();
  }

  dispose() {
    // A target's dispose frees its GPU memory, not the texture object.
    this.target.texture.dispose();
    this.target.dispose();
    this.material.dispose();
    this._renderer = null;
    this.camera = null;
  }
}
