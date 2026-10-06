import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/* Só em desenvolvimento: /__fixtures/ lista e /__fixtures/<nome> devolve os logs de teste
 * (packages/core/test/fixtures e samples/), para abrir logs reais no navegador sem arrastar
 * arquivo: await fetch('/__fixtures/ft_log3_shocks_compact.csv').then(r => r.text()) e
 * window.__baja.session.getState().openText(texto, nome). Não vai para o build. */
function devFixtures(): Plugin {
  const dirs = [
    path.resolve(HERE, '../../packages/core/test/fixtures'),
    path.resolve(HERE, '../../samples'),
  ];
  return {
    name: 'baja-dev-fixtures',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__fixtures', (req, res) => {
        const name = decodeURIComponent((req.url || '/').replace(/^\/+/, '').split('?')[0]);
        if (!name) {
          const list = dirs.filter(existsSync).flatMap(d => readdirSync(d).filter(f => /\.(csv|txt|log)$/i.test(f)));
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(list));
          return;
        }
        if (name.includes('..') || name.includes('/') || name.includes('\\')) { res.statusCode = 400; res.end(); return; }
        const file = dirs.map(d => path.join(d, name)).find(existsSync);
        if (!file) { res.statusCode = 404; res.end(); return; }
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end(readFileSync(file));
      });
    },
  };
}

/* VITE_BASE: caminho onde o app é publicado (ex.: /baja-telemetria/ no GitHub Pages).
 * Em desenvolvimento, /api vai para o servidor local (porta 8080). */
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [react(), devFixtures()],
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
