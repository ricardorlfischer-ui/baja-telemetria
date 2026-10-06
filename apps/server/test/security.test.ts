/* Revisão de segurança e correção: cada teste aqui prova um problema achado na revisão (falhava
 * antes da correção) e trava a correção.
 *   - TRUST_PROXY=true confiava em todos os saltos do X-Forwarded-For: limite de login contornável
 *   - JWT_SECRET curto ou o exemplo do docker-compose aceitos (tokens forjáveis)
 *   - token sem exp/iat aceito (nunca expirava)
 *   - troca de senha sem limite de tentativas (força bruta da senha atual com um token roubado)
 *   - dois POST /users com o mesmo e-mail ao mesmo tempo: 500
 *   - membro editando carro/pista de outro (ARQUITETURA 5.3: member edita o que é seu)
 *   - Content-Disposition com ' ( ) * sem codificar no filename* (RFC 5987)
 *   - corrida: PATCH × PATCH e envio × PUT do perfil deixavam um resumo de outro carro/pista
 *   - summaryError com o caminho do servidor (ENOENT ...)
 *   - análise de log grande travava o servidor inteiro (laço de eventos parado por segundos) */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { computeSession, parseLog, sessionSummary } from '@baja/core';
import { auth, fixture, json, login, makeApp, makeTeam, PASSWORD, setupAdmin, tmpDir, upload, type Team, type TestApp } from './helpers';

const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres!!';
const craftJwt = (payload: Record<string, unknown>, secret = SECRET): string => {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = b64({ alg: 'HS256', typ: 'JWT' }), body = b64(payload);
  return `${head}.${body}.${crypto.createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url')}`;
};

/* portão manual: segura uma chamada até o teste liberar */
function gate() {
  let open!: () => void, called!: () => void;
  const opened = new Promise<void>(r => { open = r; });
  const reached = new Promise<void>(r => { called = r; });
  return { opened, reached, open, called };
}

/* resumo esperado (core direto, mesma montagem do servidor) */
function expected(file: string, track: Record<string, any> = {}, car: Record<string, any> = {}) {
  const { susp, ...carRest } = car;
  const S = parseLog(fixture(file).toString('utf8'), file);
  const hasLine = Array.isArray(track.line) && track.line.length >= 2;
  return JSON.parse(JSON.stringify(sessionSummary(computeSession(S,
    { ...track, line: hasLine ? track.line : null, car: carRest, ...(susp ? { susp } : {}) }, { autoLine: !hasLine }))));
}

let t: TestApp | null = null;
afterEach(async () => { await t?.close(); t = null; });

describe('limite de tentativas atrás de proxy', () => {
  it('TRUST_PROXY=true confia só no proxy da frente: X-Forwarded-For falsificado não contorna o limite', async () => {
    t = await makeApp({ trustProxy: true });
    await setupAdmin(t.app);
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) {
      /* o proxy (127.0.0.1) acrescenta o IP real no fim; o começo vem do atacante */
      const r = await t.app.inject({
        method: 'POST', url: '/api/auth/login', payload: { email: 'admin@equipe.br', password: 'errada' },
        remoteAddress: '127.0.0.1', headers: { 'x-forwarded-for': `10.66.0.${i}, 203.0.113.9` },
      });
      codes.push(r.statusCode);
    }
    expect(codes.slice(0, 10).every(c => c === 401)).toBe(true);
    expect(codes.slice(10)).toEqual([429, 429]);
    /* outro IP real (outro cliente atrás do mesmo proxy) continua entrando */
    const ok = await t.app.inject({
      method: 'POST', url: '/api/auth/login', payload: { email: 'admin@equipe.br', password: PASSWORD },
      remoteAddress: '127.0.0.1', headers: { 'x-forwarded-for': '203.0.113.10' },
    });
    expect(ok.statusCode).toBe(200);
  });

  it('TRUST_PROXY=true com o servidor exposto por engano: quem conecta da internet não escolhe o IP', async () => {
    t = await makeApp({ trustProxy: true });
    await setupAdmin(t.app);
    let last = 0;
    for (let i = 0; i < 11; i++) {
      last = (await t.app.inject({
        method: 'POST', url: '/api/auth/login', payload: { email: 'admin@equipe.br', password: 'errada' },
        remoteAddress: '203.0.113.77', headers: { 'x-forwarded-for': `10.2.2.${i}` },
      })).statusCode;
    }
    expect(last).toBe(429);
  });

  it('sem TRUST_PROXY o X-Forwarded-For é ignorado', async () => {
    t = await makeApp();
    await setupAdmin(t.app);
    let last = 0;
    for (let i = 0; i < 11; i++) {
      last = (await t.app.inject({
        method: 'POST', url: '/api/auth/login', payload: { email: 'admin@equipe.br', password: 'errada' },
        remoteAddress: '198.51.100.7', headers: { 'x-forwarded-for': `10.1.1.${i}` },
      })).statusCode;
    }
    expect(last).toBe(429);
  });
});

