/* Modo local ("este computador", docs/ARQUITETURA.md 5.4): o servidor roda no PC de quem usa,
 * só para o app aberto nele. Sem contas e sem login: toda rota /api usa o usuário deste
 * computador, criado na primeira subida (ou o primeiro admin, se a pasta já foi usada no
 * modo equipe).
 *
 * Sem token, a proteção é saber de onde vem o pedido. Cada pedido (API e páginas do app)
 * precisa, ao mesmo tempo:
 *   - vir de loopback (127.0.0.1 / ::1): ninguém da rede chega aqui (e o servidor só escuta
 *     em 127.0.0.1);
 *   - ter Host localhost / 127.0.0.1 / [::1] com a porta do servidor: um site de fora que faça
 *     o nome dele apontar para 127.0.0.1 (DNS rebinding) manda o Host dele e leva 403;
 *   - se tiver Origin, ser o próprio app (http://localhost:<porta> e afins): outro site aberto
 *     no mesmo navegador não consegue mandar POST/DELETE para o localhost;
 *   - se tiver Sec-Fetch-Site, ser same-origin ou none (endereço digitado, atalho); de outro
 *     site só vale abrir a página do app por um link, nunca a API (nem um GET por <img>).
 * Senão 403. As rotas de contas (setup, login, convites, usuários...) dão 404 aqui. */
import crypto from 'node:crypto';
import os from 'node:os';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { nowIso, newId, type DB, type UserRow } from './db';
import { getUser, hashPassword } from './auth';
import { forbidden, notFound } from './errors';

export const LOCAL_EMAIL = 'local@este.computador';
export const LOCAL_FORBIDDEN = 'Modo local: só o app aberto neste computador pode usar este servidor.';
export const LOCAL_NO_ACCOUNTS = 'No modo local não há contas: o app usa o usuário deste computador.';
const DEFAULT_NAME = 'Este computador';

/** Rota de contas, que não existe no modo local? (padrão da rota no Fastify, não o caminho
 *  pedido: /api//auth/login e afins não enganam). Tudo em /api/auth/* menos /auth/me, e tudo
 *  em /api/users* e /api/invites*: uma rota de contas nova já nasce fechada aqui. */
