import wasm from 'vite-plugin-wasm';

/** Does this module live in the named package under node_modules? */
const inPackage = (name, file = '') => id =>
  id.replaceAll('\\', '/').includes(`/node_modules/${name}/${file}`);

export default {
  base: './', // CRITICAL: keeps all asset paths relative so it works in a LAMP subdirectory
  plugins: [wasm()],
  optimizeDeps: {
    exclude: ['@dimforge/rapier3d'],
  },
  build: {
    rolldownOptions: {
      output: {
        // The libraries get chunks of their own, so no chunk passes the
        // 500 kB warning (BUG-007: the game was one 1 MB file), they download
        // side by side, and a rebuild that only touched our code leaves them
        // cached in the browser. three.js is split where it splits itself:
        // its core, then the WebGL renderer and the add-ons built on it. The
        // core goes first, or the renderer's group would pull it in as one of
        // its dependencies.
        codeSplitting: {
          groups: [
            { name: 'three-core', test: inPackage('three', 'build/three.core.'), priority: 3 },
            { name: 'three', test: inPackage('three'), priority: 2 },
            { name: 'rapier', test: inPackage('@dimforge'), priority: 1 },
          ],
        },
      },
    },
  },
};
