/* App web (build do apps/web) servido em /. O app usa HashRouter, mas qualquer caminho que
 * não seja arquivo nem /api cai no index.html (fallback de SPA). Sem a pasta do build, /
 * responde uma página simples explicando como gerar. */
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';

const NO_BUILD_PAGE = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Baja Telemetria</title>
<style>body{font:16px/1.5 system-ui,"Segoe UI",sans-serif;background:#141517;color:#e9ecef;margin:0;padding:48px 16px}
main{max-width:640px;margin:0 auto}code{background:#25262b;padding:2px 6px;border-radius:4px}h1{font-size:24px}</style></head>
<body><main><h1>Baja Telemetria — servidor no ar</h1>
<p>A API está funcionando em <code>/api</code>, mas o app web ainda não foi gerado.</p>
<p>Na raiz do projeto, rode <code>npm run build</code> e reinicie o servidor
(ou aponte <code>WEB_DIST</code> para a pasta do build).</p></main></body></html>`;

export async function registerWeb(app: FastifyInstance, webDist: string): Promise<void> {
  const index = path.join(webDist, 'index.html');
  const hasWeb = fs.existsSync(index);

  if (hasWeb) {
    await app.register(fastifyStatic, {
      root: webDist,
      prefix: '/',
      index: ['index.html'],
      setHeaders(reply, file) {
        /* arquivos com hash no nome (assets/) podem ficar em cache; o index.html nunca */
        if (/[\\/]assets[\\/]/.test(file)) reply.header('Cache-Control', 'public, max-age=31536000, immutable');
        else reply.header('Cache-Control', 'no-cache');
      },
    });
  } else {
    app.get('/', async (_req, reply) => {
      reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-cache');
      return NO_BUILD_PAGE;
    });
  }

  app.setNotFoundHandler(async (req, reply) => {
    const url = req.url.split('?')[0];
    if (url === '/api' || url.startsWith('/api/')) {
      return reply.code(404).send({ error: `Rota não encontrada: ${req.method} ${url}` });
    }
    if (hasWeb && (req.method === 'GET' || req.method === 'HEAD') && !path.extname(url)) {
      reply.header('Cache-Control', 'no-cache');
      return reply.sendFile('index.html');
    }
    if (!hasWeb && (req.method === 'GET' || req.method === 'HEAD') && !path.extname(url)) {
      return reply.code(404).type('text/html; charset=utf-8').send(NO_BUILD_PAGE);
    }
    return reply.code(404).send({ error: 'Não encontrado' });
  });
}