export function isAccountRoute(route: string | undefined): boolean {
  if (!route) return false;
  const under = (p: string) => route === p || route.startsWith(`${p}/`);
  return (route.startsWith('/api/auth/') && route !== '/api/auth/me') || under('/api/users') || under('/api/invites');
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const LOCAL_NAMES = ['localhost', '127.0.0.1', '[::1]'];

/** HOST aceito no modo local: vazio, 127.0.0.1 ou localhost (vira 127.0.0.1). Outro valor →
 *  erro: o modo local não tem login e não pode ficar exposto na rede. */
export function localHost(host: string | undefined): string {
  const h = (host || '').trim().toLowerCase();
  if (!h || h === '127.0.0.1' || h === 'localhost') return '127.0.0.1';
  throw new Error(`modo local (LOCAL_MODE) não pode ficar exposto na rede: HOST=${host} não é aceito ` +
    '(ele escuta só em 127.0.0.1; apague HOST ou use 127.0.0.1)');
}

/** Nome do usuário local: LOCAL_USER_NAME, o usuário do sistema ou "Este computador". */
function systemUserName(): string {
  try { return os.userInfo().username; } catch { return ''; }
}

/** Usuário deste computador: o primeiro admin ativo (pasta já usada no modo equipe) ou um
 *  admin novo, criado aqui com uma senha aleatória que ninguém usa (não há login). */
export async function ensureLocalUser(db: DB, name?: string): Promise<UserRow> {
  const firstAdmin = () => db.prepare(
    "SELECT * FROM users WHERE role = 'admin' AND disabled = 0 ORDER BY created_at, rowid LIMIT 1",
  ).get() as UserRow | undefined;
  const found = firstAdmin();
  if (found) return found;

  const nm = (name?.trim() || systemUserName().trim() || DEFAULT_NAME).slice(0, 120);
  const hash = await hashPassword(crypto.randomBytes(32).toString('base64url'));
  return db.transaction(() => {
    const again = firstAdmin();   /* de novo, já com o hash pronto */
    if (again) return again;
    const old = db.prepare('SELECT * FROM users WHERE email = ?').get(LOCAL_EMAIL) as UserRow | undefined;
    if (old) {
      /* o usuário local existia mas foi rebaixado/desativado no modo equipe: volta a ser admin,
       * com senha aleatória nova e tokens antigos cancelados (quem conhecia a senha dele não
       * ganha um admin quando a pasta voltar ao modo equipe) */
      db.prepare("UPDATE users SET role = 'admin', disabled = 0, pass_hash = ?, token_version = token_version + 1 WHERE id = ?")
        .run(hash, old.id);
      return getUser(db, old.id)!;
    }
    const u: UserRow = {
      id: newId(), name: nm, email: LOCAL_EMAIL, pass_hash: hash, role: 'admin',
      disabled: 0, token_version: 0, created_at: nowIso(),
    };
    db.prepare(`INSERT INTO users (id, name, email, pass_hash, role, disabled, token_version, created_at)
      VALUES (@id, @name, @email, @pass_hash, @role, @disabled, @token_version, @created_at)`).run(u);
    return u;
  })();
}

/** O pedido veio do app aberto neste computador? (loopback + Host + Origin) */
export function isLocalRequest(req: FastifyRequest, port: number): boolean {
  if (!LOOPBACK.has(req.socket.remoteAddress ?? '')) return false;
  const hosts = new Set(LOCAL_NAMES.map(h => `${h}:${port}`));
  const origins = new Set(LOCAL_NAMES.map(h => `http://${h}:${port}`));
  if (port === 80) LOCAL_NAMES.forEach(h => { hosts.add(h); origins.add(`http://${h}`); });
  const host = req.headers.host;
  if (typeof host !== 'string' || !hosts.has(host.trim().toLowerCase())) return false;
  const origin = req.headers.origin;
  if (origin !== undefined && !(typeof origin === 'string' && origins.has(origin.trim().toLowerCase()))) return false;
  /* Sec-Fetch-Site (Edge, Chrome, Firefox e Safari atuais): o navegador diz se o pedido vem de
   * outro site. Um GET sem Origin (<img>, <script>, fetch no-cors) passaria pelo Origin: a
   * resposta não sai do navegador, mas o site saberia que o app roda aqui e quais sessões
   * existem. De outro site (ou de outra porta do localhost, "same-site") só vale abrir a página
   * do app por um link (navegação), nunca a API nem os arquivos dela. */
  const site = req.headers['sec-fetch-site'];
  if (site !== undefined && site !== 'same-origin' && site !== 'none') {
    const nav = req.headers['sec-fetch-mode'] === 'navigate' && (req.method === 'GET' || req.method === 'HEAD');
    if (!nav || isApi(req)) return false;
  }
  return true;
}

/** Pedido para a API? (pela rota achada ou pelo caminho, sem ligar para maiúsculas nem barras
 *  repetidas: na dúvida, é API) */
const API = /^\/+api(\/|$)/i;
const isApi = (req: FastifyRequest): boolean => API.test(req.routeOptions.url ?? '') || API.test(req.url.split('?')[0]);

/** Guarda do modo local: antes de tudo (antes de ler o corpo), em todo pedido. */
export function installLocalGuard(app: FastifyInstance, port: number): void {
  app.addHook('onRequest', async req => {
    if (!isLocalRequest(req, port)) throw forbidden(LOCAL_FORBIDDEN);
    if (isAccountRoute(req.routeOptions.url)) throw notFound(LOCAL_NO_ACCOUNTS);
  });
}
