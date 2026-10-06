/* Contas: senhas (scrypt + sal + comparação em tempo constante), token JWT de 30 dias com
 * versão (tv) e os guardas de papel das rotas.
 *
 * O token leva { sub: id do usuário, tv: versão do token }. A versão aumenta quando a senha
 * muda ou o usuário é desativado: tokens antigos param de valer na hora, sem lista negra.
 * O papel e o "desativado" são lidos do banco a cada pedido (mudam sem novo token). */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { DB, Role, UserRow } from './db';
import { forbidden, unauthorized } from './errors';

export interface TokenPayload { sub: string; tv: number }

declare module '@fastify/jwt' {
  interface FastifyJWT { payload: TokenPayload; user: TokenPayload }
}
declare module 'fastify' {
  interface FastifyRequest { me: UserRow | null }
}

/** validade do token; também é a idade máxima pelo iat (verify.maxAge em app.ts) */
export const TOKEN_TTL = '30d';
export const MIN_PASSWORD = 8;

/* ---------------------------------------------------------------- senhas */
const scrypt = promisify(crypto.scrypt) as (pw: string | Buffer, salt: Buffer, keylen: number, opts: crypto.ScryptOptions) => Promise<Buffer>;
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

/** "scrypt$N$r$p$sal$hash" (base64url). */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const { N, r, p, keylen } = SCRYPT;
  const hash = await scrypt(password.normalize('NFKC'), salt, keylen, { N, r, p, maxmem: 64 * 1024 * 1024 });
  return ['scrypt', N, r, p, salt.toString('base64url'), hash.toString('base64url')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [N, r, p] = parts.slice(1, 4).map(Number);
  const salt = Buffer.from(parts[4], 'base64url'), want = Buffer.from(parts[5], 'base64url');
  if (!(N > 1 && r > 0 && p > 0) || !want.length) return false;
  const got = await scrypt(password.normalize('NFKC'), salt, want.length, { N, r, p, maxmem: 64 * 1024 * 1024 });
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

/* hash de uma senha qualquer: o login de um e-mail inexistente gasta o mesmo tempo */
let dummyHash: Promise<string> | null = null;
export const dummyVerify = async (password: string): Promise<void> => {
  dummyHash ??= hashPassword(crypto.randomBytes(12).toString('hex'));
  await verifyPassword(password, await dummyHash);
};

/** Senha temporária legível (sem 0/O/1/l/I), 12 caracteres. */
export function generatePassword(len = 12): string {
  const abc = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < len; i++) s += abc[crypto.randomInt(abc.length)];
  return s;
}

/** Código de convite: 10 caracteres, maiúsculas e dígitos sem ambiguidade. */
export function generateInviteCode(): string {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 10; i++) s += abc[crypto.randomInt(abc.length)];
  return s;
}

export const MIN_SECRET = 32;
/* textos de exemplo da documentação: quem copiar sem trocar teria tokens forjáveis por qualquer um */
const EXAMPLE_SECRETS = new Set(['troque-por-um-texto-longo-e-aleatorio', 'changeme', 'secret', 'segredo']);

/** Segredo do JWT: JWT_SECRET ou DATA_DIR/secret (gerado na primeira subida). Um JWT_SECRET
 *  curto ou copiado do exemplo é recusado: com ele, qualquer um assinaria um token de admin. */
export function loadSecret(dataDir: string, fromEnv?: string): string {
  if (fromEnv !== undefined) {
    const s = fromEnv.trim();
    if (EXAMPLE_SECRETS.has(s.toLowerCase())) {
      throw new Error('JWT_SECRET é o texto de exemplo da documentação: troque por um texto longo e aleatório (openssl rand -hex 32) ou apague a variável para o servidor gerar um');
    }
    if (s.length < MIN_SECRET) {
      throw new Error(`JWT_SECRET curto demais (${s.length} caracteres, mínimo ${MIN_SECRET}): use um texto longo e aleatório (openssl rand -hex 32) ou apague a variável para o servidor gerar um`);
    }
    return s;
  }
  const f = path.join(dataDir, 'secret');
  try {
    const s = fs.readFileSync(f, 'utf8').trim();
    if (s.length >= 32) return s;
  } catch { /* ainda não existe */ }
  const s = crypto.randomBytes(48).toString('base64url');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(f, s + '\n', { mode: 0o600 });
  return s;
}

/* ---------------------------------------------------------------- usuários */
export const ROLES: Role[] = ['viewer', 'member', 'admin'];
const RANK: Record<Role, number> = { viewer: 0, member: 1, admin: 2 };
export const hasRole = (u: Pick<UserRow, 'role'>, min: Role): boolean => RANK[u.role] >= RANK[min];

/** Usuário como a API devolve (sem hash nem versão do token). */
export const publicUser = (u: UserRow) => ({
  id: u.id, name: u.name, email: u.email, role: u.role, disabled: !!u.disabled, createdAt: u.created_at,
});

export const normEmail = (e: string): string => e.trim().toLowerCase();

export const getUser = (db: DB, id: string): UserRow | undefined =>
  db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;

/** Administradores ativos (para proteger o último). */
export const activeAdmins = (db: DB): number =>
  (db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled = 0").get() as { n: number }).n;

/** Token novo para o usuário (versão atual). */
export const signToken = (req: FastifyRequest, u: UserRow): string =>
  req.server.jwt.sign({ sub: u.id, tv: u.token_version });

/* ---------------------------------------------------------------- guardas */
function bearer(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  if (!h) return null;
  const m = /^Bearer\s+(\S+)\s*$/i.exec(h);
  if (!m) throw unauthorized('Cabeçalho Authorization inválido (use Bearer <token>)');
  return m[1];
}

/** Usuário do token, ou null sem token. Token inválido/expirado/antigo → 401. */
export function authenticate(req: FastifyRequest): UserRow | null {
  const tok = bearer(req);
  if (!tok) return null;
  let p: TokenPayload;
  try {
    p = req.server.jwt.verify<TokenPayload>(tok);
  } catch (e) {
    const code = (e as { code?: string }).code || '';
    throw unauthorized(/EXPIRED/i.test(code) ? 'A sessão expirou: entre de novo' : 'Sessão inválida: entre de novo');
  }
  if (!p || typeof p.sub !== 'string' || typeof p.tv !== 'number') throw unauthorized('Sessão inválida: entre de novo');
  const u = getUser(req.server.db, p.sub);
  if (!u) throw unauthorized('Usuário não existe mais: entre de novo');
  if (u.disabled) throw unauthorized('Usuário desativado: fale com um administrador');
  if (u.token_version !== p.tv) throw unauthorized('A senha mudou ou a sessão foi encerrada: entre de novo');
  return u;
}

/** preHandler: exige usuário com pelo menos o papel `min`. Deixa o usuário em req.me. */
export const requireRole = (min: Role) => async (req: FastifyRequest, _reply: FastifyReply): Promise<void> => {
  const u = authenticate(req);
  if (!u) throw unauthorized();
  if (!hasRole(u, min)) {
    throw forbidden(min === 'admin' ? 'Só administradores podem fazer isso'
      : 'Seu papel é só de leitura: peça a um administrador para virar membro');
  }
  req.me = u;
};

/** O usuário pode editar/apagar algo criado por `ownerId`? (dono ou admin) */
export const canEdit = (u: UserRow, ownerId: string | null): boolean =>
  u.role === 'admin' || (u.role === 'member' && !!ownerId && ownerId === u.id);
