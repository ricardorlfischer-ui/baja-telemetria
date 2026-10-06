/* Usuários e convites (admin): senha temporária, papel, desativar, apagar, último admin. */
import { afterEach, describe, expect, it } from 'vitest';
import { auth, json, login, makeApp, makeTeam, type TestApp } from './helpers';

let t: TestApp | null = null;
afterEach(async () => { await t?.close(); t = null; });

describe('usuários', () => {
  it('cria com senha temporária (mostrada uma vez), muda papel, apaga', async () => {
    t = await makeApp();
    const { app } = t;
    const team = await makeTeam(app);
    const A = auth(team.admin);

    let r = await app.inject({ method: 'POST', url: '/api/users', headers: A, payload: { name: 'Carla', email: 'Carla@Equipe.br' } });
    expect(r.statusCode).toBe(201);
    const u = json(r);
    expect(u).toMatchObject({ name: 'Carla', email: 'carla@equipe.br', role: 'member', disabled: false });
    expect(u.tempPassword).toMatch(/^[A-Za-z0-9]{12}$/);
    expect((await login(app, 'carla@equipe.br', u.tempPassword)).statusCode).toBe(200);
    const list = json<any[]>(await app.inject({ url: '/api/users', headers: A }));
    expect(list.length).toBe(5);
    expect(list.some(x => 'tempPassword' in x || 'pass_hash' in x || 'token_version' in x)).toBe(false);

    r = await app.inject({ method: 'POST', url: '/api/users', headers: A, payload: { name: 'Outra', email: 'carla@equipe.br' } });
    expect(r.statusCode).toBe(409);
    r = await app.inject({ method: 'POST', url: '/api/users', headers: A, payload: { name: 'Dani', email: 'dani@equipe.br', role: 'viewer', password: 'senha-da-dani' } });
    expect(json(r).tempPassword).toBeUndefined();
    expect(json(r).role).toBe('viewer');
    r = await app.inject({ method: 'POST', url: '/api/users', headers: A, payload: { name: 'X', email: 'x@equipe.br', role: 'chefe' } });
    expect(r.statusCode).toBe(400);
    expect(json(r).error).toBe('"papel" deve ser um destes: viewer, member, admin');

    r = await app.inject({ method: 'PATCH', url: `/api/users/${u.id}`, headers: A, payload: { role: 'viewer', name: 'Carla S.' } });
    expect(json(r)).toMatchObject({ role: 'viewer', name: 'Carla S.' });
    r = await app.inject({ method: 'PATCH', url: `/api/users/${u.id}`, headers: A, payload: {} });
    expect(r.statusCode).toBe(400);
    /* admin redefine a senha: token antigo cai */
    const tokC = json(await login(app, 'carla@equipe.br', u.tempPassword)).token;
    r = await app.inject({ method: 'PATCH', url: `/api/users/${u.id}`, headers: A, payload: { password: 'senha-nova-da-carla' } });
    expect(r.statusCode).toBe(200);
    expect((await app.inject({ url: '/api/auth/me', headers: auth(tokC) })).statusCode).toBe(401);
    expect((await login(app, 'carla@equipe.br', 'senha-nova-da-carla')).statusCode).toBe(200);

    expect((await app.inject({ method: 'DELETE', url: `/api/users/${u.id}`, headers: A })).statusCode).toBe(204);
    expect((await app.inject({ method: 'DELETE', url: `/api/users/${u.id}`, headers: A })).statusCode).toBe(404);
    expect((await app.inject({ method: 'PATCH', url: `/api/users/${u.id}`, headers: A, payload: { name: 'x' } })).statusCode).toBe(404);
  });

  it('o último administrador não se rebaixa, não se desativa e não se apaga', async () => {
    t = await makeApp();
    const { app } = t;
    const team = await makeTeam(app);
    const A = auth(team.admin), me = team.ids.admin;
    for (const payload of [{ role: 'member' }, { role: 'viewer' }, { disabled: true }]) {
      const r = await app.inject({ method: 'PATCH', url: `/api/users/${me}`, headers: A, payload });
      expect(r.statusCode).toBe(409);
      expect(json(r).error).toMatch(/último administrador/);
    }
    let r = await app.inject({ method: 'DELETE', url: `/api/users/${me}`, headers: A });
    expect(r.statusCode).toBe(409);
    expect(json(r).error).toMatch(/^Não dá para apagar o último administrador/);
    /* continua admin */
    expect(json(await app.inject({ url: '/api/auth/me', headers: A })).user.role).toBe('admin');

    /* outro admin desativado não conta */
    r = await app.inject({ method: 'PATCH', url: `/api/users/${team.ids.member}`, headers: A, payload: { role: 'admin', disabled: true } });
    expect(r.statusCode).toBe(200);
    expect((await app.inject({ method: 'PATCH', url: `/api/users/${me}`, headers: A, payload: { role: 'member' } })).statusCode).toBe(409);

    /* com outro admin ativo, pode */
    await app.inject({ method: 'PATCH', url: `/api/users/${team.ids.member}`, headers: A, payload: { disabled: false } });
    r = await app.inject({ method: 'PATCH', url: `/api/users/${me}`, headers: A, payload: { role: 'member' } });
    expect(r.statusCode).toBe(200);
    /* agora quem sobrou é o último */
    const B = auth(json(await login(app, 'membro@equipe.br')).token);
    r = await app.inject({ method: 'DELETE', url: `/api/users/${team.ids.member}`, headers: B });
    expect(r.statusCode).toBe(409);
    /* o ex-admin perdeu o acesso de admin na hora (papel lido do banco) */
    expect((await app.inject({ url: '/api/users', headers: A })).statusCode).toBe(403);
  });
});

describe('convites', () => {
  it('lista com estado, revoga, validade e papel', async () => {
    t = await makeApp();
    const { app } = t;
    const team = await makeTeam(app);
    const A = auth(team.admin);
    let r = await app.inject({ method: 'POST', url: '/api/invites', headers: A, payload: { role: 'admin', days: 1 } });
    expect(r.statusCode).toBe(201);
    const inv = json(r);
    expect(inv).toMatchObject({ role: 'admin', status: 'ativo', createdBy: team.ids.admin, createdByName: 'Admin', usedBy: null });
    r = await app.inject({ method: 'POST', url: '/api/invites', headers: A, payload: { days: 400 } });
    expect(json(r).error).toBe('"dias" deve ser no máximo 365');

    const list = json<any[]>(await app.inject({ url: '/api/invites', headers: A }));
    expect(list.length).toBe(4);   /* 3 usados no makeTeam + 1 */
    expect(list.filter(i => i.status === 'usado').length).toBe(3);
    expect(list.find(i => i.status === 'usado').usedByName).toMatch(/@equipe\.br$/);

    expect((await app.inject({ method: 'DELETE', url: `/api/invites/${inv.code}`, headers: A })).statusCode).toBe(204);
    expect((await app.inject({ method: 'DELETE', url: `/api/invites/${inv.code}`, headers: A })).statusCode).toBe(404);
    r = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { code: inv.code, name: 'Z', email: 'z@equipe.br', password: 'senha-boa-123' } });
    expect(r.statusCode).toBe(400);
    expect(json(r).error).toBe('Código de convite inválido');
  });
});
