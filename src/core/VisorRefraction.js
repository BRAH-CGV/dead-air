import * as THREE from 'three';

// ─────────────────────────────────────────────
// VisorRefraction  –  subtle barrel distortion for the EVA helmet visor
// ─────────────────────────────────────────────
// A post-processing pass that bends the world slightly, the way a thick
// curved visor would.  The distortion is a radial barrel warp: pixels near
// the centre of the screen are barely moved, pixels near the edges are
// pushed outward, so straight lines bow gently.
//
// The effect is intentionally subtle — a strength of 0.08–0.12 reads as
// "the glass is curved" without making the player queasy.  It is driven by
// the SuitVisor component: on when the helmet goes on, off when it comes
// off, faded in over the same interval as the glass overlay.
//
// Works as a pass inside a PostPipeline.  The pipeline manages render
// targets; this pass only owns its shader material and fullscreen quad.
// ─────────────────────────────────────────────

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform float uStrength;  // 0..1 — distortion amount
  uniform float uAspect;    // width / height
  varying vec2 vUv;

  void main() {
    // Work in centred, aspect-correct coordinates so the distortion is
    // circular on screen regardless of viewport shape.
    vec2 centered = (vUv - 0.5) * vec2(uAspect, 1.0);

    float r2 = dot(centered, centered);
    // Barrel distortion: each pixel is pushed outward by strength * r².
    // The quadratic keeps the centre still and bends the edges.
    float distort = 1.0 + uStrength * r2;
    vec2 warped = centered * distort;

    // Back to 0..1 UV space.
    vec2 uv = warped / vec2(uAspect, 1.0) + 0.5;

    // Clamp so the edges sample the last valid pixel rather than wrapping.
    uv = clamp(uv, 0.0, 1.0);

    gl_FragColor = texture2D(tDiffuse, uv);
  }
`;

/** How much barrel distortion the visor applies at full intensity.  Tuned
 *  by eye: 0.1 gives a visible but comfortable curve on a 16:9 screen. */
const DEFAULT_STRENGTH = 0.1;

export class VisorRefraction {
  _renderer = null;
  _material = null;
  _quad = null;
  _scene = null;
  _camera = null;

  /** 0 = no distortion, 1 = full DEFAULT_STRENGTH.  Driven by SuitVisor's
   *  fade so the warp eases in with the glass overlay. */
  _intensity = 0;

  /** Build the shader material.  Called once by PostPipeline.add(). */
  build({ renderer }) {
    this._renderer = renderer;

    this._material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse:  { value: null },
        uStrength: { value: 0 },
        uAspect:   { value: 1 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false,
    });

    this._quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this._material);
    this._quad.frustumCulled = false;

    this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._scene = new THREE.Scene();
    this._scene.add(this._quad);
  }

  /** True while the distortion is non-zero. */
  get active() { return this._intensity > 0.001; }

  /** Set the effect strength 0..1.  0 = flat glass, 1 = full warp. */
  setIntensity(v) { this._intensity = Math.max(0, Math.min(1, v)); }

  /** Composite: sample the scene texture with barrel distortion and write
   *  to the output target (null = screen). */
  composite(inputTex, outputTarget, renderer) {
    if (!this._material) return;
    this._material.uniforms.tDiffuse.value = inputTex;
    this._material.uniforms.uStrength.value = this._intensity * DEFAULT_STRENGTH;
    const w = typeof window !== 'undefined' ? window.innerWidth : 1024;
    const h = typeof window !== 'undefined' ? window.innerHeight : 768;
    this._material.uniforms.uAspect.value = w / h;

    renderer.setRenderTarget(outputTarget);
    renderer.render(this._scene, this._camera);
  }

  /** Compile the composite shader by doing a dummy render to screen. */
  warmUp() {
    if (!this._material || !this._renderer) return;
    this._material.uniforms.tDiffuse.value = null;
    this._material.uniforms.uStrength.value = 0;
    this._renderer.setRenderTarget(null);
    this._renderer.render(this._scene, this._camera);
  }

  /** Compile the render-target output variants. */
  async preCompile(renderer, targets) {
    if (!this._material || !targets?.length) return;
    this._material.uniforms.tDiffuse.value = targets[0].texture;
    this._material.uniforms.uStrength.value = 0;
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
