import { defineConfig } from 'vitest/config';

// base relative : le site fonctionne quel que soit le sous-chemin GitHub Pages.
export default defineConfig({
  base: './',
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 900 },
  worker: { format: 'es' },
  // Décodeur LAZ (CommonJS) importé par le worker du nuage de points : préparé d'avance,
  // sinon sa découverte au premier usage recharge la page en développement.
  optimizeDeps: { include: ['laz-perf/lib/worker/index.js'] },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
  },
});