describe('segredo e tokens', () => {
  it('recusa JWT_SECRET curto ou o exemplo do docker-compose', async () => {
    for (const jwtSecret of ['curto', 'troque-por-um-texto-longo-e-aleatorio', 'x'.repeat(31)]) {
      let app: TestApp | null = null;
      await expect((async () => { app = await makeApp({ jwtSecret }); })()).rejects.toThrow(/JWT_SECRET/);
      await (app as TestApp | null)?.close();
    }
  });

  it('token sem exp (ou sem iat) não vale, mesmo com a assinatura certa', async () => {
    t = await makeApp();
    const admin = await setupAdmin(t.app);
    const now = Math.floor(Date.now() / 1000);
    const me = (tok: string) => t!.app.inject({ url: '/api/auth/me', headers: auth(tok) });
    expect((await me(craftJwt({ sub: admin.user.id, tv: 0, iat: now, exp: now + 60 }))).statusCode).toBe(200);
    expect((await me(craftJwt({ sub: admin.user.id, tv: 0, iat: now }))).statusCode).toBe(401);
    expect((await me(craftJwt({ sub: admin.user.id, tv: 0, exp: now + 60 }))).statusCode).toBe(401);
    /* iat de mais de 30 dias atrás, mesmo com exp longe: vencido */
    const old = await me(craftJwt({ sub: admin.user.id, tv: 0, iat: now - 31 * 86400, exp: now + 86400 }));
    expect(old.statusCode).toBe(401);
    expect(json(old).error).toBe('A sessão expirou: entre de novo');
  });

  it('troca de senha tem limite de tentativas (senha atual errada)', async () => {
    t = await makeApp();
    const admin = await setupAdmin(t.app);
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) {
      codes.push((await t.app.inject({
        method: 'POST', url: '/api/auth/password', headers: auth(admin.token), remoteAddress: '198.51.100.20',
        payload: { oldPassword: `chute-${i}`, newPassword: 'nova-senha-123' },
      })).statusCode);
    }
    expect(codes.slice(0, 10).every(c => c === 400)).toBe(true);
    expect(codes[10]).toBe(429);
  });
});

describe('usuários', () => {
  it('dois POST /users com o mesmo e-mail ao mesmo tempo: um 201 e um 409 (nunca 500)', async () => {
    t = await makeApp();
    const admin = await setupAdmin(t.app);
    const mk = () => t!.app.inject({ method: 'POST', url: '/api/users', headers: auth(admin.token), payload: { name: 'Dup', email: 'dup@equipe.br' } });
    const rs = await Promise.all([mk(), mk(), mk()]);
    expect(rs.map(r => r.statusCode).sort()).toEqual([201, 409, 409]);
    for (const r of rs.filter(x => x.statusCode === 409)) expect(json(r).error).toBe('Já existe uma conta com este e-mail');
  });
});

