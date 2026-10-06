/* App web servido em / (com fallback de SPA para o index.html), página de aviso sem o build,
 * CORS só para as origens configuradas, configuração pelo ambiente e utilitários. */
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { json, makeApp, tmpDir, type TestApp } from './helpers';
import { isLocalAddress, loadConfig, parseTrustProxy, SERVER_ROOT, trustProxyOption } from '../src/config';
import { guessDate } from '../src/analysis';
import { acceptsGzip } from '../src/routes/sessions';

let t: TestApp | null = null;
const dirs: string[] = [];
afterEach(async () => {
  await t?.close(); t = null;
  dirs.splice(0).forEach(d => fs.rmSync(d, { recursive: true, force: true }));
});

function fakeDist(): string {
  const d = tmpDir('baja-web-');
  dirs.push(d);
  fs.mkdirSync(path.join(d, 'assets'));
  fs.writeFileSync(path.join(d, 'index.html'), '<!doctype html><title>Baja</title><div id="root"></div>');
  fs.writeFileSync(path.join(d, 'assets', 'app-123.js'), 'console.log(1)');
  return d;
}

describe('app web', () => {
  it('serve o build em /, os assets com cache longo e cai no index.html nas outras rotas', async () => {
    t = await makeApp({ webDist: fakeDist() });
    const { app } = t;
    let r = await app.inject('/');
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toMatch(/text\/html/);
    expect(r.body).toContain('<div id="root">');
    expect(r.headers['cache-control']).toBe('no-cache');
    expect(r.headers['x-frame-options']).toBe('DENY');
    r = await app.inject('/assets/app-123.js');
    expect(r.statusCode).toBe(200);
    expect(r.body).toBe('console.log(1)');
    expect(r.headers['cache-control']).toMatch(/immutable/);
    r = await app.inject('/sessao/qualquer');
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('<div id="root">');
    r = await app.inject('/assets/nao-existe.js');
    expect(r.statusCode).toBe(404);
    r = await app.inject('/api/nao-existe');
    expect(r.statusCode).toBe(404);
    expect(json(r).error).toMatch(/Rota não encontrada/);
    expect(json(await app.inject('/api/info')).name).toBe('Baja Telemetria');
  });

  it('sem o build: / responde uma página dizendo para rodar npm run build', async () => {
    const parent = tmpDir();
    dirs.push(parent);
    t = await makeApp({ webDist: path.join(parent, 'nao-existe') });
    const r = await t.app.inject('/');
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toMatch(/text\/html/);
    expect(r.body).toContain('npm run build');
    expect((await t.app.inject('/api/health')).statusCode).toBe(200);
  });
});

