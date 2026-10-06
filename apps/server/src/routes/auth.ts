/* Contas: primeiro administrador, login, cadastro por convite, eu, troca de senha. */
import type { FastifyInstance } from 'fastify';
import { nowIso, newId, type InviteRow, type UserRow } from '../db';
import {
  dummyVerify, getUser, hashPassword, normEmail, publicUser, requireRole, signToken, verifyPassword,
} from '../auth';
import { badRequest, conflict, forbidden, HttpError, unauthorized } from '../errors';
import { EMAIL, NAME, PASSWORD } from './schemas';

const PER_MINUTE = 60_000;

export default async function authRoutes(app: FastifyInstance, opts: { loginMax?: number }): Promise<void> {
  const db = app.db;
  const limit = (max: number) => ({ rateLimit: { max, timeWindow: PER_MINUTE } });
  const emailTaken = (email: string) => !!db.prepare('SELECT 1 FROM users WHERE email = ?').get(email);

  /* primeiro administrador: só quando ainda não há nenhum usuário */
  app.post<{ Body: { name: string; email: string; password: string } }>('/auth/setup', {
    config: limit(10),
    schema: {
      body: {
        type: 'object', required: ['name', 'email', 'password'], additionalProperties: false,
        properties: { name: NAME, email: EMAIL, password: PASSWORD },
      },
    },
  }, async (req, reply) => {
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
    if (n > 0) throw conflict('O servidor já foi configurado: entre com sua conta');
    const hash = await hashPassword(req.body.password);
    const u: UserRow = {
      id: newId(), name: req.body.name.trim(), email: normEmail(req.body.email), pass_hash: hash,
      role: 'admin', disabled: 0, token_version: 0, created_at: nowIso(),
    };
    db.transaction(() => {
      /* conferido de novo dentro da transação (dois pedidos ao mesmo tempo) */
      if ((db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n > 0) {
        throw conflict('O servidor já foi configurado: entre com sua conta');
      }
      db.prepare(`INSERT INTO users (id, name, email, pass_hash, role, disabled, token_version, created_at)
        VALUES (@id, @name, @email, @pass_hash, @role, @disabled, @token_version, @created_at)`).run(u);
    })();
    reply.code(201);
    return { token: signToken(req, u), user: publicUser(u) };
  });

  app.post<{ Body: { email: string; password: string } }>('/auth/login', {
    config: limit(opts.loginMax ?? 10),
    schema: {
      body: {
        type: 'object', required: ['email', 'password'], additionalProperties: false,
        properties: { email: { type: 'string', minLength: 1, maxLength: 200 }, password: { type: 'string', minLength: 1, maxLength: 200 } },
      },
    },
  }, async req => {
    const u = db.prepare('SELECT * FROM users WHERE email = ?').get(normEmail(req.body.email)) as UserRow | undefined;
    if (!u) {
      await dummyVerify(req.body.password);
      throw unauthorized('E-mail ou senha incorretos');
    }
    if (!(await verifyPassword(req.body.password, u.pass_hash))) throw unauthorized('E-mail ou senha incorretos');
    if (u.disabled) throw forbidden('Usuário desativado: fale com um administrador');
    return { token: signToken(req, u), user: publicUser(u) };
  });

  app.post<{ Body: { code: string; name: string; email: string; password: string } }>('/auth/register', {
    config: limit(10),
    schema: {
      body: {
        type: 'object', required: ['code', 'name', 'email', 'password'], additionalProperties: false,
        properties: { code: { type: 'string', minLength: 1, maxLength: 64 }, name: NAME, email: EMAIL, password: PASSWORD },
      },
    },
  }, async (req, reply) => {
    const code = req.body.code.trim().toUpperCase();
    const email = normEmail(req.body.email);
    const checkInvite = (): InviteRow => {
      const inv = db.prepare('SELECT * FROM invites WHERE code = ?').get(code) as InviteRow | undefined;
      if (!inv) throw badRequest('Código de convite inválido');
      if (inv.used_by || inv.used_at) throw badRequest('Este convite já foi usado');
      if (Date.parse(inv.expires_at) <= Date.now()) throw badRequest('Este convite expirou: peça outro a um administrador');
      return inv;
    };
    checkInvite();
    if (emailTaken(email)) throw conflict('Já existe uma conta com este e-mail');
    const hash = await hashPassword(req.body.password);
    let u!: UserRow;
    db.transaction(() => {
      const inv = checkInvite();   /* de novo: convite de uso único */
      if (emailTaken(email)) throw conflict('Já existe uma conta com este e-mail');
      u = {
        id: newId(), name: req.body.name.trim(), email, pass_hash: hash, role: inv.role,
        disabled: 0, token_version: 0, created_at: nowIso(),
      };
      db.prepare(`INSERT INTO users (id, name, email, pass_hash, role, disabled, token_version, created_at)
        VALUES (@id, @name, @email, @pass_hash, @role, @disabled, @token_version, @created_at)`).run(u);
      db.prepare('UPDATE invites SET used_by = ?, used_at = ? WHERE code = ?').run(u.id, nowIso(), code);
    })();
    reply.code(201);
    return { token: signToken(req, u), user: publicUser(u) };
  });

  app.get('/auth/me', { preHandler: requireRole('viewer'), schema: { querystring: { type: 'object', additionalProperties: false, properties: {} } } },
    async req => ({ user: publicUser(req.me!) }));

  /* troca a própria senha: tokens antigos param de valer, volta um token novo. Com limite de
   * tentativas: sem ele, quem pegasse um token poderia adivinhar a senha atual à vontade. */
  app.post<{ Body: { oldPassword: string; newPassword: string } }>('/auth/password', {
    config: limit(opts.loginMax ?? 10),
    preHandler: requireRole('viewer'),
    schema: {
      body: {
        type: 'object', required: ['oldPassword', 'newPassword'], additionalProperties: false,
        properties: { oldPassword: { type: 'string', minLength: 1, maxLength: 200 }, newPassword: PASSWORD },
      },
    },
  }, async req => {
    const me = req.me!;
    if (!(await verifyPassword(req.body.oldPassword, me.pass_hash))) throw new HttpError(400, 'A senha atual está errada');
    const hash = await hashPassword(req.body.newPassword);
    db.prepare('UPDATE users SET pass_hash = ?, token_version = token_version + 1 WHERE id = ?').run(hash, me.id);
    const u = getUser(db, me.id)!;
    return { token: signToken(req, u), user: publicUser(u) };
  });

}
