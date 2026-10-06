/* GET /api/info: nome, versão e se falta criar o primeiro administrador. No modo local
 * (src/local.ts) também localMode, a pasta dos dados e o usuário deste computador. */
import type { FastifyInstance } from 'fastify';
import { getUser } from '../auth';
import pkg from '../../package.json' with { type: 'json' };

export const VERSION: string = pkg.version;

export default async function infoRoutes(app: FastifyInstance): Promise<void> {
  app.get('/info', { schema: { querystring: { type: 'object', additionalProperties: false, properties: {} } } }, async () => {
    const name = 'Telemetria · Mauá Racing Baja';
    if (app.cfg.localMode) {
      /* modo local: sem contas; a interface mostra a pasta dos dados e quem é o usuário */
      const u = app.localUserId ? getUser(app.db, app.localUserId) : undefined;
      return {
        name, version: VERSION, needsSetup: false, localMode: true, dataDir: app.cfg.dataDir,
        user: u ? { id: u.id, name: u.name, email: u.email, role: u.role } : null,
      };
    }
    const { n } = app.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
    return { name, version: VERSION, needsSetup: n === 0 };
  });
}
