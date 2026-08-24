/// <reference types="vitest" />
import { defineConfig } from 'vite';

export default defineConfig({
  base: './', // CRITICAL: keeps all asset paths relative so it works in a LAMP subdirectory
  test: {
    environment: 'node',
    include: ['src/__tests__/**/*.test.js'],
  },
});
