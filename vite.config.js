import wasm from 'vite-plugin-wasm';

export default {
  base: './', // CRITICAL: keeps all asset paths relative so it works in a LAMP subdirectory
  plugins: [wasm()],
  optimizeDeps: {
    exclude: ['@dimforge/rapier3d'],
  },
};