describe('sessões e perfis', () => {
  let s: TestApp, team: Team;
  beforeAll(async () => { s = await makeApp(); team = await makeTeam(s.app); });
  afterAll(async () => { await s.close(); });
  const req = (method: string, url: string, token: string, payload?: object) =>
    s.app.inject({ method: method as 'GET', url, headers: auth(token), ...(payload ? { payload } : {}) });

  it('membro não edita carro/pista de outro membro (só quem criou ou admin)', async () => {
    for (const route of ['cars', 'tracks']) {
      const p = json(await req('POST', `/api/${route}`, team.member, { name: 'Do membro', params: {} }));
      const r = await req('PUT', `/api/${route}/${p.id}`, team.member2, { name: 'Tomado', params: {} });
      expect(r.statusCode).toBe(403);
      expect(json(r).error).toMatch(/Só quem criou/);
      expect(json(await req('GET', `/api/${route}/${p.id}`, team.viewer)).name).toBe('Do membro');
      expect((await req('PUT', `/api/${route}/${p.id}`, team.member, { name: 'Dono muda' })).statusCode).toBe(200);
      expect((await req('PUT', `/api/${route}/${p.id}`, team.admin, { name: 'Admin muda' })).statusCode).toBe(200);
    }
  });

  it("Content-Disposition: filename* codifica ' ( ) * (RFC 5987) e o nome ASCII não quebra o cabeçalho", async () => {
    const name = "teste (1)'s*;x.csv";
    const r = await upload(s.app, team.member, name, fixture('ft_log3_gps.csv'), { allowDuplicate: true });
    expect(r.statusCode).toBe(201);
    const d = await req('GET', `/api/sessions/${json(r).id}/file`, team.viewer);
    expect(d.headers['content-disposition']).toBe(
      `attachment; filename="teste (1)'s*;x.csv"; filename*=UTF-8''teste%20%281%29%27s%2A%3Bx.csv`);
  });

  it('corrida PATCH × PATCH: o resumo final é o do carro final', async () => {
    const file = 'ft_log3_shocks_compact.csv';
    const carA = { strokeF: 40, strokeR: 40 }, carB = { strokeF: 90, strokeR: 95 };
    const A = json(await req('POST', '/api/cars', team.member, { name: 'A', params: carA }));
    const B = json(await req('POST', '/api/cars', team.member, { name: 'B', params: carB }));
    const id = json(await upload(s.app, team.member, file, fixture(file), { allowDuplicate: true })).id;
    /* segura a análise do carro A até o PATCH do carro B terminar (antes da correção: a leitura
     * do arquivo do recálculo A terminava depois e gravava o resumo de A com a sessão em B) */
    const g = gate();
    const an = s.app.analyzer, orig = an.run.bind(an);
    let first = true;
    an.run = async input => {
      if (first) { first = false; g.called(); await g.opened; }
      return orig(input);
    };
    try {
      const pA = req('PATCH', `/api/sessions/${id}`, team.member, { carId: A.id });
      await g.reached;                       /* o recálculo do carro A começou */
      const rB = await req('PATCH', `/api/sessions/${id}`, team.member, { carId: B.id });
      expect(json(rB).summary).toEqual(expected(file, {}, carB));
      g.open();
      expect((await pA).statusCode).toBe(200);
    } finally {
      an.run = orig;
    }
    await s.app.recalc.idle();
    const now = json(await req('GET', `/api/sessions/${id}`, team.viewer));
    expect(now.carId).toBe(B.id);
    expect(now.summary).toEqual(expected(file, {}, carB));
  });

  it('corrida envio × PUT do carro: o resumo acaba com os params novos', async () => {
    const file = 'ft_log3_shocks_compact.csv';
    const p1 = { strokeF: 45, strokeR: 45 }, p2 = { strokeF: 85, strokeR: 70, mass: 290 };
    const car = json(await req('POST', '/api/cars', team.member, { name: 'Corrida', params: p1 }));
    /* o PUT chega enquanto o envio está na análise (com p1); a sessão ainda não existe, então o
     * PUT não a põe na fila. Antes da correção o resumo ficava com p1 para sempre. */
    const g = gate();
    const an = s.app.analyzer, orig = an.run.bind(an);
    an.run = async input => { const r = await orig(input); g.called(); await g.opened; return r; };
    let id = '';
    try {
      const up = upload(s.app, team.member, file, fixture(file), { allowDuplicate: true, carId: car.id });
      await g.reached;                       /* resumo calculado com p1 */
      expect((await req('PUT', `/api/cars/${car.id}`, team.member, { name: 'Corrida', params: p2 })).statusCode).toBe(200);
      g.open();
      const r = await up;
      expect(r.statusCode).toBe(201);
      id = json(r).id;
    } finally {
      an.run = orig;
    }
    await s.app.recalc.idle();
    expect(json(await req('GET', `/api/sessions/${id}`, team.viewer)).summary).toEqual(expected(file, {}, p2));
  });

  it('arquivo sumido: summaryError em português, sem o caminho do servidor', async () => {
    const id = json(await upload(s.app, team.member, 'some.csv', fixture('ft_log3_gps.csv'), { allowDuplicate: true })).id;
    fs.rmSync(path.join(s.dir, 'sessions', `${id}.gz`));
    const r = await req('POST', `/api/sessions/${id}/summary`, team.member);
    expect(r.statusCode).toBe(200);
    const err = String(json(r).summaryError);
    expect(err).toBe('O arquivo do log desta sessão não está mais no servidor');
    expect(err).not.toContain(s.dir);
    expect(err).not.toMatch(/ENOENT/);
    expect((await req('GET', `/api/sessions/${id}/file`, team.viewer)).statusCode).toBe(404);
  });

  it('download em stream: HEAD só cabeçalhos; GET com e sem gzip igual ao enviado', async () => {
    const raw = fixture('busmaster_14.log');
    const id = json(await upload(s.app, team.member, 'head.log', raw, { allowDuplicate: true })).id;
    const h = await s.app.inject({ method: 'HEAD', url: `/api/sessions/${id}/file`, headers: { ...auth(team.viewer), 'accept-encoding': 'gzip' } });
    expect(h.statusCode).toBe(200);
    expect(h.headers['content-encoding']).toBe('gzip');
    expect(h.rawPayload.length).toBe(0);
    const g = await s.app.inject({ url: `/api/sessions/${id}/file`, headers: { ...auth(team.viewer), 'accept-encoding': 'gzip' } });
    expect(zlib.gunzipSync(g.rawPayload).equals(raw)).toBe(true);
    expect((await req('GET', `/api/sessions/${id}/file`, team.viewer)).rawPayload.equals(raw)).toBe(true);
  });
});