describe('CORS', () => {
  const pre = (app: TestApp['app'], origin: string) => app.inject({
    method: 'OPTIONS', url: '/api/sessions',
    headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type' },
  });

  it('só as origens de CORS_ORIGINS', async () => {
    t = await makeApp({ corsOrigins: ['https://equipe.github.io', 'http://localhost:5173'] });
    let r = await pre(t.app, 'https://equipe.github.io');
    expect(r.statusCode).toBe(204);
    expect(r.headers['access-control-allow-origin']).toBe('https://equipe.github.io');
    expect(String(r.headers['access-control-allow-headers'])).toMatch(/Authorization/i);
    expect(String(r.headers['access-control-allow-methods'])).toMatch(/PATCH/);
    r = await t.app.inject({ url: '/api/info', headers: { origin: 'http://localhost:5173' } });
    expect(r.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(String(r.headers['access-control-expose-headers'])).toMatch(/Content-Disposition/);
    r = await t.app.inject({ url: '/api/info', headers: { origin: 'https://malicioso.example' } });
    expect(r.headers['access-control-allow-origin']).toBeUndefined();
    r = await pre(t.app, 'https://malicioso.example');
    expect(r.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('CORS_ORIGINS vazio: nenhuma origem de fora', async () => {
    t = await makeApp({ corsOrigins: [] });
    const r = await t.app.inject({ url: '/api/info', headers: { origin: 'https://equipe.github.io' } });
    expect(r.statusCode).toBe(200);
    expect(r.headers['access-control-allow-origin']).toBeUndefined();
    const p = await pre(t.app, 'https://equipe.github.io');
    expect(p.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('configuração e utilitários', () => {
  it('loadConfig: padrões e variáveis', () => {
    const d = loadConfig({});
    expect(d).toMatchObject({
      port: 8080, host: '0.0.0.0', corsOrigins: [], maxUploadMb: 100, trustProxy: false, jwtSecret: undefined,
      analysisMemoryMb: 1536, analysisTimeoutS: 300,
    });
    expect(d.dataDir).toBe(path.resolve('./data'));
    expect(d.webDist).toBe(path.resolve(SERVER_ROOT, '../web/dist'));
    const c = loadConfig({
      PORT: '9000', DATA_DIR: '/tmp/x', CORS_ORIGINS: 'https://a.io/, http://b:5173 ,', MAX_UPLOAD_MB: '5', JWT_SECRET: 's',
      WEB_DIST: './w', TRUST_PROXY: 'true', ANALYSIS_MEMORY_MB: '512', ANALYSIS_TIMEOUT_S: '60',
    });
    expect(c).toMatchObject({
      port: 9000, corsOrigins: ['https://a.io', 'http://b:5173'], maxUploadMb: 5, jwtSecret: 's', trustProxy: 1,
      analysisMemoryMb: 512, analysisTimeoutS: 60,
    });
    expect(c.dataDir).toBe(path.resolve('/tmp/x'));
    expect(c.webDist).toBe(path.resolve('./w'));
    expect(loadConfig({ PORT: 'abc', MAX_UPLOAD_MB: '-1' })).toMatchObject({ port: 8080, maxUploadMb: 100 });
  });

  it('TRUST_PROXY: nunca "confiar em tudo"; o proxy da frente só vale se vier de rede local', () => {
    expect(['', 'false', 'não', '0'].map(parseTrustProxy)).toEqual([false, false, false, false]);
    expect(['true', 'SIM', 'yes'].map(parseTrustProxy)).toEqual([1, 1, 1]);
    expect(parseTrustProxy('2')).toBe(2);
    expect(parseTrustProxy('127.0.0.1, 10.0.0.0/8')).toBe('127.0.0.1, 10.0.0.0/8');
    expect(trustProxyOption(false)).toBe(false);
    expect(trustProxyOption('loopback')).toBe('loopback');
    const one = trustProxyOption(true) as (a: string, i: number) => boolean;
    expect([one('127.0.0.1', 0), one('::ffff:172.18.0.3', 0), one('fdaa::1', 0), one('100.64.1.2', 0)]).toEqual([true, true, true, true]);
    expect([one('203.0.113.5', 0), one('10.0.0.1', 1)]).toEqual([false, false]);
    const two = trustProxyOption(2) as (a: string, i: number) => boolean;
    expect([two('10.0.0.1', 0), two('198.51.100.1', 1), two('198.51.100.2', 2)]).toEqual([true, true, false]);
    expect(['192.168.1.10', '8.8.8.8', 'lixo', ''].map(isLocalAddress)).toEqual([true, false, false, false]);
  });

  it('segredo do JWT gerado em DATA_DIR/secret e reaproveitado', async () => {
    const dir = tmpDir();
    dirs.push(dir);
    t = await makeApp({ dataDir: dir, jwtSecret: undefined });
    const s1 = fs.readFileSync(path.join(dir, 'secret'), 'utf8').trim();
    expect(s1.length).toBeGreaterThanOrEqual(32);
    await t.app.close();
    t = await makeApp({ dataDir: dir, jwtSecret: undefined });
    expect(fs.readFileSync(path.join(dir, 'secret'), 'utf8').trim()).toBe(s1);
  });

  it('guessDate', () => {
    const ft = { kind: 'FT' as const };
    expect(guessDate('Log 3_20261005-1644.csv', '', ft)).toBe('2026-10-05T16:44');
    expect(guessDate('C:\\logs\\Log 12_20250131-0905.csv', '', ft)).toBe('2025-01-31T09:05');
    expect(guessDate('teste 2026-03-02.csv', '', ft)).toBe('2026-03-02');
    expect(guessDate('Log 3.csv', '', ft)).toBeNull();
    expect(guessDate('Log_20261399-9999.csv', '', ft)).toBeNull();
    const bm = { kind: 'BUSMASTER' as const, clock0: '16:34:36' };
    expect(guessDate('x.log', '***START DATE AND TIME 5:10:2026 16:34:30:698***', bm)).toBe('2026-10-05T16:34');
    expect(guessDate('x.log', 'sem cabeçalho', bm, new Date(2026, 9, 6, 12))).toBe('2026-10-06T16:34');
  });

  it('acceptsGzip', () => {
    expect(acceptsGzip('gzip, deflate, br')).toBe(true);
    expect(acceptsGzip('br;q=1.0, gzip;q=0.8')).toBe(true);
    expect(acceptsGzip('*')).toBe(true);
    expect(acceptsGzip('gzip;q=0')).toBe(false);
    expect(acceptsGzip('identity')).toBe(false);
    expect(acceptsGzip(undefined)).toBe(false);
  });
});
