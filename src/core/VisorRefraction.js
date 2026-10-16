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
// A screen pass (engine.screenPasses), drawn after the frame:
//
//   pass.attach(renderer);              // at scene build
//   engine.screenPasses.push(pass);     // render() after each frame
//   pass.setIntensity(opacity);         // SuitVisor, every frame
//
// It copies the finished frame (copyFramebufferToTexture, as the CCTV
// switch does) and draws it back over itself, warped. So the scene is drawn
// exactly as it is without the helmet: antialiased, tone mapped, sRGB, at
// full resolution. It used to be a PostPipeline pass, which drew the scene
// into an off-screen target instead: no MSAA, CSS-pixel sized, 8-bit linear
// and never tone mapped. Behind the glass the outside shimmered and banded.
//
// The copied pixels are already as shown, so the shader passes them through
// without tone mapping or colour-space conversion.
//
// Cost while the helmet is on: one screen copy and one full-screen quad a
// frame. With it off, nothing. The shader is compiled and the texture
// allocated in attach(), so putting the helmet on doesn't hitch.
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

const _size = new THREE.Vector2();

export class VisorRefraction {
  _renderer = null;
  _material = null;
  _quad = null;
  _scene = null;
  _camera = null;
  /** The finished frame, copied each frame the helmet is on. */
  _texture = null;

  /** 0 = no distortion, 1 = full DEFAULT_STRENGTH.  Driven by SuitVisor's
   *  fade so the warp eases in with the glass overlay. */
  _intensity = 0;

  /** Build the shader, quad and texture, and compile them.  Called once, as
   *  the scene is built. */
  attach(renderer) {
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

  /** True while the distortion is non-zero. */
  get active() { return this._intensity > 0.001; }

  /** Set the effect strength 0..1.  0 = flat glass, 1 = full warp. */
  setIntensity(v) { this._intensity = Math.max(0, Math.min(1, v)); }

  /** After the frame is drawn: copy it, then draw it back over the screen
   *  with the barrel distortion.  Nothing while the helmet is off. */
  render() {
    const renderer = this._renderer;
    if (!renderer || !this._material || !this.active) return;
    this._ensureTexture();
    renderer.copyFramebufferToTexture(this._texture);

    const u = this._material.uniforms;
    u.uStrength.value = this._intensity * DEFAULT_STRENGTH;
    u.uAspect.value = _size.x / _size.y;

    // The quad covers every pixel, so there is nothing to clear.
    const clear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(null);
    renderer.render(this._scene, this._camera);
    renderer.autoClear = clear;
  }

  /** Free GPU resources. */
  dispose() {
    this._texture?.dispose();
    this._texture = null;
    if (this._quad) { this._quad.geometry.dispose(); this._quad = null; }
    if (this._material) { this._material.dispose(); this._material = null; }
    if (this._scene) { this._scene.clear(); this._scene = null; }
    this._camera = null;
    this._renderer = null;
    this._intensity = 0;
  }

  /** A texture the size of the drawing buffer, made again if that changed.
   *  Leaves the size in _size. */
  _ensureTexture() {
    this._renderer.getDrawingBufferSize(_size);
    const t = this._texture;
    if (t && t.image.width === _size.x && t.image.height === _size.y) return;
    t?.dispose();
    this._texture = new THREE.FramebufferTexture(_size.x, _size.y);
    this._texture.minFilter = this._texture.magFilter = THREE.LinearFilter;
    this._material.uniforms.tDiffuse.value = this._texture;
    this._renderer.initTexture?.(this._texture);
  }
}
