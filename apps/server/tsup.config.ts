import { defineConfig } from 'tsup';

/* dist/index.js (servidor) e dist/analysis-worker.js (processo filho que lê e analisa os logs,
 * ver src/analyzer.ts), com o @baja/core embutido; better-sqlite3 e fastify ficam de fora */
export default defineConfig({
  entry: ['src/index.ts', 'src/analysis-worker.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  noExternal: ['@baja/core'],
});
