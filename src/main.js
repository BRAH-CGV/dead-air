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

engine.init().catch((err) => {
  new LoadingScreen().fail(err.message ?? String(err));
});
