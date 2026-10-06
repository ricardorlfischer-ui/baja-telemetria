/* Usuários (só administradores): listar, criar com senha temporária, mudar papel/desativar,
 * apagar. O último administrador ativo não pode ser rebaixado, desativado nem apagado. */
import type { FastifyInstance } from 'fastify';
import { nowIso, newId, type DB, type Role, type UserRow } from '../db';
import { activeAdmins, generatePassword, getUser, hashPassword, normEmail, publicUser, requireRole } from '../auth';
import { conflict, notFound } from '../errors';
import { EMAIL, ID_PARAMS, NAME, PASSWORD, ROLE } from './schemas';

const isActiveAdmin = (u: UserRow) => u.role === 'admin' && !u.disabled;

/** 409 se a mudança deixaria o servidor sem administrador ativo. */
function protectLastAdmin(db: DB, u: UserRow, what: string): void {
  if (isActiveAdmin(u) && activeAdmins(db) <= 1) {
    throw conflict(`Não dá para ${what} o último administrador: promova outra pessoa a administrador antes`);
  }
}

export default async function usersRoutes(app: FastifyInstance): Promise<void> {
  const db = app.db;
  const admin = requireRole('admin');
  const NOQS = { type: 'object', additionalProperties: false, properties: {} } as const;

  app.get('/users', { preHandler: admin, schema: { querystring: NOQS } }, async () =>
    (db.prepare('SELECT * FROM users ORDER BY created_at, name').all() as UserRow[]).map(publicUser));

  app.post<{ Body: { name: string; email: string; role?: Role; password?: string } }>('/users', {
    preHandler: admin,
    schema: {
      body: {
        type: 'object', required: ['name', 'email'], additionalProperties: false,
        properties: { name: NAME, email: EMAIL, role: { ...ROLE, default: 'member' }, password: PASSWORD },
      },
    },
  }, async (req, reply) => {
    const email = normEmail(req.body.email);
    const taken = () => { if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw conflict('Já existe uma conta com este e-mail'); };
    taken();
    const temp = req.body.password ? null : generatePassword();
    const u: UserRow = {
      id: newId(), name: req.body.name.trim(), email, pass_hash: await hashPassword(req.body.password ?? temp!),
      role: req.body.role ?? 'member', disabled: 0, token_version: 0, created_at: nowIso(),
    };
    /* de novo depois do hash (assíncrono): dois pedidos iguais ao mesmo tempo → 409, não 500 */
    taken();
    db.prepare(`INSERT INTO users (id, name, email, pass_hash, role, disabled, token_version, created_at)
      VALUES (@id, @name, @email, @pass_hash, @role, @disabled, @token_version, @created_at)`).run(u);
    reply.code(201);
    /* a senha temporária só aparece aqui, uma vez */
    return { ...publicUser(u), ...(temp ? { tempPassword: temp } : {}) };
  });

  app.patch<{ Params: { id: string }; Body: { name?: string; role?: Role; disabled?: boolean; password?: string } }>('/users/:id', {
    preHandler: admin,
    schema: {
      params: ID_PARAMS,
      body: {
        type: 'object', additionalProperties: false, minProperties: 1,
        properties: { name: NAME, role: ROLE, disabled: { type: 'boolean' }, password: PASSWORD },
      },
    },
  }, async req => {
    const u = getUser(db, req.params.id);
    if (!u) throw notFound('Usuário não encontrado');
    const b = req.body;
    if (b.role !== undefined && b.role !== 'admin') protectLastAdmin(db, u, 'rebaixar');
    if (b.disabled === true) protectLastAdmin(db, u, 'desativar');
    const hash = b.password ? await hashPassword(b.password) : null;
    db.transaction(() => {
      if (b.name !== undefined) db.prepare('UPDATE users SET name = ? WHERE id = ?').run(b.name.trim(), u.id);
      if (b.role !== undefined) db.prepare('UPDATE users SET role = ? WHERE id = ?').run(b.role, u.id);
      if (b.disabled !== undefined && !!b.disabled !== !!u.disabled) {
        /* desativar encerra as sessões abertas (versão do token muda) */
        db.prepare(`UPDATE users SET disabled = ?, token_version = token_version + ? WHERE id = ?`)
          .run(b.disabled ? 1 : 0, b.disabled ? 1 : 0, u.id);
      }
      if (hash) db.prepare('UPDATE users SET pass_hash = ?, token_version = token_version + 1 WHERE id = ?').run(hash, u.id);
      /* conferência final: sempre sobra um administrador ativo */
      if (activeAdmins(db) < 1) throw conflict('Não dá para ficar sem administrador ativo');
    })();
    return publicUser(getUser(db, u.id)!);
  });

  app.delete<{ Params: { id: string } }>('/users/:id', { preHandler: admin, schema: { params: ID_PARAMS } }, async (req, reply) => {
    const u = getUser(db, req.params.id);
    if (!u) throw notFound('Usuário não encontrado');
    protectLastAdmin(db, u, 'apagar');
    /* sessões, carros, pistas e anotações ficam (sem autor) */
    db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
    return reply.code(204).send();
  });
}
