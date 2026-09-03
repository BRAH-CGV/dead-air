import wasm from 'vite-plugin-wasm';

// ─────────────────────────────────────────────
// Vitest config  –  separate from vite.config.js on purpose
// ─────────────────────────────────────────────
// Vitest prefers this file when it exists, so the production build in
// vite.config.js is untouched by anything here. That matters: the alias below
// is a test-only workaround and must not follow us to the LAMP server.
//
// Why the alias: @dimforge/rapier3d ships `module` but no `main` in its
// package.json, which the browser build resolves happily and Node's resolver
// does not. Pointing straight at the entry file, and inlining the package so
// vite-plugin-wasm transforms its .wasm import, lets the physics tests run the
// real engine instead of a mock.
// ─────────────────────────────────────────────

export default {
  plugins: [wasm()],
  resolve: {
    alias: {
      // Root-relative, so it works on every teammate's machine.
      '@dimforge/rapier3d': '/node_modules/@dimforge/rapier3d/rapier.js',
    },
  },
  test: {
    include: ['src/**/*.test.js'],
    server: {
      deps: { inline: [/rapier/] },
    },
  },
};
