import { WebGLRenderTarget } from 'three';

// ─────────────────────────────────────────────
// WarmUp  –  pay every first-use GPU cost behind the loading screen
// ─────────────────────────────────────────────
// WebGL does its expensive work lazily: a shader program is compiled the
// first frame its material is drawn, a texture uploaded the first frame it
// is sampled, a geometry's buffers the first frame it is in view, a shadow
// map the first frame its light renders. Each of those lands as a hitch at
// the moment the player first looks at something — the "stutter when I
// look around for the first time" from the playtest (PERFORMANCE-PLAN.md).
//
// This forces all of it up front, while the loading screen still covers the
// canvas:
//
//   1. compileAsync — every program, in parallel where the driver allows
//      (KHR_parallel_shader_compile), without freezing the page.
//   2. initTexture — every texture uploaded, a few per frame so the loading
//      bar keeps moving.
//   3. one render with frustum culling off and hidden objects shown — every
//      geometry buffer uploaded and every shadow map drawn, including the
//      ones behind the camera and the ones an occlusion zone will show later.
//
//   await warmUp({ renderer, scene, camera, onStage: (label, f) => … });
//
// A rebuilt scene (Retry, Restart night, Main menu) has no loading screen,
// and its old programs went with the old materials. precompile() is the
// first step alone, run by Engine.loadScene under the rebuild's fade: the
// visible things would compile on the first frame anyway, but the hidden
// ones (the Sleep Demon, the dust eyes, the UFO) only on the frame each
// first showed — a freeze in the middle of the night.
// ─────────────────────────────────────────────

/** Textures uploaded per frame — small enough that the bar keeps moving. */
const TEXTURES_PER_FRAME = 4;

/**
 * Every texture the scene draws with, once each.
 * @param {import('three').Scene} scene
 * @returns {import('three').Texture[]}
 */
export function collectTextures(scene) {
  const found = new Set();
  const take = (value) => { if (value?.isTexture) found.add(value); };

  take(scene.background);
  take(scene.environment);
  scene.traverse((o) => {
    const materials = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const material of materials) {
      for (const key of Object.keys(material)) take(material[key]);
      // ShaderMaterial textures live in its uniforms.
      if (material.uniforms) for (const u of Object.values(material.uniforms)) take(u?.value);
    }
  });
  return [...found];
}

/**
 * @param {object} opts
 * @param {import('three').WebGLRenderer} opts.renderer
 * @param {import('three').Scene} opts.scene
 * @param {import('three').Camera} opts.camera
 * @param {(label: string, fraction: number) => void} [opts.onStage]
 * @param {() => Promise<void>} [opts.nextFrame]  Yield to the browser.
 */
export async function warmUp({
  renderer, scene, camera,
  onStage = () => {},
  nextFrame = () => new Promise(resolve => requestAnimationFrame(() => resolve())),
}) {
  scene.updateMatrixWorld(true);

  // ── 1. Shaders ──
  // Hidden objects shown: an occlusion zone that is hidden now is drawn
  // later. (three's compile reaches hidden meshes anyway; it is the lights
  // it gathers only from visible objects, and those are never shown.)
  onStage('Compiling shaders…', 0);
  const restore = showAll(scene);
  try {
    if (renderer.compileAsync) await renderer.compileAsync(scene, camera);
    else renderer.compile(scene, camera);
  } finally {
    restore();
  }

  // ── 2. Textures ──
  const textures = collectTextures(scene);
  for (let i = 0; i < textures.length; i++) {
    renderer.initTexture(textures[i]);
    if ((i + 1) % TEXTURES_PER_FRAME === 0 || i === textures.length - 1) {
      onStage('Uploading textures…', (i + 1) / textures.length);
      await nextFrame();
    }
  }

  // ── 3. One frame of everything ──
  onStage('Preparing scene…', 1);
  const restoreVisible = showAll(scene);
  const culled = [];
  scene.traverse((o) => {
    if (o.frustumCulled) { o.frustumCulled = false; culled.push(o); }
  });
  try {
    renderer.render(scene, camera);
  } finally {
    for (const o of culled) o.frustumCulled = true;
    restoreVisible();
  }
  await nextFrame();
}

/**
 * Every shader program the scene can draw with, hidden objects included,
 * compiled in the background where the driver allows. Nothing is drawn or
 * uploaded, and nothing hidden is shown: three's compile walks every mesh,
 * visible or not.
 * @param {object} opts
 * @param {import('three').WebGLRenderer} opts.renderer
 * @param {import('three').Scene} opts.scene
 * @param {import('three').Camera} opts.camera
 */
export async function precompile({ renderer, scene, camera }) {
  if (renderer?.compileAsync) await renderer.compileAsync(scene, camera);
  else renderer?.compile?.(scene, camera);
}

/**
 * The warm-up's last step for a rebuild, unseen: draw everything once,
 * hidden or behind the camera, into a small target off screen, so every
 * buffer and texture is on the GPU before the player first looks at it.
 * Portal culling draws a room only once a doorway shows it; after a
 * rebuild, which only compiles, the office's first sight uploaded the lot
 * at once (#175). No shadow map is drawn meanwhile: a hidden caster shown
 * for this would land in it. Into a target, the programs are the red
 * pass's variants, which a rebuild compiles anyway.
 * @param {object} opts
 * @param {import('three').WebGLRenderer|null} opts.renderer
 * @param {import('three').Scene} opts.scene
 * @param {import('three').Camera} opts.camera
 */
export function uploadAll({ renderer, scene, camera }) {
  if (!renderer?.render || !renderer.setRenderTarget) return;
  const target = new WebGLRenderTarget(16, 16);
  const previous = renderer.getRenderTarget();
  const shadows = renderer.shadowMap;
  const { autoUpdate, needsUpdate } = shadows ?? {};
  const restoreVisible = showAll(scene);
  const culled = [];
  scene.traverse((o) => {
    if (o.frustumCulled) { o.frustumCulled = false; culled.push(o); }
  });
  try {
    if (shadows) { shadows.autoUpdate = false; shadows.needsUpdate = false; }
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
  } finally {
    renderer.setRenderTarget(previous);
    if (shadows) { shadows.autoUpdate = autoUpdate; shadows.needsUpdate = needsUpdate; }
    for (const o of culled) o.frustumCulled = true;
    restoreVisible();
    target.dispose();
  }
}

/** Show every hidden object; returns a function that hides them again.
 *  Lights are left alone — showing one would change the light count the
 *  shaders compile for. */
function showAll(scene) {
  const hidden = [];
  scene.traverse((o) => {
    if (!o.visible && !o.isLight) { o.visible = true; hidden.push(o); }
  });
  return () => { for (const o of hidden) o.visible = false; };
}
