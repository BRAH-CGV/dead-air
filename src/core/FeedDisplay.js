import * as THREE from 'three';

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
  varying vec2 vUv;

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
    vec2 px = floor(vUv * uRes);

    // Grain: blocks of 2 picture pixels, re-rolled ~24 times a second,
    // cool and dim, darker on alternate lines.
    float frame = floor(uTime * 24.0);
    float g = hash(floor(px / 2.0) + frame * 17.0);
    float line = 0.82 + 0.18 * step(1.0, mod(px.y, 3.0));
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

    // The monitor: scanlines crawling slowly down, and a darker edge.
    float scan = 0.86 + 0.14 * step(1.0, mod(px.y + floor(uTime * 3.3), 3.0));
    vec2 edge = vUv * (1.0 - vUv);
    float vignette = clamp(pow(edge.x * edge.y * 16.0, 0.25), 0.0, 1.0);
    col *= scan * mix(0.45, 1.0, vignette);

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
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
   */
  constructor({ scene, zones = null, aspect }) {
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
    this.target.dispose();
    this.material.dispose();
    this._renderer = null;
    this.camera = null;
  }
}
