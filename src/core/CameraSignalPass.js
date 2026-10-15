import * as THREE from 'three';

// ─────────────────────────────────────────────
// CameraSignalPass  –  a camera switch, drawn over the frame
// ─────────────────────────────────────────────
// The picture half of a camera switch (CameraTransition is the timeline).
// On a switch the screen as it stands is copied once into a texture; while
// the new camera loads, that frozen frame is drawn over everything, torn,
// rolling and drained of colour under a dim grain; once the new picture is
// live, only the grain and one tear band are drawn over it, dying away.
//
//   pass.attach(renderer);              // at scene build
//   engine.screenPasses.push(pass);     // render() after each frame
//   pass.capture(() => switchCamera()); // the switch runs after the copy
//   pass.set(transition); pass.tick(dt);
//
// Why the switch waits for capture: the screen can only be read straight
// after it is drawn (the drawing buffer isn't kept between frames). So the
// copy happens in render(), after this frame — still the old camera — is
// on screen, and only then is the camera (and its zones) switched. The cut
// lands one frame later than asked, which nobody sees.
//
// Cost: one GPU copy per switch (copyFramebufferToTexture, no render target)
// and, only while a switch plays, one full-screen quad with a few texture
// reads and a hash for grain. Nothing on the CPU per pixel; at the desk,
// nothing at all. The shader is compiled and the texture allocated in
// attach(), so the first switch doesn't hitch.
//
// The copied pixels are already as shown (tone mapped, sRGB), so the shader
// passes them through without tone mapping or colour-space conversion.
// ─────────────────────────────────────────────

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D tFrozen;
  uniform float uFrozen;   // 1: draw the frozen frame; 0: grain over the live picture
  uniform float uBlank;    // 1: no frame to freeze — black under the grain
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
    // Grain: blocks of 2 px, re-rolled ~24 times a second, cool and dim,
    // a touch darker on alternate lines like the monitor's scanlines.
    float frame = floor(uTime * 24.0);
    float g = hash(floor(gl_FragCoord.xy / 2.0) + frame * 17.0);
    float line = 0.82 + 0.18 * step(1.0, mod(gl_FragCoord.y, 3.0));
    vec3 grain = vec3(0.78, 0.86, 0.95) * g * 0.42 * line;

    // A tear: a few bands of rows pushed sideways, changing ~12 times a second.
    float row = floor(vUv.y * 90.0);
    float pick = hash(vec2(row, floor(uTime * 12.0)));
    float shove = (hash(vec2(row * 1.7, floor(uTime * 12.0) + 3.0)) - 0.5)
                * step(0.86, pick) * uTear * 0.06;

    if (uFrozen > 0.5) {
      vec2 uv = vec2(vUv.x + shove, fract(vUv.y + uRoll));
      vec3 col = uBlank > 0.5 ? vec3(0.012, 0.014, 0.016) : texture2D(tFrozen, uv).rgb;
      float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(col, vec3(lum) * vec3(0.92, 1.0, 1.04), uDesat) * (1.0 - 0.35 * uDesat);
      // The roll's seam: a dark bar where the frame wraps, as a slipping
      // vertical hold shows. It comes in as the roll starts, so an unrolled
      // frame (the drop, reduced motion) has no bar at its edges.
      float seam = uv.y;
      float bar = smoothstep(0.0, 0.035, min(seam, 1.0 - seam));
      col *= mix(1.0 - 0.75 * smoothstep(0.0, 0.02, uRoll), 1.0, bar);
      col = mix(col, grain, uNoise * 0.6) + grain * uNoise * 0.25;
      gl_FragColor = vec4(col, 1.0);
    } else {
      // Over the live picture: grain fading out, and a band of brighter
      // grain and a little darkening sweeping down.
      float band = 1.0 - smoothstep(0.0, 0.06, abs((1.0 - vUv.y) - uBand));
      float alpha = clamp(uNoise * 0.9 + band * uTear * 0.5, 0.0, 1.0);
      gl_FragColor = vec4(grain * (1.0 + band), alpha);
    }
  }
`;

const _size = new THREE.Vector2();

export class CameraSignalPass {
  _renderer = null;
  _texture = null;
  _material = null;
  _quad = null;
  _scene = null;
  _camera = null;
  _active = false;
  /** The switch to run once the screen is copied. @type {(() => void)|null} */
  _pending = null;

  /** Build everything, compile the shader and allocate the texture. */
  attach(renderer) {
    this._renderer = renderer;
    this._material = new THREE.ShaderMaterial({
      uniforms: {
        tFrozen: { value: null },
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
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this._quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this._material);
    this._quad.frustumCulled = false;
    this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._scene = new THREE.Scene();
    this._scene.add(this._quad);
    this._ensureTexture();
    renderer.compile?.(this._scene, this._camera);
  }

  /**
   * Copy the screen after this frame is drawn, then run `onCaptured` (the
   * switch). A later call replaces an earlier one not yet run. With no
   * renderer, runs it at once.
   * @param {() => void} onCaptured
   */
  capture(onCaptured) {
    if (!this._renderer) { onCaptured?.(); return; }
    this._pending = onCaptured;
  }

  /** Forget a switch still waiting for its frame. */
  cancel() {
    this._pending = null;
  }

  /** @param {{ active: boolean, frozen: boolean, blank?: boolean, noise: number, tear: number,
   *            roll: number, desat: number, band: number }} t */
  set(t) {
    this._active = !!t.active;
    if (!this._material) return;
    const u = this._material.uniforms;
    u.uFrozen.value = t.frozen ? 1 : 0;
    u.uBlank.value = t.blank ? 1 : 0;
    u.uNoise.value = t.noise;
    u.uTear.value = t.tear;
    u.uRoll.value = t.roll;
    u.uDesat.value = t.desat;
    u.uBand.value = t.band;
  }

  /** Advance the grain's clock (only while a switch plays). */
  tick(dt) {
    if (!this._active || !this._material) return;
    this._material.uniforms.uTime.value += dt;
  }

  /** After the frame is drawn: the copy a switch is waiting for, then the
   *  switch drawn over the frame, if one is playing. */
  render() {
    const renderer = this._renderer;
    if (!renderer) return;
    if (this._pending) {
      this._ensureTexture();
      renderer.copyFramebufferToTexture(this._texture);
      const run = this._pending;
      this._pending = null;
      run();
    }
    if (!this._active) return;
    const clear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(this._scene, this._camera);
    renderer.autoClear = clear;
  }

  dispose() {
    this._pending = null;
    this._texture?.dispose();
    this._quad?.geometry.dispose();
    this._material?.dispose();
    this._scene?.clear();
    this._texture = this._quad = this._material = this._scene = this._camera = null;
    this._renderer = null;
  }

  /** A texture the size of the drawing buffer, made again if that changed. */
  _ensureTexture() {
    this._renderer.getDrawingBufferSize(_size);
    const t = this._texture;
    if (t && t.image.width === _size.x && t.image.height === _size.y) return;
    t?.dispose();
    this._texture = new THREE.FramebufferTexture(_size.x, _size.y);
    this._texture.minFilter = this._texture.magFilter = THREE.LinearFilter;
    if (this._material) this._material.uniforms.tFrozen.value = this._texture;
    this._renderer.initTexture?.(this._texture);
  }
}
