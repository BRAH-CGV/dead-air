import { readFileSync } from 'node:fs';

// ─────────────────────────────────────────────
// Vitest config  –  separate from vite.config.js on purpose
// ─────────────────────────────────────────────
// Vitest prefers this file when it exists, so the production build in
// vite.config.js is untouched by anything here. That matters: everything
// below is a test-only workaround and must not follow us to the LAMP server.
//
// Why the alias: @dimforge/rapier3d ships `module` but no `main` in its
// package.json, which the browser build resolves happily and Node's resolver
// does not. Pointing straight at the entry file, and inlining the package so
// the .wasm import goes through the plugin below, lets the physics tests run
// the real engine instead of a mock.
//
// Why not vite-plugin-wasm here: its helper fetches the .wasm by url, and
// Node can't fetch `file:///__vite-plugin-wasm-helper` (BUG-003 — every file
// that imported Rapier failed before a single test ran). Under Node the bytes
// are on disk, so wasmFromDisk compiles them synchronously instead.
// ─────────────────────────────────────────────

/**
 * Turn a `.wasm` import into a module that instantiates it from disk and
 * exports what it exports — the ESM integration a bundler gives the browser.
 * The export names are read off the compiled module here, at transform time,
 * because an ES module's exports have to be written out by name.
 */
function wasmFromDisk() {
  return {
    name: 'test-wasm-from-disk',
    enforce: 'pre',
    load(id) {
      const file = id.split('?')[0];
      if (!file.endsWith('.wasm')) return null;
      const compiled = new WebAssembly.Module(readFileSync(file));
      const sources = [...new Set(WebAssembly.Module.imports(compiled).map(i => i.module))];
      const names = WebAssembly.Module.exports(compiled).map(e => e.name);
      return [
        `import { readFileSync } from 'node:fs';`,
        ...sources.map((source, i) => `import * as imports${i} from ${JSON.stringify(source)};`),
        `const compiled = new WebAssembly.Module(readFileSync(${JSON.stringify(file)}));`,
        `const instance = new WebAssembly.Instance(compiled, {`,
        ...sources.map((source, i) => `  ${JSON.stringify(source)}: imports${i},`),
        `});`,
        ...names.map(name => `export const ${name} = instance.exports.${name};`),
      ].join('\n');
    },
  };
}

export default {
  plugins: [wasmFromDisk()],
  resolve: {
    alias: {
      // Root-relative, so it works on every teammate's machine.
      '@dimforge/rapier3d': '/node_modules/@dimforge/rapier3d/rapier.js',
    },
  },
  test: {
    include: ['src/**/*.test.js'],
    // Worker threads, not the default forked processes: on Windows a cold
    // fork sometimes never answered ("Timeout waiting for worker to
    // respond", BUG-004), and the whole suite runs faster this way too.
    pool: 'threads',
    server: {
      deps: { inline: [/rapier/] },
    },
  },
};
