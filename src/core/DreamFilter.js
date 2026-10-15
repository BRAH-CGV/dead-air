import * as THREE from 'three';

// ─────────────────────────────────────────────
// DreamFilter  –  desaturated cel-shaded look for dream sequences
// ─────────────────────────────────────────────
// Renders the scene to a render target, then draws a fullscreen quad with a
// shader that desaturates the image and applies subtle cel-shading with 16
// luminance bands. DreamScene attaches this as engine.postProcess while the
// dream is active; on waking it is disposed and the slot is cleared.
//
// Follows the RedOut pattern: preRender/postRender hooks around the main
// render call. The shader material is built eagerly in attach() (so the
// WarmUp pass can compile it); the render target is created eagerly too,
// keeping memory predictable.
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
    float lum = dot(tex.rgb, vec3(0.2126, 0.7152, 0.0722));

    // 16-band cel shading — subtle blend between smooth and quantised.
    float bands = 16.0;
    float quantised = floor(lum * bands + 0.5) / bands;
    float subtleLum = mix(lum, quantised, 0.3);

    // How much red dominates the pixel: R minus the average of G and B.
    // smoothstep gives a gentle S-curve so the transition between boosted
    // reds and desaturated neutrals is gradual, not a hard threshold.
    float rawRed = tex.r - 0.5 * (tex.g + tex.b);
    float redness = smoothstep(0.05, 0.35, rawRed);

    // Desaturate toward the banded grayscale, but less for red-dominant
    // pixels — they keep their colour so reds stand out against the muted
    // dream. Neutral pixels get 75% desaturation; strong reds only 5%.
    vec3 grey = vec3(subtleLum);
    float desatAmount = mix(0.75, 0.05, redness);
    vec3 dream = mix(tex.rgb, grey, desatAmount);

    // A strong red boost for red-dominant pixels so they pop further.
    dream.r += redness * 0.3;

    gl_FragColor = vec4(mix(tex.rgb, dream, uIntensity), 1.0);
  }
`;

export class DreamFilter {
  _renderer = null;
  _renderTarget = null;
  _material = null;
  _quad = null;
  /** Private scene for the composite pass — keeps the quad out of the main
   *  scene so it never ends up in the render target. */
  _scene = null;
  _camera = null;
  _intensity = 0;

  /** Attach to an engine instance. Builds the shader material and render
   *  target eagerly so the WarmUp pass can compile them. */
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
    this._quad.renderOrder = 2000;

    this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._scene = new THREE.Scene();
    this._scene.add(this._quad);

    // Eagerly create the render target so the GPU texture is allocated during
    // the boot warm-up, not on first activation (which would stutter).
    this._ensureRenderTarget();
  }

  /** Pre-compile the composite shader by doing a dummy render. Called by
   *  the Engine right after the main WarmUp pass, while the loading screen
   *  still covers the canvas.
   *
   *  Renders to the screen (null target), not the render target — the quad
   *  samples tDiffuse, so rendering to the same target creates a feedback
   *  dependency that can stall the GPU. */
  warmUp() {
    if (!this._renderer || !this._renderTarget) return;
    this._material.uniforms.tDiffuse.value = this._renderTarget.texture;
    this._material.uniforms.uIntensity.value = 0;
    this._renderer.setRenderTarget(null);
    this._renderer.render(this._scene, this._camera);
  }

  /** Pre-compile the render-target shader variants. Three.js compiles
   *  separate shader programs for render-target output (no tone mapping,
   *  linear colour space). Without this the first preRender recompiles
   *  every lit material — a multi-second stall on lower-end hardware.
   *  @param {THREE.Scene} scene  @param {THREE.Camera} camera */
  async preCompile(scene, camera) {
    if (!this._renderer || !this._renderTarget) return;
    const was = this._renderer.getRenderTarget?.() ?? null;
    this._renderer.setRenderTarget(this._renderTarget);
    await this._renderer.compileAsync(scene, camera);
    this._renderer.setRenderTarget(null);
    await this._renderer.compileAsync(this._scene, this._camera);
    this._renderer.setRenderTarget(was);
  }

  /** Set the effect strength 0..1. 0 = no effect, 1 = full dream filter. */
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
   *  Composites the dream-filtered image to screen. */
  postRender() {
    if (!this.active || !this._renderer) return;
    this._material.uniforms.tDiffuse.value = this._renderTarget.texture;
    this._material.uniforms.uIntensity.value = this._intensity;
    this._renderer.setRenderTarget(null);
    this._renderer.render(this._scene, this._camera);
  }

  /** Clear the effect. */
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
