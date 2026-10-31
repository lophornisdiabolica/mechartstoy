import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so the build works from any static host path (e.g. GitHub Pages).
  base: './',
  build: {
    // three.js alone is ~500 kB; that's expected for this app.
    chunkSizeWarningLimit: 1000,
  },
  test: {
    environment: 'node',
  },
});
