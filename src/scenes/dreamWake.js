// ─────────────────────────────────────────────
// dreamWake  –  out of a dream and back into the base, without a dead screen
// ─────────────────────────────────────────────
// Every dream ends the same way: the screen already black (the dream has
// covered it — ScreenFade.cover), the base has to be built again. That build
// and the shader compile after it take seconds, so the black is held — with
// the night it is waking into written on it — until the base is built,
// compiled and has drawn a frame or two, and only then lifted. A dream that
// let the fade lift on a timer sat on a dead black screen part-way through.
//
//   await wakeInto(engine, BaseScene, { night: 2, beforeLoad });
//
// The scene is swapped a tick later, never inside the frame that ended the
// dream: a scene can't be torn out from under the loop updating it.
// ─────────────────────────────────────────────

/** Frames the new scene draws before the black lifts. */
const SETTLE_FRAMES = 2;

/** Resolves on the next animation frame (a short timer where there is none). */
const nextFrame = () => new Promise((resolve) => {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
  else setTimeout(resolve, 16);
});

/**
 * @param {import('../core/Engine.js').Engine} engine
 * @param {typeof import('../core/Scene.js').Scene} SceneClass  What to wake into
 * @param {object} [opts]
 * @param {number} [opts.night=1]  The night to wake on (a fresh scene starts on 1)
 * @param {() => void} [opts.beforeLoad]  Run just before the build — e.g. a flag
 *        the new scene reads while it builds
 * @returns {Promise<void>} once the black has lifted
 */
export async function wakeInto(engine, SceneClass, { night = 1, beforeLoad } = {}) {
  const fade = engine.screenFade;
  fade?.caption?.(`NIGHT ${night}`);
  await Promise.resolve();
  beforeLoad?.();
  engine.loadScene(SceneClass, { compile: false });
  if (night > 1) engine.activeScene?.nights?.setNight?.(night);
  try {
    await engine.compileScene?.();
  } catch (err) {
    console.warn('[dreamWake] precompile on waking failed:', err);
  }
  for (let i = 0; i < SETTLE_FRAMES; i++) await nextFrame();
  fade?.uncover?.();
}
