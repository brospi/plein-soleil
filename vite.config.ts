import { defineConfig } from 'vitest/config';

// base relative : le site fonctionne quel que soit le sous-chemin GitHub Pages.
export default defineConfig({
  base: './',
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 900 },
  worker: { format: 'es' },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
  },
});
