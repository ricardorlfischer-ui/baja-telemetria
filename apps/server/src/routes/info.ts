/* GET /api/info: nome, versão e se falta criar o primeiro administrador. */
import type { FastifyInstance } from 'fastify';
import pkg from '../../package.json' with { type: 'json' };

export const VERSION: string = pkg.version;

export default async function infoRoutes(app: FastifyInstance): Promise<void> {
  app.get('/info', { schema: { querystring: { type: 'object', additionalProperties: false, properties: {} } } }, async () => {
    const { n } = app.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
    return { name: 'Telemetria · Mauá Racing Baja', version: VERSION, needsSetup: n === 0 };
  });
}
