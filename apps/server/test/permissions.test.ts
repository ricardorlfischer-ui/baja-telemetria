/* Matriz de permissões: cada rota × (sem login, viewer, outro membro, dono, admin).
 *   viewer  só lê
 *   member  envia sessões, cria carros e pistas, edita/apaga o que é seu (sessões, carros, pistas, anotações)
 *   admin   tudo, usuários e convites
 * "owner" = o membro que criou o recurso; "member" = outro membro. Rotas que apagam criam um
 * recurso novo a cada chamada. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, fixture, json, makeApp, makeTeam, PASSWORD, upload, type Team, type TestApp } from './helpers';

type Who = 'anon' | 'viewer' | 'member' | 'owner' | 'admin';
const WHO: Who[] = ['anon', 'viewer', 'member', 'owner', 'admin'];

let t: TestApp, team: Team;
let sessionId = '', carId = '', trackId = '', commentId = '';
let seq = 0;

beforeAll(async () => {
  t = await makeApp();
  team = await makeTeam(t.app);
  sessionId = json(await upload(t.app, team.member, 'ft_log3_gps.csv', fixture('ft_log3_gps.csv'))).id;
  carId = json(await t.app.inject({ method: 'POST', url: '/api/cars', headers: auth(team.member), payload: { name: 'C' } })).id;
  trackId = json(await t.app.inject({ method: 'POST', url: '/api/tracks', headers: auth(team.member), payload: { name: 'P' } })).id;
  commentId = json(await t.app.inject({ method: 'POST', url: `/api/sessions/${sessionId}/comments`, headers: auth(team.member), payload: { text: 'c' } })).id;
});
afterAll(async () => { await t.close(); });

const tokenOf = (w: Who): string | null =>
  w === 'anon' ? null : w === 'viewer' ? team.viewer : w === 'member' ? team.member2 : w === 'owner' ? team.member : team.admin;

/* recursos novos (do "owner") para as rotas que apagam */
const fresh = {
  session: async () => json(await upload(t.app, team.member, `s${++seq}.csv`, fixture('ft_log3_gps.csv'), { allowDuplicate: true })).id as string,
  car: async () => json(await t.app.inject({ method: 'POST', url: '/api/cars', headers: auth(team.member), payload: { name: `c${++seq}` } })).id as string,
  track: async () => json(await t.app.inject({ method: 'POST', url: '/api/tracks', headers: auth(team.member), payload: { name: `p${++seq}` } })).id as string,
  comment: async () => json(await t.app.inject({ method: 'POST', url: `/api/sessions/${sessionId}/comments`, headers: auth(team.member), payload: { text: 'x' } })).id as string,
  user: async () => json(await t.app.inject({ method: 'POST', url: '/api/users', headers: auth(team.admin), payload: { name: 'u', email: `u${++seq}@equipe.br`, role: 'viewer' } })).id as string,
  invite: async () => json(await t.app.inject({ method: 'POST', url: '/api/invites', headers: auth(team.admin), payload: {} })).code as string,
};

interface Case {
  name: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: () => string | Promise<string>;
  body?: () => object;
  multipart?: boolean;
  expect: Record<Who, number>;
}

const R = 200, C = 201, D = 204, U = 401, F = 403;
const all = (n: number) => ({ anon: n, viewer: n, member: n, owner: n, admin: n });
const read = { anon: U, viewer: R, member: R, owner: R, admin: R };
const adminOnly = (ok: number) => ({ anon: U, viewer: F, member: F, owner: F, admin: ok });
const anyMember = (ok: number) => ({ anon: U, viewer: F, member: ok, owner: ok, admin: ok });
const ownerOrAdmin = (ok: number) => ({ anon: U, viewer: F, member: F, owner: ok, admin: ok });

