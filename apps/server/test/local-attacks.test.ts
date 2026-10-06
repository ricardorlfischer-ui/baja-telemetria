/* Modo local, revisão de segurança: cada ataque contra o servidor sem login, provado aqui.
 * DNS rebinding (Host), CSRF de outro site (Origin, Sec-Fetch-Site, multipart "simples"),
 * todos os métodos, X-Forwarded-* com TRUST_PROXY, HOST de rede, rotas de contas por
 * caminhos tortos, a pasta reaproveitada no modo equipe (nenhuma senha conhecida), dataDir
 * fora do modo local, páginas do app com Host estranho e Upgrade (WebSocket) num socket de
 * verdade. */
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { LOCAL_EMAIL, LOCAL_FORBIDDEN, LOCAL_NO_ACCOUNTS, isAccountRoute, localHost } from '../src/local';
import { PASSWORD, auth, fixture, json, login, makeApp, makeTeam, multipart, tmpDir, userWithRole, type TestApp } from './helpers';

const PORT = 8090;
const HOST = `localhost:${PORT}`;
const ORIGIN = `http://localhost:${PORT}`;
const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres!!';

const opened: TestApp[] = [];
const apps: FastifyInstance[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const a of apps.splice(0)) await a.close();
  for (const t of opened.splice(0)) await t.close();
  dirs.splice(0).forEach(d => fs.rmSync(d, { recursive: true, force: true }));
});

async function local(opts: Parameters<typeof makeApp>[0] = {}): Promise<TestApp> {
  const t = await makeApp({ localMode: true, port: PORT, recalcOnStart: false, ...opts });
  opened.push(t);
  return t;
}

const req = (app: FastifyInstance, o: InjectOptions & { url: string }) =>
  app.inject({ ...o, headers: { host: HOST, ...(o.headers as Record<string, string> | undefined) } });

const tmp = () => { const d = tmpDir(); dirs.push(d); return d; };

async function boot(dir: string, extra: Record<string, unknown> = {}): Promise<FastifyInstance> {
  return buildApp({
    dataDir: dir, jwtSecret: SECRET, corsOrigins: [], webDist: path.join(dir, 'sem-web'),
    localMode: true, port: PORT, recalcOnStart: false, ...extra,
  });
}

const forbidden = (r: { statusCode: number; body: string }, what: string) => {
  expect(r.statusCode, what).toBe(403);
  expect(JSON.parse(r.body).error, what).toBe(LOCAL_FORBIDDEN);
};

describe('ataque: DNS rebinding (Host)', () => {
  it('qualquer Host que não seja localhost/127.0.0.1/[::1] com a porta → 403, em API, info, health e páginas', async () => {
    const { app } = await local();
    const bad = [
      'evil.com', `evil.com:${PORT}`, 'localhost', '127.0.0.1', '[::1]',          /* sem porta (porta 80 do navegador) */
      `localhost.:${PORT}`, `LOCALHOST.:${PORT}`, `localhost..:${PORT}`,         /* ponto final */
      `[0:0:0:0:0:0:0:1]:${PORT}`, `[::ffff:127.0.0.1]:${PORT}`, `[::]:${PORT}`,  /* IPv6 escrito de outro jeito */
      `127.1:${PORT}`, `2130706433:${PORT}`, `0x7f000001:${PORT}`, `0.0.0.0:${PORT}`, `127.0.0.2:${PORT}`,
      `foo.localhost:${PORT}`, `localhost.evil.com:${PORT}`, `localhost:${PORT}.evil.com`, `localhost:${PORT}@evil.com`,
      `evil.com@localhost:${PORT}`, `localhost:0${PORT}`, `localhost:${PORT + 1}`, 'localhost:80', 'localhost:443',
      `localhost:${PORT}, evil.com`, '',
    ];
    for (const host of bad) {
      for (const url of ['/api/sessions', '/api/info', '/api/health', '/', '/index.html', '/sessao/x']) {
        forbidden(await app.inject({ url, headers: { host } }), `${host} ${url}`);
      }
    }
    /* com o Host certo, tudo ok (maiúsculas valem: o Host não diferencia) */
    for (const host of [HOST, `127.0.0.1:${PORT}`, `[::1]:${PORT}`, `LocalHost:${PORT}`]) {
      expect((await app.inject({ url: '/api/info', headers: { host } })).statusCode, host).toBe(200);
    }
  });

  it('porta 80: o navegador omite a porta, então Host sem porta vale (e só aí)', async () => {
    const { app } = await local({ port: 80 });
    expect((await app.inject({ url: '/api/info', headers: { host: 'localhost' } })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/info', headers: { host: 'localhost:80' } })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/info', headers: { host: 'evil.com' } })).statusCode).toBe(403);
    const ok = await app.inject({ method: 'POST', url: '/api/cars', headers: { host: 'localhost', origin: 'http://localhost' }, payload: { name: 'C' } });
    expect(ok.statusCode).toBe(201);
    forbidden(await app.inject({ method: 'POST', url: '/api/cars', headers: { host: 'localhost', origin: 'http://localhost:8090' }, payload: { name: 'C' } }), 'porta errada');
  });
});

