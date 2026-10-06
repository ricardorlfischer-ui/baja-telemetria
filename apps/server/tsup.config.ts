import { defineConfig } from 'tsup';

/* um arquivo só (dist/index.js) com o @baja/core embutido; better-sqlite3 fica de fora (nativo) */
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  noExternal: ['@baja/core'],
});
