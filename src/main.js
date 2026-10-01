import { Engine } from './core/Engine.js';
import { LoadingScreen } from './ui/LoadingScreen.js';

// ─────────────────────────────────────────────
// Boot
// ─────────────────────────────────────────────
// init() is async — it waits on the asset preload before building the scene.
// Chained rather than top-level-awaited so the production bundle needs no TLA
// support, and so a failed fetch surfaces on the loading screen instead of
// dying silently in the console.

const engine = new Engine();

// Dev only: a handle for the DevTools console (`__engine.activeScene.suit.putOn()`,
// `__engine.renderer.info`). Vite strips this from the production build.
if (import.meta.env.DEV) window.__engine = engine;

engine.init().catch((err) => {
  new LoadingScreen().fail(err.message ?? String(err));
});
