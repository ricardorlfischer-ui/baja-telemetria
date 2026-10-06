/* Contas: setup → login → convite → cadastro, tokens inválidos/expirados/de versão antiga,
 * troca de senha, limite de tentativas do login, cabeçalhos de segurança e logs sem senha. */
import crypto from 'node:crypto';
import { Writable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { auth, json, login, makeApp, PASSWORD, setupAdmin, type TestApp } from './helpers';
import { hashPassword, verifyPassword } from '../src/auth';

const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres!!';

/* JWT HS256 montado à mão (para testar expirado e assinatura errada) */
function craftJwt(payload: Record<string, unknown>, secret = SECRET): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = b64({ alg: 'HS256', typ: 'JWT' }), body = b64(payload);
  const sig = crypto.createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

let t: TestApp | null = null;
afterEach(async () => { await t?.close(); t = null; });

describe('senhas', () => {
  it('scrypt com sal: hashes diferentes para a mesma senha, verificação certa', async () => {
    const a = await hashPassword('abcdefgh'), b = await hashPassword('abcdefgh');
    expect(a).not.toBe(b);
    expect(a.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('abcdefgh', a)).toBe(true);
    expect(await verifyPassword('abcdefgi', a)).toBe(false);
    expect(await verifyPassword('abcdefgh', 'lixo')).toBe(false);
  });
});

describe('fluxo setup → login → convite → cadastro', () => {
  it('funciona de ponta a ponta', async () => {
    t = await makeApp();
    const { app } = t;
    let r = await app.inject('/api/info');
    expect(json(r)).toEqual({ name: 'Baja Telemetria', version: expect.any(String), needsSetup: true });

    /* senha curta: mensagem em português */
    r = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { name: 'A', email: 'a@b.c', password: '123' } });
    expect(r.statusCode).toBe(400);
    expect(json(r).error).toBe('A senha precisa ter pelo menos 8 caracteres');
    r = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { name: 'A', email: 'sem-arroba', password: PASSWORD } });
    expect(r.statusCode).toBe(400);
    expect(json(r).error).toBe('E-mail inválido');
    r = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { email: 'a@b.c', password: PASSWORD } });
    expect(json(r).error).toBe('Falta o campo "nome"');

    const admin = await setupAdmin(app, 'Admin@Equipe.br');
    expect(admin.user).toMatchObject({ name: 'Admin', email: 'admin@equipe.br', role: 'admin', disabled: false });
    expect(admin.user.pass_hash).toBeUndefined();
    expect(json(await app.inject('/api/info')).needsSetup).toBe(false);

    /* setup só uma vez */
    r = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { name: 'B', email: 'b@b.c', password: PASSWORD } });
    expect(r.statusCode).toBe(409);
    expect(json(r).error).toMatch(/já foi configurado/);

    /* login (e-mail sem diferença de maiúsculas) */
    r = await login(app, 'ADMIN@equipe.br');
    expect(r.statusCode).toBe(200);
    const tok = json(r).token as string;
    r = await login(app, 'admin@equipe.br', 'senha-errada');
    expect(r.statusCode).toBe(401);
    expect(json(r).error).toBe('E-mail ou senha incorretos');
    r = await login(app, 'ninguem@equipe.br');
    expect(r.statusCode).toBe(401);
    expect(json(r).error).toBe('E-mail ou senha incorretos');

    r = await app.inject({ url: '/api/auth/me', headers: auth(tok) });
    expect(r.statusCode).toBe(200);
    expect(json(r).user.email).toBe('admin@equipe.br');

    /* convite de viewer → cadastro com o papel do convite */
    r = await app.inject({ method: 'POST', url: '/api/invites', headers: auth(tok), payload: { role: 'viewer', days: 2 } });
    expect(r.statusCode).toBe(201);
    const inv = json(r);
    expect(inv.code).toMatch(/^[A-Z0-9]{10}$/);
    expect(Date.parse(inv.expiresAt) - Date.now()).toBeGreaterThan(1.9 * 86_400_000);
    r = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { code: inv.code.toLowerCase(), name: 'Leitor', email: 'leitor@equipe.br', password: PASSWORD } });
    expect(r.statusCode).toBe(201);
    expect(json(r).user.role).toBe('viewer');
    expect((await app.inject({ url: '/api/auth/me', headers: auth(json(r).token) })).statusCode).toBe(200);

    /* convite de uso único */
    r = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { code: inv.code, name: 'Outro', email: 'outro@equipe.br', password: PASSWORD } });
    expect(r.statusCode).toBe(400);
    expect(json(r).error).toBe('Este convite já foi usado');
    r = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { code: 'NAOEXISTE1', name: 'Outro', email: 'outro@equipe.br', password: PASSWORD } });
    expect(json(r).error).toBe('Código de convite inválido');

    /* convite vencido */
    const inv2 = json(await app.inject({ method: 'POST', url: '/api/invites', headers: auth(tok), payload: { role: 'member' } }));
    expect(Math.round((Date.parse(inv2.expiresAt) - Date.now()) / 86_400_000)).toBe(7);
    app.db.prepare('UPDATE invites SET expires_at = ? WHERE code = ?').run(new Date(Date.now() - 1000).toISOString(), inv2.code);
    r = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { code: inv2.code, name: 'Outro', email: 'outro@equipe.br', password: PASSWORD } });
    expect(r.statusCode).toBe(400);
    expect(json(r).error).toMatch(/expirou/);

    /* e-mail repetido */
    const inv3 = json(await app.inject({ method: 'POST', url: '/api/invites', headers: auth(tok), payload: {} }));
    r = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { code: inv3.code, name: 'X', email: 'LEITOR@equipe.br', password: PASSWORD } });
    expect(r.statusCode).toBe(409);
    /* o convite continua valendo depois da falha */
    r = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { code: inv3.code, name: 'Membro', email: 'membro@equipe.br', password: PASSWORD } });
    expect(r.statusCode).toBe(201);
    expect(json(r).user.role).toBe('member');
  });
});

