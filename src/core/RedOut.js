import * as THREE from 'three';

// ─────────────────────────────────────────────
// RedOut  –  post-processing red filter for the evil signal's last second
// ─────────────────────────────────────────────
// Renders the scene to a render target, then draws a fullscreen quad with a
// shader that strips the blue and green channels, leaving a luminance-
// weighted red image. EvilSignal drives the intensity from 0 → 1 over the
// last second of the silence timer, so the world drains to blood-red just
// before the player dies.
//
// The shader material is built eagerly in attach() (so the WarmUp pass can
// compile it) but the render target is created lazily on first use, keeping
// memory flat until the effect is actually needed.
//
// The fullscreen quad lives in a private composite scene — never in the main
// scene — so it is never rendered into the render target (no feedback loop).
// ─────────────────────────────────────────────

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    // Clip-space quad — covers the screen regardless of camera.
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform float uIntensity;  // 0..1
  varying vec2 vUv;

  void main() {
    vec4 tex = texture2D(tDiffuse, vUv);
    // Luminance-preserving red extraction with cell-shaded bands:
    // quantise brightness into discrete steps, each a distinct red shade.
    float lum = dot(tex.rgb, vec3(0.2126, 0.7152, 0.0722));
    float bands = 4.0;
    float quantised = floor(lum * bands + 0.5) / bands;
    // Each band gets a progressively brighter red; the flat offsets keep
    // even the darkest band visible.
    vec3 redTint = vec3(quantised * 3.6 + 0.15, quantised * 0.15 + 0.02, lum * 0.05);
    vec3 col = mix(tex.rgb, redTint, uIntensity);
    gl_FragColor = vec4(col, 1.0);
  }
`;

export class RedOut {
  _renderer = null;
  _renderTarget = null;
  _material = null;
  _quad = null;
  /** Private scene for the composite pass — keeps the quad out of the main
   *  scene so it never ends up in the render target. */
  _scene = null;
  _camera = null;
  _intensity = 0;

  /** Attach to an engine instance. Builds the shader material eagerly so
   *  the WarmUp pass can compile it; the render target is deferred. */
  attach(engine) {
    this._renderer = engine.renderer;

    this._material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        uIntensity: { value: 0 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false,
    });

    this._quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this._material);
    this._quad.frustumCulled = false;
    this._quad.renderOrder = 2000;  // after SuitVisor (1000)

    this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._scene = new THREE.Scene();
    this._scene.add(this._quad);

    // Eagerly create the render target so the GPU texture is allocated during
    // the boot warm-up, not on first activation (which would stutter).
    this._ensureRenderTarget();
  }

  /** Pre-compile the composite shader by doing a dummy render. Called by
   *  the Engine right after the main WarmUp pass, while the loading screen
   *  still covers the canvas. Without this the first activation compiles
   *  the shader on the spot — a visible hitch. */
  warmUp() {
    if (!this._renderer || !this._renderTarget) return;
    this._material.uniforms.tDiffuse.value = this._renderTarget.texture;
    this._material.uniforms.uIntensity.value = 0;
    this._renderer.setRenderTarget(this._renderTarget);
    this._renderer.render(this._scene, this._camera);
    this._renderer.setRenderTarget(null);
  }

  /** Set the effect strength 0..1. 0 = no effect, 1 = full red. */
  setIntensity(v) {
    this._intensity = Math.max(0, Math.min(1, v));
  }

  /** True while the effect is non-zero. Engine checks this. */
  get active() { return this._intensity > 0.001; }

  /** Called by Engine._renderFrame BEFORE renderer.render().
   *  Redirects output to the render target when the effect is active. */
  preRender() {
    if (!this.active || !this._renderer) return;
    this._ensureRenderTarget();
    this._renderer.setRenderTarget(this._renderTarget);
  }

  /** Called by Engine._renderFrame AFTER the main render.
   *  Composites the red-filtered image to screen. */
  postRender() {
    if (!this.active || !this._renderer) return;
    this._material.uniforms.tDiffuse.value = this._renderTarget.texture;
    this._material.uniforms.uIntensity.value = this._intensity;
    this._renderer.setRenderTarget(null);
    this._renderer.render(this._scene, this._camera);
  }

  /** Clear the effect (called on night reset). */
  clear() { this._intensity = 0; }

  /** Free the render target, geometry, and material. */
  dispose() {
    if (this._renderTarget) {
      this._renderTarget.dispose();
      this._renderTarget = null;
    }
    if (this._quad) {
      this._quad.geometry.dispose();
      this._quad = null;
    }
    if (this._material) {
      this._material.dispose();
      this._material = null;
    }
    if (this._scene) {
      this._scene.clear();
      this._scene = null;
    }
    this._camera = null;
    this._renderer = null;
    this._intensity = 0;
  }

  /** Create the render target on first use, or resize it if the window
   *  has changed. */
  _ensureRenderTarget() {
    const w = typeof window !== 'undefined' ? window.innerWidth : 1024;
    const h = typeof window !== 'undefined' ? window.innerHeight : 768;
    if (this._renderTarget) {
      if (this._renderTarget.width !== w || this._renderTarget.height !== h) {
        this._renderTarget.setSize(w, h);
      }
      return;
    }
    this._renderTarget = new THREE.WebGLRenderTarget(w, h, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
  }
}
