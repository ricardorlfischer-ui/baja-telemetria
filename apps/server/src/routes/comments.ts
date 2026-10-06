/* Anotações numa sessão (opcionalmente num instante t do log, em s). Viewer lê; membro
 * escreve; apaga quem escreveu ou um administrador. */
import type { FastifyInstance } from 'fastify';
import { nowIso, newId, type CommentRow } from '../db';
import { canEdit, requireRole } from '../auth';
import { forbidden, notFound } from '../errors';
import { ID_PARAMS } from './schemas';

type Row = CommentRow & { user_name: string | null };

const publicComment = (r: Row) => ({
  id: r.id, sessionId: r.session_id, userId: r.user_id ?? undefined, userName: r.user_name ?? undefined,
  t: r.t, text: r.text, createdAt: r.created_at,
});

const SELECT = 'SELECT c.*, u.name AS user_name FROM comments c LEFT JOIN users u ON u.id = c.user_id';

export default async function commentsRoutes(app: FastifyInstance): Promise<void> {
  const db = app.db;
  const viewer = requireRole('viewer'), member = requireRole('member');
  const sessionExists = (id: string) => {
    if (!db.prepare('SELECT 1 FROM sessions WHERE id = ?').get(id)) throw notFound('Sessão não encontrada');
  };

  app.get<{ Params: { id: string } }>('/sessions/:id/comments', { preHandler: viewer, schema: { params: ID_PARAMS } }, async req => {
    sessionExists(req.params.id);
    return (db.prepare(`${SELECT} WHERE c.session_id = ? ORDER BY c.t IS NULL, c.t, c.created_at`)
      .all(req.params.id) as Row[]).map(publicComment);
  });

  app.post<{ Params: { id: string }; Body: { t?: number | null; text: string } }>('/sessions/:id/comments', {
    preHandler: member,
    schema: {
      params: ID_PARAMS,
      body: {
        type: 'object', required: ['text'], additionalProperties: false,
        properties: {
          t: { type: ['number', 'null'], minimum: 0, maximum: 1e7 },
          text: { type: 'string', minLength: 1, maxLength: 4000, pattern: '\\S' },
        },
      },
    },
  }, async (req, reply) => {
    sessionExists(req.params.id);
    const id = newId();
    db.prepare('INSERT INTO comments (id, session_id, user_id, t, text, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, req.params.id, req.me!.id, req.body.t ?? null, req.body.text.trim(), nowIso());
    reply.code(201);
    return publicComment(db.prepare(`${SELECT} WHERE c.id = ?`).get(id) as Row);
  });

  app.delete<{ Params: { id: string } }>('/comments/:id', { preHandler: member, schema: { params: ID_PARAMS } }, async (req, reply) => {
    const c = db.prepare('SELECT * FROM comments WHERE id = ?').get(req.params.id) as CommentRow | undefined;
    if (!c) throw notFound('Anotação não encontrada');
    if (!canEdit(req.me!, c.user_id)) throw forbidden('Só quem escreveu a anotação (ou um administrador) pode apagar');
    db.prepare('DELETE FROM comments WHERE id = ?').run(c.id);
    return reply.code(204).send();
  });
}