describe('tokens', () => {
  it('rejeita sem token, lixo, assinatura errada, expirado, versão antiga e usuário desativado', async () => {
    t = await makeApp();
    const { app } = t;
    const admin = await setupAdmin(app);
    const me = (h?: Record<string, string>) => app.inject({ url: '/api/auth/me', headers: h });

    let r = await me();
    expect(r.statusCode).toBe(401);
    expect(json(r).error).toMatch(/não está conectado/);
    r = await me({ authorization: 'Basic abc' });
    expect(r.statusCode).toBe(401);
    r = await me(auth('lixo.lixo.lixo'));
    expect(r.statusCode).toBe(401);
    expect(json(r).error).toBe('Sessão inválida: entre de novo');

    const now = Math.floor(Date.now() / 1000);
    r = await me(auth(craftJwt({ sub: admin.user.id, tv: 0, iat: now }, 'outro-segredo-qualquer-com-32-caracteres')));
    expect(r.statusCode).toBe(401);
    r = await me(auth(craftJwt({ sub: admin.user.id, tv: 0, iat: now - 100, exp: now - 10 })));
    expect(r.statusCode).toBe(401);
    expect(json(r).error).toBe('A sessão expirou: entre de novo');
    /* o mesmo token sem expirar vale (prova que a montagem está certa) */
    r = await me(auth(craftJwt({ sub: admin.user.id, tv: 0, iat: now, exp: now + 100 })));
    expect(r.statusCode).toBe(200);
    /* alg none */
    const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: admin.user.id, tv: 0 })).toString('base64url')}.`;
    expect((await me(auth(none))).statusCode).toBe(401);
    /* usuário que não existe */
    expect((await me(auth(craftJwt({ sub: 'naoexiste', tv: 0, iat: now })))).statusCode).toBe(401);

    /* validade de 30 dias */
    const [, body] = admin.token.split('.');
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    expect(p.exp - p.iat).toBe(30 * 86400);
    expect(p).toMatchObject({ sub: admin.user.id, tv: 0 });

    /* troca de senha: token antigo para de valer, o novo vale */
    r = await app.inject({ method: 'POST', url: '/api/auth/password', headers: auth(admin.token), payload: { oldPassword: 'errada', newPassword: 'nova-senha-123' } });
    expect(r.statusCode).toBe(400);
    expect(json(r).error).toBe('A senha atual está errada');
    r = await app.inject({ method: 'POST', url: '/api/auth/password', headers: auth(admin.token), payload: { oldPassword: PASSWORD, newPassword: 'curta' } });
    expect(json(r).error).toBe('A nova senha precisa ter pelo menos 8 caracteres');
    r = await app.inject({ method: 'POST', url: '/api/auth/password', headers: auth(admin.token), payload: { oldPassword: PASSWORD, newPassword: 'nova-senha-123' } });
    expect(r.statusCode).toBe(200);
    const tok2 = json(r).token;
    r = await me(auth(admin.token));
    expect(r.statusCode).toBe(401);
    expect(json(r).error).toMatch(/senha mudou/);
    expect((await me(auth(tok2))).statusCode).toBe(200);
    expect((await login(app, 'admin@equipe.br')).statusCode).toBe(401);
    expect((await login(app, 'admin@equipe.br', 'nova-senha-123')).statusCode).toBe(200);

    /* usuário desativado: token para de valer e o login é recusado */
    const inv = json(await app.inject({ method: 'POST', url: '/api/invites', headers: auth(tok2), payload: { role: 'member' } }));
    const m = json(await app.inject({ method: 'POST', url: '/api/auth/register', payload: { code: inv.code, name: 'M', email: 'm@equipe.br', password: PASSWORD } }));
    expect((await me(auth(m.token))).statusCode).toBe(200);
    r = await app.inject({ method: 'PATCH', url: `/api/users/${m.user.id}`, headers: auth(tok2), payload: { disabled: true } });
    expect(r.statusCode).toBe(200);
    r = await me(auth(m.token));
    expect(r.statusCode).toBe(401);
    r = await login(app, 'm@equipe.br');
    expect(r.statusCode).toBe(403);
    expect(json(r).error).toMatch(/desativado/);
    /* reativado: precisa entrar de novo (token antigo continua inválido) */
    await app.inject({ method: 'PATCH', url: `/api/users/${m.user.id}`, headers: auth(tok2), payload: { disabled: false } });
    expect((await me(auth(m.token))).statusCode).toBe(401);
    expect((await login(app, 'm@equipe.br')).statusCode).toBe(200);
  });
});

describe('limite de tentativas do login', () => {
  it('10 por minuto por IP; outro IP continua entrando', async () => {
    t = await makeApp();
    const { app } = t;
    await setupAdmin(app);
    for (let i = 0; i < 10; i++) {
      const r = await login(app, 'admin@equipe.br', i === 9 ? PASSWORD : 'errada', '192.168.0.50');
      expect(r.statusCode).toBe(i === 9 ? 200 : 401);
    }
    const r = await login(app, 'admin@equipe.br', PASSWORD, '192.168.0.50');
    expect(r.statusCode).toBe(429);
    expect(json(r).error).toMatch(/^Muitas tentativas: espere \d+ s/);
    expect((await login(app, 'admin@equipe.br', PASSWORD, '192.168.0.51')).statusCode).toBe(200);
  });
});

describe('cabeçalhos e logs', () => {
  it('cabeçalhos de segurança em toda resposta; erro 404 da API em JSON português', async () => {
    t = await makeApp();
    const r = await t.app.inject('/api/health');
    expect(r.statusCode).toBe(200);
    expect(json(r).ok).toBe(true);
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['x-frame-options']).toBe('DENY');
    expect(r.headers['referrer-policy']).toBe('no-referrer');
    const nf = await t.app.inject('/api/nao-existe');
    expect(nf.statusCode).toBe(404);
    expect(json(nf).error).toMatch(/Rota não encontrada/);
    expect(nf.headers['x-frame-options']).toBe('DENY');
    /* JSON quebrado */
    const bad = await t.app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'content-type': 'application/json' }, payload: '{"email":' });
    expect(bad.statusCode).toBe(400);
    expect(json(bad).error).toMatch(/JSON inválido|Pedido inválido/);
  });

  it('logs do Fastify não têm senha nem token', async () => {
    const lines: string[] = [];
    const stream = new Writable({ write(chunk, _enc, cb) { lines.push(String(chunk)); cb(); } });
    t = await makeApp({ logger: { level: 'trace', stream } });
    const { app } = t;
    const admin = await setupAdmin(app);
    await app.inject({ url: '/api/auth/me', headers: auth(admin.token) });
    await login(app, 'admin@equipe.br');
    await login(app, 'admin@equipe.br', 'senha-errada-secreta');
    const all = lines.join('\n');
    expect(all.length).toBeGreaterThan(100);
    expect(all).not.toContain(PASSWORD);
    expect(all).not.toContain('senha-errada-secreta');
    expect(all).not.toContain(admin.token);
    expect(all).not.toContain(admin.token.split('.')[2]);
  });
});
