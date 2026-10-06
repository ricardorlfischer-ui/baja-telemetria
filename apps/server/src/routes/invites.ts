/* Convites (só administradores): código de uso único, com papel e validade (padrão 7 dias). */
import type { FastifyInstance } from 'fastify';
import { nowIso, type InviteRow, type Role } from '../db';
import { generateInviteCode, requireRole } from '../auth';
import { notFound } from '../errors';
import { ROLE } from './schemas';

type InviteListRow = InviteRow & { created_by_name: string | null; used_by_name: string | null };

const publicInvite = (r: InviteRow & Partial<InviteListRow>) => ({
  code: r.code,
  role: r.role,
  createdBy: r.created_by,
  createdByName: r.created_by_name ?? undefined,
  createdAt: r.created_at,
  expiresAt: r.expires_at,
  usedBy: r.used_by,
  usedByName: r.used_by_name ?? undefined,
  usedAt: r.used_at,
  status: r.used_by || r.used_at ? 'usado' : Date.parse(r.expires_at) <= Date.now() ? 'expirado' : 'ativo',
});

export default async function invitesRoutes(app: FastifyInstance): Promise<void> {
  const db = app.db;
  const admin = requireRole('admin');

  app.get('/invites', { preHandler: admin, schema: { querystring: { type: 'object', additionalProperties: false, properties: {} } } }, async () =>
    (db.prepare(`SELECT i.*, c.name AS created_by_name, u.name AS used_by_name FROM invites i
      LEFT JOIN users c ON c.id = i.created_by LEFT JOIN users u ON u.id = i.used_by
      ORDER BY i.created_at DESC`).all() as InviteListRow[]).map(publicInvite));

  app.post<{ Body: { role?: Role; days?: number } }>('/invites', {
    preHandler: admin,
    schema: {
      body: {
        type: 'object', additionalProperties: false,
        properties: { role: { ...ROLE, default: 'member' }, days: { type: 'number', minimum: 0.01, maximum: 365, default: 7 } },
      },
    },
  }, async (req, reply) => {
    const role = req.body?.role ?? 'member', days = req.body?.days ?? 7;
    let code = generateInviteCode();
    while (db.prepare('SELECT 1 FROM invites WHERE code = ?').get(code)) code = generateInviteCode();
    const inv: InviteRow = {
      code, role, created_by: req.me!.id, created_at: nowIso(),
      expires_at: new Date(Date.now() + days * 86_400_000).toISOString(), used_by: null, used_at: null,
    };
    db.prepare(`INSERT INTO invites (code, role, created_by, created_at, expires_at, used_by, used_at)
      VALUES (@code, @role, @created_by, @created_at, @expires_at, @used_by, @used_at)`).run(inv);
    reply.code(201);
    return publicInvite({ ...inv, created_by_name: req.me!.name });
  });

  app.delete<{ Params: { code: string } }>('/invites/:code', {
    preHandler: admin,
    schema: {
      params: { type: 'object', required: ['code'], additionalProperties: false, properties: { code: { type: 'string', minLength: 1, maxLength: 64 } } },
    },
  }, async (req, reply) => {
    const r = db.prepare('DELETE FROM invites WHERE code = ?').run(req.params.code.trim().toUpperCase());
    if (!r.changes) throw notFound('Convite não encontrado');
    return reply.code(204).send();
  });
}
