/* Sobe o servidor da equipe (docs/ARQUITETURA.md 5). Configuração pelas variáveis de
 * ambiente (src/config.ts); LOCAL_MODE=1 liga o modo local, só neste computador (src/local.ts).
 * Para parar: Ctrl+C (fecha o banco direito). */
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
  console.error(`Telemetria Mauá Racing Baja: não deu para subir o servidor: ${e instanceof Error ? e.message : String(e)}`);
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
  /* app.cfg: no modo local o host já foi conferido (só 127.0.0.1) */
  const { port, host, dataDir, webDist, localMode } = app.cfg;
  await app.listen({ port, host });
  if (localMode) {
    app.log.info(`Telemetria Mauá Racing Baja ${VERSION} · modo local (este computador, sem login): ` +
      `abra http://localhost:${port} · só responde neste computador (${host}) · dados em ${dataDir} · app web de ${webDist}`);
  } else {
    app.log.info(`Telemetria Mauá Racing Baja ${VERSION} · dados em ${dataDir} · app web de ${webDist}`);
  }
} catch (e) {
  app.log.error(e);
  process.exit(1);
}