describe('ataque: CSRF de outro site', () => {
  const BAD_ORIGINS = [
    'null', 'http://evil.com', `http://evil.com:${PORT}`, 'http://localhost:5173', `https://localhost:${PORT}`,
    `http://localhost:${PORT}.evil.com`, 'http://localhost', `http://localhost:${PORT}/`, `http://foo.localhost:${PORT}`,
    `http://localhost.:${PORT}`, `file://`, `http://localhost:${PORT} http://evil.com`, '',
  ];

  it('POST/PUT/PATCH/DELETE com Origin de fora → 403 e nada muda', async () => {
    const { app } = await local();
    const car = json(await req(app, { method: 'POST', url: '/api/cars', headers: { origin: ORIGIN }, payload: { name: 'Carro', params: {} } }));
    const mp = multipart({}, { name: 'ft_log3_gps.csv', data: fixture('ft_log3_gps.csv') });
    const s = json(await req(app, { method: 'POST', url: '/api/sessions', headers: { ...mp.headers, origin: ORIGIN }, payload: mp.payload }));
    const c = json(await req(app, { method: 'POST', url: `/api/sessions/${s.id}/comments`, headers: { origin: ORIGIN }, payload: { text: 'a' } }));
    const calls: [string, string, object?][] = [
      ['POST', '/api/cars', { name: 'X' }], ['PUT', `/api/cars/${car.id}`, { name: 'Y' }], ['DELETE', `/api/cars/${car.id}`],
      ['POST', '/api/tracks', { name: 'X' }], ['PATCH', `/api/sessions/${s.id}`, { driver: 'Eve' }],
      ['POST', `/api/sessions/${s.id}/summary`], ['POST', `/api/sessions/${s.id}/comments`, { text: 'x' }],
      ['DELETE', `/api/comments/${c.id}`], ['DELETE', `/api/sessions/${s.id}`], ['OPTIONS', '/api/sessions'],
    ];
    for (const origin of BAD_ORIGINS) {
      for (const [method, url, payload] of calls) {
        forbidden(await req(app, { method: method as 'POST', url, headers: { origin }, ...(payload ? { payload } : {}) }), `${origin} ${method} ${url}`);
      }
    }
    /* nada mudou */
    expect(json(await req(app, { url: `/api/cars/${car.id}` })).name).toBe('Carro');
    expect(json(await req(app, { url: '/api/cars' }))).toHaveLength(1);
    expect(json(await req(app, { url: '/api/tracks' }))).toHaveLength(0);
    expect(json(await req(app, { url: `/api/sessions/${s.id}` })).driver ?? null).toBeNull();
    expect(json(await req(app, { url: `/api/sessions/${s.id}/comments` }))).toHaveLength(1);
  });

  it('multipart/form-data "simples" de outro site (formulário escondido) → 403 antes de ler o corpo', async () => {
    const { app, dir } = await local();
    const mp = multipart({ meta: '{}' }, { name: 'ft_log3_gps.csv', data: fixture('ft_log3_gps.csv') });
    /* o navegador manda Origin num POST de outro site; e Sec-Fetch-Site: cross-site */
    forbidden(await req(app, { method: 'POST', url: '/api/sessions', headers: { ...mp.headers, origin: 'https://evil.com', 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate' }, payload: mp.payload }), 'form');
    /* text/plain com JSON dentro (outro truque de formulário) */
    forbidden(await req(app, { method: 'POST', url: '/api/cars', headers: { 'content-type': 'text/plain', origin: 'https://evil.com' }, payload: '{"name":"x"}' }), 'text/plain');
    expect(fs.existsSync(path.join(dir, 'sessions')) ? fs.readdirSync(path.join(dir, 'sessions')) : []).toEqual([]);
  });

  it('Sec-Fetch-Site de outro site sem Origin (GET por <img>/<script>/fetch no-cors) → 403 na API', async () => {
    const { app } = await local();
    for (const site of ['cross-site', 'same-site']) {
      for (const mode of ['no-cors', 'cors', 'navigate']) {
        for (const url of ['/api/sessions', '/api/info', '/api/health', '/api/cars']) {
          forbidden(await req(app, { url, headers: { 'sec-fetch-site': site, 'sec-fetch-mode': mode } }), `${site} ${mode} ${url}`);
        }
      }
      /* e um POST que viesse sem Origin, mas dizendo que é de outro site */
      forbidden(await req(app, { method: 'POST', url: '/api/cars', headers: { 'sec-fetch-site': site, 'sec-fetch-mode': 'no-cors' }, payload: { name: 'x' } }), `${site} POST`);
      /* arquivo do app carregado por outro site (<script src>) também não */
      forbidden(await req(app, { url: '/assets/app.js', headers: { 'sec-fetch-site': site, 'sec-fetch-mode': 'no-cors', 'sec-fetch-dest': 'script' } }), `${site} script`);
    }
    expect(json(await req(app, { url: '/api/cars' }))).toHaveLength(0);
    /* o próprio app (same-origin) e o endereço digitado/atalho (none) funcionam */
    for (const site of ['same-origin', 'none']) {
      expect((await req(app, { url: '/api/info', headers: { 'sec-fetch-site': site, 'sec-fetch-mode': 'cors' } })).statusCode, site).toBe(200);
    }
    const ok = await req(app, { method: 'POST', url: '/api/cars', headers: { origin: ORIGIN, 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors' }, payload: { name: 'ok' } });
    expect(ok.statusCode).toBe(201);
    /* abrir o app por um link de outro site (navegação) continua podendo: só a página, nunca a API */
    const nav = { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' };
    expect((await req(app, { url: '/', headers: nav })).statusCode).toBe(200);
    forbidden(await req(app, { url: '/api/sessions', headers: nav }), 'navegação para a API');
  });

  it('Referer de outro site sem Origin não abre nada que o Origin não abriria (GET só lê; resposta não sai do navegador)', async () => {
    const { app } = await local();
    /* GET sem Origin nem Sec-Fetch (programa local, navegador antigo) continua ok: só leitura */
    expect((await req(app, { url: '/api/sessions', headers: { referer: 'https://evil.com/' } })).statusCode).toBe(200);
    /* sem cabeçalhos CORS: o navegador não deixa outro site ler a resposta */
    const r = await req(app, { url: '/api/info', headers: { referer: 'https://evil.com/' } });
    expect(r.headers['access-control-allow-origin']).toBeUndefined();
    expect(r.headers['x-frame-options']).toBe('DENY');
  });
});

describe('ataque: X-Forwarded-* e TRUST_PROXY ligado junto com LOCAL_MODE', () => {
  it('X-Forwarded-For 127.0.0.1 vindo da rede → 403; X-Forwarded-Host não substitui o Host', async () => {
    const { app } = await local({ trustProxy: 1 });
    expect(app.cfg.trustProxy).toBe(false);
    for (const remoteAddress of ['192.168.0.10', '10.0.0.2', '172.16.0.9', '8.8.8.8']) {
      forbidden(await req(app, { url: '/api/sessions', remoteAddress, headers: { 'x-forwarded-for': '127.0.0.1', 'x-real-ip': '127.0.0.1', forwarded: 'for=127.0.0.1' } }), remoteAddress);
    }
    forbidden(await app.inject({ url: '/api/sessions', headers: { host: 'evil.com', 'x-forwarded-host': HOST } }), 'x-forwarded-host');
    /* TRUST_PROXY pelo ambiente também é desligado */
    const env = loadConfig({ LOCAL_MODE: '1', TRUST_PROXY: 'true' });
    const t = await local({ trustProxy: env.trustProxy });
    expect(t.app.cfg.trustProxy).toBe(false);
    forbidden(await req(t.app, { url: '/api/info', remoteAddress: '192.168.0.10', headers: { 'x-forwarded-for': '127.0.0.1' } }), 'env');
  });
});

describe('ataque: escutar na rede por engano', () => {
  it('HOST de rede (0.0.0.0, ::, ::1, IP da LAN, nomes) → não sobe e não cria a pasta', async () => {
    for (const h of ['0.0.0.0', ' 0.0.0.0 ', '::', '[::]', '::1', '[::1]', '::ffff:127.0.0.1', '192.168.0.5', '10.0.0.1', 'meupc', 'localhost.', '127.0.0.2', '127.1']) {
      expect(() => localHost(h), h).toThrow(/exposto na rede/);
    }
    expect(localHost('LOCALHOST')).toBe('127.0.0.1');
    const dir = path.join(tmp(), 'dados-nao-criados');
    for (const host of ['0.0.0.0', '::']) {
      await expect(boot(dir, { host })).rejects.toThrow(/exposto na rede/);
      expect(fs.existsSync(dir), host).toBe(false);
    }
  });

  it('servidor de verdade: escuta só em 127.0.0.1; IP da rede e ::1 recusam a conexão', async () => {
    const port = await freePort();
    const app = await boot(tmp(), { port });
    apps.push(app);
    await app.listen({ port: app.cfg.port, host: app.cfg.host });
    const addrs = app.addresses();
    expect(addrs.map(a => a.address)).toEqual(['127.0.0.1']);
    const lan = Object.values(os.networkInterfaces()).flat().find(i => i && i.family === 'IPv4' && !i.internal)?.address;
    /* no Windows a conexão recusada demora ~2 s (o sistema tenta o SYN de novo): espera até 8 s */
    for (const target of [lan, '::1'].filter(Boolean) as string[]) {
      await expect(rawHttp(port, `GET /api/info HTTP/1.1\r\nHost: ${HOST}\r\nConnection: close\r\n\r\n`, target, 8000), target)
        .rejects.toThrow(/ECONNREFUSED|EADDRNOTAVAIL|ENETUNREACH|EHOSTUNREACH/);
    }
  }, 30_000);
});

describe('ataque: rotas de contas por caminhos tortos', () => {
  it('nenhum caminho cria conta, entra ou devolve token', async () => {
    const { app } = await local();
    const body = { name: 'Eve', email: 'eve@evil.com', password: 'senha-boa-123', code: 'X', oldPassword: 'a', newPassword: 'senha-boa-123', role: 'admin' };
    const paths = [
      '/api/auth/setup', '/api/auth/login', '/api/auth/register', '/api/auth/password',
      '/api//auth/setup', '/api//auth/login', '//api/auth/setup', '/API/auth/setup', '/api/AUTH/login', '/api/auth/Setup',
      '/api/auth/setup/', '/api/auth/login/', '/api/auth/%73etup', '/api/auth/%6Cogin', '/api/%61uth/setup', '/api%2Fauth%2Fsetup',
      '/api/./auth/setup', '/api/auth/../auth/setup', '/api/x/../auth/setup', '/api/auth/setup?x=1', '/api/auth/setup#x',
      '/api/auth/setup;x', '/api/auth/setup%00', '/api/auth/setup%20', '/api/users', '/api/users/', '/api//users', '/api/Users',
      '/api/%75sers', '/api/invites', '/api/invites/', '/api/%69nvites',
    ];
    for (const url of paths) {
      for (const method of ['POST', 'PUT', 'PATCH', 'GET', 'HEAD']) {
        const r = await req(app, { method: method as 'POST', url, ...(method === 'GET' || method === 'HEAD' ? {} : { payload: body }) });
        expect(r.statusCode, `${method} ${url}`).toBeGreaterThanOrEqual(400);
        expect(r.body, `${method} ${url}`).not.toMatch(/token|tempPassword|"code"/);
      }
    }
    for (const [method, url] of [['PATCH', '/api/users/x'], ['DELETE', '/api/users/x'], ['DELETE', '/api/invites/ABC'], ['HEAD', '/api/users'], ['HEAD', '/api/invites']]) {
      const r = await req(app, { method: method as 'PATCH', url, ...(method === 'PATCH' ? { payload: { role: 'viewer' } } : {}) });
      expect(r.statusCode, `${method} ${url}`).toBe(404);
      if (method !== 'HEAD') expect(json(r).error).toBe(LOCAL_NO_ACCOUNTS);
    }
    /* pelo padrão da rota: as de hoje e as que vierem (ex.: /users/:id/senha) já nascem fechadas */
    for (const r of ['/api/auth/setup', '/api/auth/login', '/api/auth/register', '/api/auth/password', '/api/auth/logout',
      '/api/users', '/api/users/:id', '/api/users/:id/password', '/api/invites', '/api/invites/:code']) {
      expect(isAccountRoute(r), r).toBe(true);
    }
    for (const r of [undefined, '', '/api/auth/me', '/api/auth', '/api/usersx', '/api/sessions', '/api/info', '/*', '/']) {
      expect(isAccountRoute(r), String(r)).toBe(false);
    }
    /* só o usuário local existe; nada de convite */
    expect((app.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n).toBe(1);
    expect((app.db.prepare('SELECT COUNT(*) AS n FROM invites').get() as { n: number }).n).toBe(0);
  });
});

describe('ataque: pasta do modo local reaproveitada no modo equipe', () => {
  it('o usuário local não vira conta com senha conhecida; tokens do modo local não existem', async () => {
    const dir = tmp();
    let app = await boot(dir);
    const me = json(await req(app, { url: '/api/info' })).user;
    expect(me.email).toBe(LOCAL_EMAIL);
    await app.close();

    /* modo equipe na mesma pasta (o atalho sem LOCAL_MODE, por exemplo) */
    app = await buildApp({ dataDir: dir, jwtSecret: SECRET, corsOrigins: [], webDist: path.join(dir, 'sem-web'), recalcOnStart: false });
    apps.push(app);
    expect(json(await app.inject('/api/info'))).toEqual(expect.objectContaining({ needsSetup: false }));
    expect(json(await app.inject('/api/info')).dataDir).toBeUndefined();
    /* ninguém configura um admin novo por cima, nem entra com senhas óbvias */
    expect((await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { name: 'Eve', email: 'eve@evil.com', password: PASSWORD } })).statusCode).toBe(409);
    for (const pw of ['', ' ', 'local', 'admin', 'senha', 'password', '12345678', LOCAL_EMAIL, me.name, me.id, PASSWORD, SECRET]) {
      if (!pw.trim()) continue;
      expect((await login(app, LOCAL_EMAIL, pw)).statusCode, pw).toBe(401);
    }
    /* sem token, nada */
    expect((await app.inject({ url: '/api/sessions' })).statusCode).toBe(401);
  });

  it('local@este.computador que já existia com senha conhecida: ao virar admin no modo local, a senha velha deixa de valer', async () => {
    /* pasta do modo equipe onde alguém se cadastrou como local@este.computador (leitor, senha
     * conhecida) e, por algum motivo, não sobrou admin ativo */
    const dir = tmp();
    let app = await buildApp({ dataDir: dir, jwtSecret: SECRET, corsOrigins: [], webDist: path.join(dir, 'sem-web'), recalcOnStart: false });
    const tm = await makeTeam(app);
    const eve = await userWithRole(app, tm.admin, 'viewer', LOCAL_EMAIL);
    app.db.prepare("UPDATE users SET disabled = 1 WHERE role = 'admin'").run();
    await app.close();

    /* modo local promove local@este.computador a admin */
    app = await boot(dir);
    expect(json(await req(app, { url: '/api/info' })).user).toMatchObject({ id: eve.user.id, role: 'admin' });
    await app.close();

    /* de volta ao modo equipe: a senha e o token antigos não podem dar admin a quem conhecia */
    app = await buildApp({ dataDir: dir, jwtSecret: SECRET, corsOrigins: [], webDist: path.join(dir, 'sem-web'), recalcOnStart: false });
    apps.push(app);
    expect((await login(app, LOCAL_EMAIL, PASSWORD)).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/users', headers: auth(eve.token) })).statusCode).toBe(401);
  });
});

describe('ataque: vazamento do dataDir', () => {
  it('modo equipe nunca devolve dataDir nem localMode; modo local só para o próprio computador', async () => {
    const t = await makeApp({ recalcOnStart: false });
    opened.push(t);
    for (const host of ['localhost:8080', HOST, 'evil.com']) {
      const body = (await t.app.inject({ url: '/api/info', headers: { host } })).body;
      expect(body).not.toContain('dataDir');
      expect(body).not.toContain('localMode');
      expect(body).not.toContain(t.dir.replace(/\\/g, '\\\\'));
    }
    const { app, dir } = await local();
    const esc = dir.replace(/\\/g, '\\\\');
    for (const r of [
      await app.inject({ url: '/api/info', headers: { host: 'evil.com' } }),
      await req(app, { url: '/api/info', headers: { origin: 'http://evil.com' } }),
      await req(app, { url: '/api/info', remoteAddress: '192.168.0.10' }),
      await req(app, { url: '/api/info', headers: { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'cors' } }),
    ]) {
      expect(r.statusCode).toBe(403);
      expect(r.body).not.toContain(esc);
    }
    /* erros comuns não mostram a pasta */
    for (const r of [
      await req(app, { url: '/api/sessions/nao-existe/file' }),
      await req(app, { url: '/api/nada' }),
      await req(app, { method: 'POST', url: '/api/cars', headers: { 'content-type': 'application/json' }, payload: '{' }),
    ]) {
      expect(r.body).not.toContain(esc);
      expect(r.body).not.toContain(os.userInfo().username + '\\');
    }
  });
});

describe('ataque: páginas do app (build de verdade) com Host estranho', () => {
  it('index.html, assets e o fallback da SPA → 403 para Host/Origin de fora; 200 para o app', async () => {
    const web = tmp();
    fs.mkdirSync(path.join(web, 'assets'));
    fs.writeFileSync(path.join(web, 'index.html'), '<!doctype html><title>app</title>');
    fs.writeFileSync(path.join(web, 'assets', 'app.js'), 'console.log(1)');
    const { app } = await local({ webDist: web });
    for (const url of ['/', '/index.html', '/assets/app.js', '/sessao/abc', '/qualquer']) {
      forbidden(await app.inject({ url, headers: { host: 'evil.com' } }), `GET ${url}`);
      forbidden(await app.inject({ url, headers: { host: HOST, origin: 'http://evil.com' } }), `Origin ${url}`);
      for (const host of ['evil.com', `evil.com:${PORT}`]) {
        expect((await app.inject({ method: 'HEAD', url, headers: { host } })).statusCode, `HEAD ${url}`).toBe(403);
      }
      const ok = await req(app, { url });
      expect(ok.statusCode, url).toBe(200);
      expect(ok.headers['x-frame-options']).toBe('DENY');
    }
  });
});

describe('ataque: Upgrade (WebSocket/h2c) num socket de verdade', () => {
  it('Upgrade com Host de fora → 403, nunca 101; com o Host certo também não vira 101', async () => {
    const port = await freePort();
    const app = await boot(tmp(), { port });
    apps.push(app);
    await app.listen({ port: app.cfg.port, host: app.cfg.host });
    const ws = (host: string, origin?: string) =>
      `GET /api/sessions HTTP/1.1\r\nHost: ${host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
      `Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n${origin ? `Origin: ${origin}\r\n` : ''}\r\n`;
    for (const [host, origin] of [['evil.com', 'http://evil.com'], [`evil.com:${port}`, undefined], [`localhost:${port}`, 'http://evil.com']] as const) {
      const out = await rawHttp(port, ws(host, origin)).catch(e => String(e));
      expect(out, host).not.toMatch(/^HTTP\/1\.1 101/);
      expect(out === '' || /^HTTP\/1\.1 403/.test(out), `${host}: ${out.slice(0, 40)}`).toBe(true);
    }
    const h2c = `GET / HTTP/1.1\r\nHost: evil.com\r\nUpgrade: h2c\r\nConnection: Upgrade, HTTP2-Settings\r\nHTTP2-Settings: AAMAAABkAAQAAP__\r\n\r\n`;
    const out = await rawHttp(port, h2c).catch(e => String(e));
    expect(out).not.toMatch(/^HTTP\/1\.1 101/);
    expect(out === '' || /^HTTP\/1\.1 403/.test(out)).toBe(true);
    const good = await rawHttp(port, ws(`localhost:${port}`)).catch(e => String(e));
    expect(good).not.toMatch(/^HTTP\/1\.1 101/);
  });

  it('pedido de verdade pelo socket: Host certo → 200; Host de fora → 403', async () => {
    const port = await freePort();
    const app = await boot(tmp(), { port });
    apps.push(app);
    await app.listen({ port: app.cfg.port, host: app.cfg.host });
    expect(await rawHttp(port, `GET /api/health HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`)).toMatch(/^HTTP\/1\.1 200/);
    expect(await rawHttp(port, `GET /api/health HTTP/1.1\r\nHost: rebind.evil.com:${port}\r\nConnection: close\r\n\r\n`)).toMatch(/^HTTP\/1\.1 403/);
    expect(await rawHttp(port, `GET /api/health HTTP/1.0\r\n\r\n`)).toMatch(/^HTTP\/1\.[01] 403/);
    /* URL absoluta (forma de proxy) não troca o Host conferido */
    expect(await rawHttp(port, `GET http://localhost:${port}/api/health HTTP/1.1\r\nHost: evil.com\r\nConnection: close\r\n\r\n`)).toMatch(/^HTTP\/1\.1 (403|400)/);
  });
});

/* ------------------------------------------------------------------ apoio */
async function freePort(): Promise<number> {
  const s = net.createServer();
  await new Promise<void>(r => s.listen(0, '127.0.0.1', r));
  const p = (s.address() as net.AddressInfo).port;
  await new Promise(r => s.close(r));
  return p;
}

/** Manda texto cru num socket e devolve o que voltou (até fechar ou `ms`). Conexão que não
 *  abre (recusada) → erro; que abre e fica muda até o fim do tempo → ''. */
function rawHttp(port: number, text: string, host = '127.0.0.1', ms = 1500): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ port, host });
    let out = '';
    let done = false;
    const finish = () => { if (!done) { done = true; clearTimeout(timer); sock.destroy(); resolve(out); } };
    const timer = setTimeout(finish, ms);
    sock.setEncoding('latin1');
    sock.on('connect', () => sock.write(text));
    sock.on('data', d => { out += d; });
    sock.on('end', finish);
    sock.on('close', finish);
    sock.on('error', e => { if (!done) { done = true; clearTimeout(timer); reject(e); } });
  });
}
