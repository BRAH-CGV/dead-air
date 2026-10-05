// ─────────────────────────────────────────────
// applySettings  –  settings → camera, renderer, player, storm, FPS readout
// ─────────────────────────────────────────────
// Idempotent: App calls it at startup, on every change, and after every
// scene build — buildPlayer makes a new controller with hard-coded values
// and BaseScene makes a new moon light, so both forget the settings on
// every rebuild. Anything missing (no player yet, a scene without a moon)
// is skipped.
//
// Fog is deliberately left alone: BaseScene owns its density per room.
// ─────────────────────────────────────────────

/** The sensitivity buildPlayer was tuned at; the slider multiplies it. */
export const BASE_SENSITIVITY = 0.002;
/** The sky dome is a 400 m sphere that follows the camera. */
export const MIN_FAR = 450;
const SHADOW_SIZE = { low: 1024, high: 2048 };

/**
 * @param {import('../core/Engine.js').Engine} engine
 * @param {object} s  SettingsStore values
 */
export function applySettings(engine, s) {
  const ctrl = engine.playerController;
  if (ctrl) {
    ctrl.sensitivity = BASE_SENSITIVITY * s.sensitivity;
    ctrl.invertY = s.invertY;
    ctrl.cameraSmoothing = s.smoothing;
    ctrl.crouchMode = s.crouchMode;
  }

  // Into the live object: DebugCamera and others hold a reference to it.
  if (engine.keyBinds) Object.assign(engine.keyBinds, s.keyBinds);

  const camera = engine.camera;
  if (camera) {
    const far = Math.max(MIN_FAR, s.renderDistance);
    if (camera.fov !== s.fov || camera.far !== far) {
      camera.fov = s.fov;
      camera.far = far;
      camera.updateProjectionMatrix();
    }
  }

  const renderer = engine.renderer;
  if (renderer) {
    renderer.toneMappingExposure = s.brightness;
    applyShadows(engine, s.shadows);
  }

  // A new scene starts at full quality, so this is handed over each build.
  engine.activeScene?.setStormQuality?.(s.stormQuality);

  if (s.showFps) engine.perfStats?.show?.();
  else engine.perfStats?.hide?.();
}

/** off / low / high. Flipping shadowMap.enabled needs every material
 *  recompiled — three.js bakes shadow support into each shader program, so
 *  without needsUpdate nothing visibly changes. Resizing needs the old map
 *  disposed so three.js reallocates it at the new size. */
function applyShadows(engine, quality) {
  const { renderer } = engine;
  const enabled = quality !== 'off';
  if (renderer.shadowMap && renderer.shadowMap.enabled !== enabled) {
    renderer.shadowMap.enabled = enabled;
    const seen = new Set();
    engine.scene?.traverse?.((obj) => {
      const list = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const material of list) {
        if (!material || seen.has(material)) continue;
        seen.add(material);
        material.needsUpdate = true;
      }
    });
  }

  const shadow = engine.activeScene?.moonLight?.shadow;
  const size = SHADOW_SIZE[quality];
  if (enabled && shadow && shadow.mapSize.x !== size) {
    shadow.mapSize.set(size, size);
    shadow.map?.dispose();
    shadow.map = null;
  }
  // Shadows are frozen (ShadowScheduler): ask for one fresh render.
  engine.shadows?.invalidate?.();
}
