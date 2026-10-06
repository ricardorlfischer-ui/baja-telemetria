/* Modo local ("este computador"): sem token, com o usuário deste computador; 403 para pedido
 * que não vem do app aberto neste PC (Host, Origin, endereço); rotas de contas 404; /api/info
 * nos dois modos; usuário criado na 1ª subida e reaproveitado; pasta já usada no modo equipe;
 * HOST de rede recusado; log real enviado e lido de volta. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { buildApp } from '../src/app';
import { loadConfig, parseLocalMode } from '../src/config';
import { LOCAL_EMAIL, LOCAL_FORBIDDEN, LOCAL_NO_ACCOUNTS, localHost } from '../src/local';
import { auth, fixture, json, makeApp, makeTeam, multipart, tmpDir, type TestApp } from './helpers';

const PORT = 8090;
const HOST = `localhost:${PORT}`;
const ORIGIN = `http://localhost:${PORT}`;

const opened: TestApp[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const t of opened.splice(0)) await t.close();
  dirs.splice(0).forEach(d => fs.rmSync(d, { recursive: true, force: true }));
});

async function local(opts: Parameters<typeof makeApp>[0] = {}): Promise<TestApp> {
  const t = await makeApp({ localMode: true, port: PORT, ...opts });
  opened.push(t);
  return t;
}

/** pedido do app aberto neste computador (Host certo; inject vem de 127.0.0.1) */
const req = (app: FastifyInstance, o: InjectOptions & { url: string }) =>
  app.inject({ ...o, headers: { host: HOST, ...(o.headers as Record<string, string> | undefined) } });

/** só fecha o servidor (a pasta fica para a próxima subida) */
async function boot(dir: string, extra: Record<string, unknown> = {}): Promise<FastifyInstance> {
  return buildApp({
    dataDir: dir, jwtSecret: 'segredo-de-teste-com-mais-de-32-caracteres!!', corsOrigins: [],
    webDist: path.join(dir, 'sem-web'), localMode: true, port: PORT, recalcOnStart: false, ...extra,
  });
}

