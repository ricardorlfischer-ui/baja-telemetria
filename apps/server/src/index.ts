/* Sobe o servidor da equipe (docs/ARQUITETURA.md 5). Configuração pelas variáveis de
 * ambiente (src/config.ts). Para parar: Ctrl+C (fecha o banco direito). */
import type { FastifyInstance } from 'fastify';
import { buildApp, LOG_REDACT } from './app';
import { loadConfig } from './config';
import { VERSION } from './routes/info';

const cfg = loadConfig();
let app: FastifyInstance;
try {
  app = await buildApp({
    ...cfg,
    logger: {
      level: process.env.LOG_LEVEL || 'info',
      redact: LOG_REDACT,
    },
  });
} catch (e) {
  /* configuração inválida (ex.: JWT_SECRET curto): mensagem clara, sem pilha */
  console.error(`Baja Telemetria: não deu para subir o servidor: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}

let closing = false;
const stop = async (sig: string) => {
  if (closing) return;
  closing = true;
  app.log.info(`${sig}: encerrando`);
  try {
    await app.close();
    process.exit(0);
  } catch (e) {
    app.log.error(e);
    process.exit(1);
  }
};
process.on('SIGINT', () => void stop('SIGINT'));
process.on('SIGTERM', () => void stop('SIGTERM'));

try {
  await app.listen({ port: cfg.port, host: cfg.host });
  app.log.info(`Baja Telemetria ${VERSION} · dados em ${cfg.dataDir} · app web de ${cfg.webDist}`);
} catch (e) {
  app.log.error(e);
  process.exit(1);
}
