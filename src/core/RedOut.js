import * as THREE from 'three';

// ─────────────────────────────────────────────
// RedOut  –  post-processing red filter for the evil signal's last second
// ─────────────────────────────────────────────
// A post-processing pass that strips the blue and green channels, leaving a
// luminance-weighted red image.  EvilSignal drives the intensity from 0 → 1
// over the last second of the silence timer, so the world drains to
// blood-red just before the player dies.
//
// Works as a pass inside a PostPipeline.  The pipeline manages render
// targets; this pass only owns its shader material and fullscreen quad.
// The shader material is built eagerly in build() (so the WarmUp pass can
// compile it) but the effect stays dormant until setIntensity() pushes it
// above zero.
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
    float bands = 3.0;
    float quantised = floor(lum * bands + 0.5) / bands;
    // Each band gets a progressively brighter red; the flat offsets keep
    // even the darkest band visible.
    vec3 redTint = vec3(quantised * 3.6 + 0.15, quantised * 0.15 + 0.02, 0.0);
    vec3 col = mix(tex.rgb, redTint, uIntensity);
    gl_FragColor = vec4(col, 1.0);
  }
`;

export class RedOut {
  _renderer = null;
  _material = null;
  _quad = null;
  _scene = null;
  _camera = null;
  _intensity = 0;

  /** Build the shader material.  Called once by PostPipeline.add(). */
  build({ renderer }) {
    this._renderer = renderer;

    this._material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse:   { value: null },
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
  }

  /** Set the effect strength 0..1. 0 = no effect, 1 = full red. */
  setIntensity(v) {
    this._intensity = Math.max(0, Math.min(1, v));
  }

  /** True while the effect is non-zero. The pipeline checks this. */
  get active() { return this._intensity > 0.001; }

  /** Clear the effect (called on night reset). */
  clear() { this._intensity = 0; }

  /** Composite: sample the scene texture and apply the red filter, writing
   *  to the output target (null = screen). */
  composite(inputTex, outputTarget, renderer) {
    if (!this._material) return;
    this._material.uniforms.tDiffuse.value = inputTex;
    this._material.uniforms.uIntensity.value = this._intensity;
    renderer.setRenderTarget(outputTarget);
    renderer.render(this._scene, this._camera);
  }

  /** Compile the composite shader by doing a dummy render to screen. */
  warmUp() {
    if (!this._material || !this._renderer) return;
    this._material.uniforms.tDiffuse.value = null;
    this._material.uniforms.uIntensity.value = 0;
    this._renderer.setRenderTarget(null);
    this._renderer.render(this._scene, this._camera);
  }

  /** Compile the render-target output variants. */
  async preCompile(renderer, targets) {
    if (!this._material || !targets?.length) return;
    this._material.uniforms.tDiffuse.value = targets[0].texture;
    this._material.uniforms.uIntensity.value = 0;
    renderer.setRenderTarget(targets.length > 1 ? targets[1] : null);
    await renderer.compileAsync(this._scene, this._camera);
    renderer.setRenderTarget(null);
  }

  /** Free GPU resources. */
  dispose() {
    if (this._quad) { this._quad.geometry.dispose(); this._quad = null; }
    if (this._material) { this._material.dispose(); this._material = null; }
    if (this._scene) { this._scene.clear(); this._scene = null; }
    this._camera = null;
    this._renderer = null;
    this._intensity = 0;
  }
}
