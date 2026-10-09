import wasm from 'vite-plugin-wasm';

// ─────────────────────────────────────────────
// Vitest config – separate from vite.config.js on purpose
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

// vite-plugin-wasm serves its wasm glue helper at the root-relative module id
// "/__vite-plugin-wasm-helper" — a URL the dev server can answer and a file
// path Node cannot: the module runner turns it into the file URL
// file:///__vite-plugin-wasm-helper, which on Windows has no drive letter, and
// every physics test dies before it imports anything. Republish the same
// helper under a proper virtual id (leading \0 — kept in memory, never read
// from disk) before the plugin's own resolveId sees the id. The function is
// the plugin's own dist/wasm-helper.js, verbatim; keep it in step with it.
const wasmHelper = async (opts = {}, url) => {
  let result;
  if (url.startsWith('data:')) {
    const urlContent = url.replace(/^data:.*?base64,/, '');
    let bytes;
    if (typeof Buffer === 'function' && typeof Buffer.from === 'function') {
      bytes = Buffer.from(urlContent, 'base64');
    } else if (typeof atob === 'function') {
      const binaryString = atob(urlContent);
      bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
    } else {
      throw new Error('Cannot decode base64-encoded data URL');
    }
    result = await WebAssembly.instantiate(bytes, opts);
  } else {
    // instantiateStreaming needs an application/wasm Content-Type, which
    // static servers don't always send; fall back to the raw bytes.
    const response = await fetch(url);
    const contentType = response.headers.get('Content-Type') || '';
    if ('instantiateStreaming' in WebAssembly && contentType.startsWith('application/wasm')) {
      result = await WebAssembly.instantiateStreaming(response, opts);
    } else {
      const buffer = await response.arrayBuffer();
      result = await WebAssembly.instantiate(buffer, opts);
    }
  }
  return result.instance.exports;
};

const wasmHelperShim = {
  name: 'wasm-helper-shim',
  enforce: 'pre',
  resolveId(id) {
    if (id === '/__vite-plugin-wasm-helper') return '\0wasm-helper-shim';
  },
  load(id) {
    if (id === '\0wasm-helper-shim') return `export default ${wasmHelper}`;
  },
};

export default {
  plugins: [wasmHelperShim, wasm()],
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
