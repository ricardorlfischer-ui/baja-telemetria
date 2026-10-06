import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/* VITE_BASE: caminho onde o app é publicado (ex.: /baja-telemetria/ no GitHub Pages).
 * Em desenvolvimento, /api vai para o servidor local (porta 8080). */
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8080' },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    chunkSizeWarningLimit: 1500,
  },
});