describe('superfície (conferido na revisão, sem problema; fica como regressão)', () => {
  it('app web não serve nada fora do build; JSON com __proto__ recusado; 500 sem detalhe interno', async () => {
    const parent = tmpDir('baja-dist-');
    const dist = path.join(parent, 'dist');
    try {
      fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });
      fs.writeFileSync(path.join(dist, 'index.html'), '<div id="root"></div>');
      fs.writeFileSync(path.join(parent, 'segredo.txt'), 'SEGREDO');
      t = await makeApp({ webDist: dist });
      for (const u of ['/../segredo.txt', '/..%2fsegredo.txt', '/%2e%2e/segredo.txt', '/assets/..%2f..%2fsegredo.txt', '/%2e%2e%5csegredo.txt', '/assets/%00.js']) {
        const r = await t.app.inject(u);
        expect(r.body).not.toContain('SEGREDO');
        expect(r.statusCode).toBeGreaterThanOrEqual(400);
      }
      const admin = await setupAdmin(t.app);
      for (const payload of ['{"name":"x","params":{"__proto__":{"admin":true}}}', '{"name":"x","params":{"constructor":{"prototype":{"a":1}}}}']) {
        const r = await t.app.inject({ method: 'POST', url: '/api/cars', headers: { ...auth(admin.token), 'content-type': 'application/json' }, payload });
        expect(r.statusCode).toBe(400);
      }
      expect(({} as Record<string, unknown>).admin).toBeUndefined();
      /* erro interno qualquer (ex.: disco): mensagem genérica, sem a do erro nem caminho */
      const db = t.app.db, orig = db.prepare.bind(db);
      (db as unknown as { prepare: (s: string) => unknown }).prepare = (sql: string) => {
        if (/FROM cars/.test(sql)) throw new Error('SQLITE_IOERR detalhe C:\\dados\\db.sqlite');
        return orig(sql);
      };
      const r = await t.app.inject({ url: '/api/cars', headers: auth(admin.token) });
      (db as unknown as { prepare: typeof orig }).prepare = orig;
      expect(r.statusCode).toBe(500);
      expect(json(r)).toEqual({ error: 'Erro interno no servidor' });
    } finally {
      await t?.close();
      t = null;
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });
});

describe('log grande', () => {
  /* log denso sintético (~8 MB, 11 canais, 100 Hz): a análise leva alguns segundos */
  function denseLog(mb: number): Buffer {
    const head = 'TIME,O2_General,Back_pressure,Shock_-_Front_Left,Shock_-_Front_Right,Shock_-_Rear_Left,Shock_-_Rear_Right,Shock_velocity_FL,Shock_velocity_FR,Shock_velocity_RL,Shock_velocity_RR\n';
    const parts: string[] = [head];
    let size = head.length;
    for (let i = 0; size < mb * 1e6; i++) {
      const sp = (k: number) => (50 + 20 * Math.sin(i / (30 + k))).toFixed(2), vl = (k: number) => (100 * Math.cos(i / (30 + k))).toFixed(1);
      const l = `${(i * 0.01).toFixed(3)},0.9,1.0,${sp(1)},${sp(2)},${sp(3)},${sp(4)},${vl(1)},${vl(2)},${vl(3)},${vl(4)}\n`;
      parts.push(l);
      size += l.length;
    }
    return Buffer.from(parts.join(''));
  }

  it('a análise não trava o servidor: outros pedidos seguem respondendo durante o envio', async () => {
    t = await makeApp();
    const team = await makeTeam(t.app);
    const raw = denseLog(8);
    let maxLag = 0, last = Date.now();
    const iv = setInterval(() => { const n = Date.now(); maxLag = Math.max(maxLag, n - last - 10); last = n; }, 10);
    let r;
    try {
      r = await upload(t.app, team.member, 'denso.csv', raw);
    } finally {
      clearInterval(iv);
    }
    expect(r.statusCode).toBe(201);
    expect(json(r).summary.metrics.length).toBeGreaterThan(10);
    expect(maxLag).toBeLessThan(1000);
    /* e o resumo é o mesmo do core rodando direto */
    const S = parseLog(raw.toString('utf8'), 'denso.csv');
    expect(json(r).summary).toEqual(JSON.parse(JSON.stringify(sessionSummary(computeSession(S, { line: null, car: {} }, { autoLine: true })))));
    expect((await login(t.app, 'membro@equipe.br')).statusCode).toBe(200);
  });
});
