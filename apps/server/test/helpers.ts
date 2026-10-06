/* Apoio dos testes: servidor com DATA_DIR temporário, contas prontas e envio multipart. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp, type BuildOptions } from '../src/app';

export const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../packages/core/test/fixtures');
export const fixture = (name: string): Buffer => fs.readFileSync(path.join(FIXTURES, name));
export const FIXTURE_FILES = ['ft_log3_gps.csv', 'ft_log3_shocks_compact.csv', 'busmaster_14.log'];

export const PASSWORD = 'senha-boa-123';

export function tmpDir(prefix = 'baja-server-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export interface TestApp {
  app: FastifyInstance;
  dir: string;
  close(): Promise<void>;
}

/** Servidor novo com banco vazio numa pasta temporária (sem app web por padrão). */
export async function makeApp(opts: BuildOptions = {}): Promise<TestApp> {
  const dir = opts.dataDir ?? tmpDir();
  const app = await buildApp({
    dataDir: dir, jwtSecret: 'segredo-de-teste-com-mais-de-32-caracteres!!', corsOrigins: [],
    webDist: path.join(dir, 'sem-web'), maxUploadMb: 100, ...opts,
  });
  return {
    app, dir,
    async close() {
      await app.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

export const auth = (token: string) => ({ authorization: `Bearer ${token}` });

export const json = <T = any>(r: LightMyRequestResponse): T => JSON.parse(r.body) as T;

/** Cria o admin (setup) e devolve o token. */
export async function setupAdmin(app: FastifyInstance, email = 'admin@equipe.br'): Promise<{ token: string; user: any }> {
  const r = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { name: 'Admin', email, password: PASSWORD } });
  if (r.statusCode !== 201) throw new Error(`setup falhou: ${r.statusCode} ${r.body}`);
  return json(r);
}

/** Cria um usuário pelo convite (fluxo real) e devolve o token. */
export async function userWithRole(app: FastifyInstance, adminToken: string, role: 'admin' | 'member' | 'viewer', email: string): Promise<{ token: string; user: any }> {
  const inv = await app.inject({ method: 'POST', url: '/api/invites', headers: auth(adminToken), payload: { role } });
  if (inv.statusCode !== 201) throw new Error(`convite falhou: ${inv.statusCode} ${inv.body}`);
  const r = await app.inject({
    method: 'POST', url: '/api/auth/register',
    payload: { code: json(inv).code, name: `${role} ${email}`, email, password: PASSWORD },
    remoteAddress: `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
  });
  if (r.statusCode !== 201) throw new Error(`cadastro falhou: ${r.statusCode} ${r.body}`);
  return json(r);
}

export interface Team { admin: string; member: string; member2: string; viewer: string; ids: Record<string, string> }

export async function makeTeam(app: FastifyInstance): Promise<Team> {
  const a = await setupAdmin(app);
  const m = await userWithRole(app, a.token, 'member', 'membro@equipe.br');
  const m2 = await userWithRole(app, a.token, 'member', 'membro2@equipe.br');
  const v = await userWithRole(app, a.token, 'viewer', 'leitor@equipe.br');
  return {
    admin: a.token, member: m.token, member2: m2.token, viewer: v.token,
    ids: { admin: a.user.id, member: m.user.id, member2: m2.user.id, viewer: v.user.id },
  };
}

/** Corpo multipart/form-data montado à mão (campos de texto + um arquivo). */
export function multipart(fields: Record<string, string>, file?: { field?: string; name: string; data: Buffer; type?: string }): { payload: Buffer; headers: Record<string, string> } {
  const boundary = '----baja' + Math.random().toString(16).slice(2);
  const chunks: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  if (file) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${file.field ?? 'file'}"; filename="${file.name}"\r\n` +
      `Content-Type: ${file.type ?? 'text/plain'}\r\n\r\n`));
    chunks.push(file.data, Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(chunks), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

/** Envia um log (POST /api/sessions). */
export async function upload(app: FastifyInstance, token: string, name: string, data: Buffer, meta?: Record<string, unknown>) {
  const mp = multipart(meta ? { meta: JSON.stringify(meta) } : {}, { name, data });
  return app.inject({ method: 'POST', url: '/api/sessions', headers: { ...mp.headers, ...auth(token) }, payload: mp.payload });
}

let ipSeq = 0;
/** Login (cada chamada com um IP diferente, para não cair no limite de tentativas). */
export function login(app: FastifyInstance, email: string, password = PASSWORD, ip?: string) {
  ipSeq++;
  return app.inject({
    method: 'POST', url: '/api/auth/login', payload: { email, password },
    remoteAddress: ip ?? `10.77.${(ipSeq >> 8) & 255}.${ipSeq & 255}`,
  });
}