const CASES: Case[] = [
  { name: 'GET /info', method: 'GET', url: () => '/api/info', expect: all(R) },
  { name: 'GET /health', method: 'GET', url: () => '/api/health', expect: all(R) },
  { name: 'GET /auth/me', method: 'GET', url: () => '/api/auth/me', expect: read },
  { name: 'POST /auth/password', method: 'POST', url: () => '/api/auth/password', body: () => ({ oldPassword: 'errada', newPassword: PASSWORD }), expect: { anon: U, viewer: 400, member: 400, owner: 400, admin: 400 } },
  { name: 'GET /users', method: 'GET', url: () => '/api/users', expect: adminOnly(R) },
  { name: 'POST /users', method: 'POST', url: () => '/api/users', body: () => ({ name: 'n', email: `n${++seq}@equipe.br` }), expect: adminOnly(C) },
  { name: 'PATCH /users/:id', method: 'PATCH', url: () => `/api/users/${team.ids.viewer}`, body: () => ({ name: 'Leitor' }), expect: adminOnly(R) },
  { name: 'DELETE /users/:id', method: 'DELETE', url: async () => `/api/users/${await fresh.user()}`, expect: adminOnly(D) },
  { name: 'GET /invites', method: 'GET', url: () => '/api/invites', expect: adminOnly(R) },
  { name: 'POST /invites', method: 'POST', url: () => '/api/invites', body: () => ({ role: 'member' }), expect: adminOnly(C) },
  { name: 'DELETE /invites/:code', method: 'DELETE', url: async () => `/api/invites/${await fresh.invite()}`, expect: adminOnly(D) },
  { name: 'GET /sessions', method: 'GET', url: () => '/api/sessions', expect: read },
  { name: 'POST /sessions', method: 'POST', url: () => '/api/sessions', multipart: true, expect: anyMember(C) },
  { name: 'GET /sessions/:id', method: 'GET', url: () => `/api/sessions/${sessionId}`, expect: read },
  { name: 'PATCH /sessions/:id', method: 'PATCH', url: () => `/api/sessions/${sessionId}`, body: () => ({ notes: 'n' }), expect: ownerOrAdmin(R) },
  { name: 'DELETE /sessions/:id', method: 'DELETE', url: async () => `/api/sessions/${await fresh.session()}`, expect: ownerOrAdmin(D) },
  { name: 'GET /sessions/:id/file', method: 'GET', url: () => `/api/sessions/${sessionId}/file`, expect: read },
  { name: 'POST /sessions/:id/summary', method: 'POST', url: () => `/api/sessions/${sessionId}/summary`, expect: anyMember(R) },
  { name: 'GET /cars', method: 'GET', url: () => '/api/cars', expect: read },
  { name: 'GET /cars/:id', method: 'GET', url: () => `/api/cars/${carId}`, expect: read },
  { name: 'POST /cars', method: 'POST', url: () => '/api/cars', body: () => ({ name: 'novo' }), expect: anyMember(C) },
  { name: 'PUT /cars/:id', method: 'PUT', url: () => `/api/cars/${carId}`, body: () => ({ name: 'C' }), expect: ownerOrAdmin(R) },
  { name: 'DELETE /cars/:id', method: 'DELETE', url: async () => `/api/cars/${await fresh.car()}`, expect: ownerOrAdmin(D) },
  { name: 'GET /tracks', method: 'GET', url: () => '/api/tracks', expect: read },
  { name: 'GET /tracks/:id', method: 'GET', url: () => `/api/tracks/${trackId}`, expect: read },
  { name: 'POST /tracks', method: 'POST', url: () => '/api/tracks', body: () => ({ name: 'nova' }), expect: anyMember(C) },
  { name: 'PUT /tracks/:id', method: 'PUT', url: () => `/api/tracks/${trackId}`, body: () => ({ name: 'P' }), expect: ownerOrAdmin(R) },
  { name: 'DELETE /tracks/:id', method: 'DELETE', url: async () => `/api/tracks/${await fresh.track()}`, expect: ownerOrAdmin(D) },
  { name: 'GET /sessions/:id/comments', method: 'GET', url: () => `/api/sessions/${sessionId}/comments`, expect: read },
  { name: 'POST /sessions/:id/comments', method: 'POST', url: () => `/api/sessions/${sessionId}/comments`, body: () => ({ text: 'oi' }), expect: anyMember(C) },
  { name: 'DELETE /comments/:id', method: 'DELETE', url: async () => `/api/comments/${await fresh.comment()}`, expect: ownerOrAdmin(D) },
];

describe('matriz de permissões', () => {
  for (const c of CASES) {
    it(c.name, async () => {
      for (const w of WHO) {
        const tok = tokenOf(w);
        const url = await c.url();
        const headers: Record<string, string> = tok ? auth(tok) : {};
        let r;
        if (c.multipart) {
          r = await upload(t.app, tok ?? '', `m${++seq}.csv`, fixture('ft_log3_gps.csv'), { allowDuplicate: true });
          if (!tok) r = await t.app.inject({ method: 'POST', url, payload: {} });
        } else {
          r = await t.app.inject({ method: c.method, url, headers, ...(c.body ? { payload: c.body() } : {}) });
        }
        expect({ who: w, status: r.statusCode }).toEqual({ who: w, status: c.expect[w] });
        if (r.statusCode >= 400) expect(typeof json(r).error).toBe('string');
      }
    });
  }

  it('o recurso de outro continua intacto depois das recusas', async () => {
    expect((await t.app.inject({ url: `/api/comments/${commentId}`, headers: auth(team.admin) })).statusCode).toBe(404);   /* não há GET de anotação */
    const list = json<any[]>(await t.app.inject({ url: `/api/sessions/${sessionId}/comments`, headers: auth(team.viewer) }));
    expect(list.some(c => c.id === commentId)).toBe(true);
    expect(json(await t.app.inject({ url: `/api/sessions/${sessionId}`, headers: auth(team.viewer) })).uploadedById).toBe(team.ids.member);
  });

  it('id inválido nas rotas → 400 em português', async () => {
    const r = await t.app.inject({ url: '/api/sessions/a..b', headers: auth(team.viewer) });
    expect(r.statusCode).toBe(400);
    expect(json(r).error).toBe('"id" está num formato inválido');
  });
});