describe('modo local: configuração', () => {
  it('LOCAL_MODE liga com 1/true; padrão do HOST vira 127.0.0.1', () => {
    expect(['1', 'true', 'TRUE', ' sim '].map(parseLocalMode)).toEqual([true, true, true, true]);
    expect(['', '0', 'false', 'não', undefined].map(parseLocalMode)).toEqual([false, false, false, false, false]);
    expect(loadConfig({ LOCAL_MODE: '1' })).toMatchObject({ localMode: true, host: '127.0.0.1', localUserName: undefined });
    expect(loadConfig({ LOCAL_MODE: 'true', LOCAL_USER_NAME: ' Ricardo ', PORT: '8090' }))
      .toMatchObject({ localMode: true, localUserName: 'Ricardo', port: 8090 });
    expect(loadConfig({})).toMatchObject({ localMode: false, host: '0.0.0.0' });
    expect(localHost(undefined)).toBe('127.0.0.1');
    expect(localHost('localhost')).toBe('127.0.0.1');
    expect(localHost('127.0.0.1')).toBe('127.0.0.1');
    for (const h of ['0.0.0.0', '::', '192.168.0.10', '::1x']) expect(() => localHost(h)).toThrow(/exposto na rede/);
  });

  it('HOST=0.0.0.0 com LOCAL_MODE: recusa subir (e não deixa o banco aberto)', async () => {
    const dir = tmpDir();
    dirs.push(dir);
    await expect(boot(dir, { host: '0.0.0.0' })).rejects.toThrow(/modo local .* não pode ficar exposto na rede/);
    const env = loadConfig({ LOCAL_MODE: '1', HOST: '0.0.0.0', DATA_DIR: dir });
    await expect(boot(dir, { host: env.host })).rejects.toThrow(/exposto na rede/);
    /* subida com o padrão funciona, e o host fica 127.0.0.1 */
    const app = await boot(dir);
    expect(app.cfg.host).toBe('127.0.0.1');
    await app.close();
  });

  it('ignora CORS_ORIGINS e TRUST_PROXY', async () => {
    const { app } = await local({ corsOrigins: ['https://equipe.github.io'], trustProxy: 1 });
    expect(app.cfg.corsOrigins).toEqual([]);
    expect(app.cfg.trustProxy).toBe(false);
    const r = await req(app, { method: 'OPTIONS', url: '/api/sessions', headers: { origin: 'https://equipe.github.io', 'access-control-request-method': 'POST' } });
    expect(r.statusCode).toBe(403);
    expect(r.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('modo local: usuário deste computador', () => {
  it('criado na 1ª subida (LOCAL_USER_NAME) e reaproveitado na 2ª, na mesma pasta', async () => {
    const dir = tmpDir();
    dirs.push(dir);
    let app = await boot(dir, { localUserName: 'Ricardo' });
    const first = json(await req(app, { url: '/api/info' })).user;
    expect(first).toMatchObject({ name: 'Ricardo', email: LOCAL_EMAIL, role: 'admin' });
    expect(Object.keys(first).sort()).toEqual(['email', 'id', 'name', 'role']);
    /* a senha é aleatória: o hash existe mas ninguém a conhece */
    const row = app.db.prepare('SELECT pass_hash FROM users WHERE id = ?').get(first.id) as { pass_hash: string };
    expect(row.pass_hash).toMatch(/^scrypt\$/);
    await app.close();

    app = await boot(dir, { localUserName: 'Outro nome' });
    const second = json(await req(app, { url: '/api/info' })).user;
    expect(second).toEqual(first);
    expect((app.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n).toBe(1);
    await app.close();
  });

  it('sem LOCAL_USER_NAME: nome do usuário do sistema', async () => {
    const { app } = await local();
    let sys = '';
    try { sys = os.userInfo().username; } catch { /* sem usuário do sistema */ }
    expect(json(await req(app, { url: '/api/info' })).user.name).toBe(sys.trim() || 'Este computador');
  });

  it('pasta que já tinha usuários do modo equipe: usa o primeiro admin ativo', async () => {
    const dir = tmpDir();
    dirs.push(dir);
    /* modo equipe: admin + membros, uma sessão enviada pelo admin */
    const team = await makeApp({ dataDir: dir });
    const tm = await makeTeam(team.app);
    const mp = multipart({}, { name: 'ft_log3_gps.csv', data: fixture('ft_log3_gps.csv') });
    const up = await team.app.inject({ method: 'POST', url: '/api/sessions', headers: { ...mp.headers, ...auth(tm.admin) }, payload: mp.payload });
    expect(up.statusCode).toBe(201);
    await team.app.close();

    const app = await boot(dir, { localUserName: 'Ignorado' });
    const info = json(await req(app, { url: '/api/info' }));
    expect(info.user).toMatchObject({ id: tm.ids.admin, name: 'Admin', email: 'admin@equipe.br', role: 'admin' });
    expect((app.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n).toBe(4);
    /* as sessões do modo equipe aparecem e são do usuário local (dono) */
    const list = json(await req(app, { url: '/api/sessions' }));
    expect(list).toHaveLength(1);
    expect(list[0].uploadedById).toBe(tm.ids.admin);
    const del = await req(app, { method: 'DELETE', url: `/api/sessions/${list[0].id}` });
    expect(del.statusCode).toBe(204);
    await app.close();
  });
});

describe('modo local: rotas', () => {
  it('sem token funciona com o Host certo (localhost, 127.0.0.1, [::1], maiúsculas)', async () => {
    const { app } = await local();
    for (const host of [HOST, `127.0.0.1:${PORT}`, `[::1]:${PORT}`, `LOCALHOST:${PORT}`]) {
      const r = await app.inject({ url: '/api/sessions', headers: { host } });
      expect(r.statusCode, host).toBe(200);
      expect(json(r)).toEqual([]);
    }
    /* de ::1 e de ::ffff:127.0.0.1 também */
    for (const remoteAddress of ['::1', '::ffff:127.0.0.1']) {
      expect((await req(app, { url: '/api/cars', remoteAddress })).statusCode).toBe(200);
    }
    /* um token qualquer (de outro tempo) é ignorado */
    expect((await req(app, { url: '/api/cars', headers: auth('lixo') })).statusCode).toBe(200);
  });

  it('Host de outro site (DNS rebinding) ou porta errada → 403', async () => {
    const { app } = await local();
    for (const host of ['evil.com', `evil.com:${PORT}`, 'localhost:8080', 'localhost', `127.0.0.2:${PORT}`, `localhost.evil.com:${PORT}`, '']) {
      const r = await app.inject({ url: '/api/sessions', headers: { host } });
      expect(r.statusCode, host).toBe(403);
      expect(json(r).error).toBe(LOCAL_FORBIDDEN);
    }
    /* vale também para info, health e as páginas do app */
    for (const url of ['/api/info', '/api/health', '/', '/sessao/x']) {
      expect((await app.inject({ url, headers: { host: 'evil.com' } })).statusCode, url).toBe(403);
    }
  });

  it('pedido de outro endereço (rede) → 403', async () => {
    const { app } = await local();
    for (const remoteAddress of ['192.168.0.10', '10.0.0.5', '::ffff:192.168.0.10', '127.0.0.2']) {
      const r = await req(app, { url: '/api/sessions', remoteAddress });
      expect(r.statusCode, remoteAddress).toBe(403);
      expect(json(r).error).toBe(LOCAL_FORBIDDEN);
    }
  });

  it('Origin de outro site num POST de sessão → 403 (nada guardado); Origin do app → ok', async () => {
    const { app, dir } = await local();
    const raw = fixture('ft_log3_gps.csv');
    const send = (origin?: string) => {
      const mp = multipart({ meta: JSON.stringify({ driver: 'Ana' }) }, { name: 'ft_log3_gps.csv', data: raw });
      return req(app, { method: 'POST', url: '/api/sessions', headers: { ...mp.headers, ...(origin !== undefined ? { origin } : {}) }, payload: mp.payload });
    };
    for (const origin of ['http://evil.com', 'null', `https://localhost:${PORT}`, 'http://localhost:8080', '']) {
      const r = await send(origin);
      expect(r.statusCode, origin).toBe(403);
      expect(json(r).error).toBe(LOCAL_FORBIDDEN);
    }
    expect(json(await req(app, { url: '/api/sessions' }))).toEqual([]);
    expect(fs.existsSync(path.join(dir, 'sessions')) ? fs.readdirSync(path.join(dir, 'sessions')) : []).toEqual([]);
    /* DELETE vindo de outro site também */
    expect((await req(app, { method: 'DELETE', url: '/api/sessions/abc', headers: { origin: 'http://evil.com' } })).statusCode).toBe(403);

    const ok = await send(ORIGIN);
    expect(ok.statusCode).toBe(201);
    expect((await send(`http://127.0.0.1:${PORT}`)).statusCode).toBe(409);   /* mesmo log de novo: duplicado */
  });

  it('rotas de contas → 404 com mensagem; /auth/me devolve o usuário local', async () => {
    const { app } = await local();
    const calls: [string, string, unknown?][] = [
      ['POST', '/api/auth/setup', { name: 'X', email: 'x@x.br', password: 'senha-boa-123' }],
      ['POST', '/api/auth/login', { email: LOCAL_EMAIL, password: 'qualquer' }],
      ['POST', '/api/auth/register', { code: 'ABC', name: 'X', email: 'y@x.br', password: 'senha-boa-123' }],
      ['POST', '/api/auth/password', { oldPassword: 'a', newPassword: 'senha-boa-123' }],
      ['GET', '/api/users'], ['POST', '/api/users', { name: 'X', email: 'z@x.br' }],
      ['PATCH', '/api/users/abc', { name: 'Y' }], ['DELETE', '/api/users/abc'],
      ['GET', '/api/invites'], ['POST', '/api/invites', {}], ['DELETE', '/api/invites/ABC'],
    ];
    for (const [method, url, payload] of calls) {
      const r = await req(app, { method: method as 'GET', url, ...(payload ? { payload: payload as object } : {}) });
      expect(r.statusCode, `${method} ${url}`).toBe(404);
      expect(json(r).error).toBe(LOCAL_NO_ACCOUNTS);
    }
    const me = await req(app, { url: '/api/auth/me' });
    expect(me.statusCode).toBe(200);
    const info = json(await req(app, { url: '/api/info' }));
    expect(json(me).user).toMatchObject({ ...info.user, disabled: false });
    /* rota que não existe continua 404 normal */
    expect(json(await req(app, { url: '/api/nada' })).error).toMatch(/Rota não encontrada/);
  });

  it('/api/info e /api/health sem usuário; info com localMode, pasta e usuário', async () => {
    const { app, dir } = await local();
    const h = await req(app, { url: '/api/health' });
    expect(h.statusCode).toBe(200);
    expect(json(h).ok).toBe(true);
    const i = await req(app, { url: '/api/info' });
    expect(i.statusCode).toBe(200);
    const info = json(i);
    expect(info).toMatchObject({ name: 'Telemetria · Mauá Racing Baja', needsSetup: false, localMode: true, dataDir: path.resolve(dir) });
    expect(path.isAbsolute(info.dataDir)).toBe(true);
    expect(typeof info.version).toBe('string');
    expect(Object.keys(info).sort()).toEqual(['dataDir', 'localMode', 'name', 'needsSetup', 'user', 'version']);
  });

  it('envio de um log real, leitura de volta, carro, pista, anotação e recálculo', async () => {
    const { app } = await local();
    const raw = fixture('busmaster_14.log');
    const mp = multipart({ meta: JSON.stringify({ driver: 'Ana', tags: ['teste'] }) }, { name: 'busmaster_14.log', data: raw });
    const up = await req(app, { method: 'POST', url: '/api/sessions', headers: { ...mp.headers, origin: ORIGIN }, payload: mp.payload });
    expect(up.statusCode).toBe(201);
    const s = json(up);
    const me = json(await req(app, { url: '/api/info' })).user;
    expect(s).toMatchObject({ fileName: 'busmaster_14.log', kind: 'BUSMASTER', size: raw.length, uploadedById: me.id, uploadedBy: me.name, driver: 'Ana' });
    expect(s.summary.metrics.length).toBeGreaterThan(0);

    const d = await req(app, { url: `/api/sessions/${s.id}/file`, headers: { 'accept-encoding': 'gzip' } });
    expect(d.statusCode).toBe(200);
    expect(zlib.gunzipSync(d.rawPayload).equals(raw)).toBe(true);
    expect(json(await req(app, { url: `/api/sessions/${s.id}` })).id).toBe(s.id);

    const car = await req(app, { method: 'POST', url: '/api/cars', headers: { origin: ORIGIN }, payload: { name: 'Carro 2026', params: {} } });
    expect(car.statusCode).toBe(201);
    const track = await req(app, { method: 'POST', url: '/api/tracks', payload: { name: 'Pista', params: {} } });
    expect(track.statusCode).toBe(201);
    const p = await req(app, { method: 'PATCH', url: `/api/sessions/${s.id}`, headers: { origin: ORIGIN }, payload: { carId: json(car).id, trackId: json(track).id } });
    expect(p.statusCode).toBe(200);
    const c = await req(app, { method: 'POST', url: `/api/sessions/${s.id}/comments`, payload: { t: 1.5, text: 'pulo' } });
    expect(c.statusCode).toBe(201);
    expect(json(await req(app, { url: `/api/sessions/${s.id}/comments` }))).toHaveLength(1);
    expect((await req(app, { method: 'POST', url: `/api/sessions/${s.id}/summary` })).statusCode).toBe(200);
    expect((await req(app, { method: 'DELETE', url: `/api/sessions/${s.id}`, headers: { origin: ORIGIN } })).statusCode).toBe(204);
  });
});

describe('modo equipe continua igual', () => {
  it('/api/info sem localMode nem dataDir; rotas exigem token; contas existem', async () => {
    const t = await makeApp();
    opened.push(t);
    const { app } = t;
    const info = json(await app.inject('/api/info'));
    expect(Object.keys(info).sort()).toEqual(['name', 'needsSetup', 'version']);
    expect(info.needsSetup).toBe(true);
    expect(app.localUserId).toBeNull();
    /* sem token: 401, mesmo com Host/Origin de localhost */
    expect((await app.inject({ url: '/api/sessions', headers: { host: HOST, origin: ORIGIN } })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/auth/me', headers: { host: HOST } })).statusCode).toBe(401);
    /* Host qualquer não é problema no modo equipe (atrás de proxy, domínio da equipe) */
    expect((await app.inject({ url: '/api/info', headers: { host: 'telemetria.equipe.br' } })).statusCode).toBe(200);
    const team = await makeTeam(app);
    expect((await app.inject({ url: '/api/users', headers: auth(team.admin) })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/sessions', headers: auth(team.viewer) })).statusCode).toBe(200);
  });
});
