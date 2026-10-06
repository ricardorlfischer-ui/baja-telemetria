/* GET /api/health: o servidor e o banco respondem (para o Docker e o monitoramento). */
import type { FastifyInstance } from 'fastify';

export default async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', { schema: { querystring: { type: 'object', additionalProperties: false, properties: {} } } }, async (_req, reply) => {
    try {
      app.db.prepare('SELECT 1').get();
    } catch {
      return reply.code(503).send({ ok: false, error: 'Banco de dados indisponível' });
    }
    return { ok: true, uptime: Math.round(process.uptime()), pendingSummaries: app.recalc.pending };
  });
}
