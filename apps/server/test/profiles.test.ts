/* Carros e pistas: CRUD, validação leniente dos params e recálculo em segundo plano dos
 * resumos das sessões que usam o perfil. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { computeSession, parseLog, sessionSummary } from '@baja/core';
import { auth, fixture, json, makeApp, makeTeam, upload, type Team, type TestApp } from './helpers';

let t: TestApp, team: Team;
beforeAll(async () => { t = await makeApp(); team = await makeTeam(t.app); });
afterAll(async () => { await t.close(); });

const req = (method: string, url: string, token: string, payload?: object) =>
  t.app.inject({ method: method as 'GET', url, headers: auth(token), ...(payload ? { payload } : {}) });

describe('CRUD', () => {
  it.each([['cars', 'Carro'], ['tracks', 'Pista']])('/api/%s', async (route, label) => {
    let r = await req('POST', `/api/${route}`, team.member, { params: {} });
    expect(r.statusCode).toBe(400);
    expect(json(r).error).toBe('Falta o campo "nome"');
    r = await req('POST', `/api/${route}`, team.member, { name: 'X', params: [1, 2] });
    expect(r.statusCode).toBe(400);
    expect(json(r).error).toBe('"parâmetros" deve ser um objeto');
    r = await req('POST', `/api/${route}`, team.member, { name: 'X', params: 'texto' });
    expect(r.statusCode).toBe(400);

    r = await req('POST', `/api/${route}`, team.member, { name: '  Perfil A ', params: { desconhecido: { a: 1 }, lista: [1, 2] } });
    expect(r.statusCode).toBe(201);
    const p = json(r);
    expect(p).toMatchObject({ name: 'Perfil A', params: { desconhecido: { a: 1 }, lista: [1, 2] }, createdByName: 'member membro@equipe.br', sessions: 0 });
    r = await req('POST', `/api/${route}`, team.member2, { name: 'Perfil B' });
    expect(json(r).params).toEqual({});

    let list = json<any[]>(await req('GET', `/api/${route}`, team.viewer));
    expect(list.map(x => x.name)).toEqual(['Perfil A', 'Perfil B']);
    expect(json(await req('GET', `/api/${route}/${p.id}`, team.viewer)).name).toBe('Perfil A');
    expect(json(await req('GET', `/api/${route}/naoexiste`, team.viewer)).error).toBe(`${label} não encontrad${label === 'Pista' ? 'a' : 'o'}`);

    /* só quem criou (ou admin) edita; params ausente mantém os atuais */
    r = await req('PUT', `/api/${route}/${p.id}`, team.member2, { name: 'Tomado' });
    expect(r.statusCode).toBe(403);
    expect(json(r).error).toBe(`Só quem criou ${label === 'Pista' ? 'a pista' : 'o carro'} (ou um administrador) pode mudar ou apagar`);
    r = await req('PUT', `/api/${route}/${p.id}`, team.member, { name: 'Perfil A2' });
    expect(r.statusCode).toBe(200);
    expect(json(r)).toMatchObject({ name: 'Perfil A2', params: { desconhecido: { a: 1 } } });
    r = await req('PUT', `/api/${route}/${p.id}`, team.admin, { name: 'Perfil A2', params: { novo: true } });
    expect(json(r).params).toEqual({ novo: true });

    /* apagar: quem criou ou admin */
    expect((await req('DELETE', `/api/${route}/${p.id}`, team.member2)).statusCode).toBe(403);
    expect((await req('DELETE', `/api/${route}/${p.id}`, team.member)).statusCode).toBe(204);
    expect((await req('DELETE', `/api/${route}/${p.id}`, team.member)).statusCode).toBe(404);
    list = json<any[]>(await req('GET', `/api/${route}`, team.viewer));
    expect(list.map(x => x.name)).toEqual(['Perfil B']);
    expect((await req('DELETE', `/api/${route}/${list[0].id}`, team.admin)).statusCode).toBe(204);
  });

  it('tipos conferidos nos campos conhecidos', async () => {
    let r = await req('POST', '/api/cars', team.member, { name: 'C', params: { mass: 'pesado' } });
    expect(r.statusCode).toBe(400);
    expect(json(r).error).toBe('"mass" deve ser um número');
    r = await req('POST', '/api/cars', team.member, { name: 'C', params: { mass: -1 } });
    expect(json(r).error).toBe('"mass" deve ser no mínimo 0');
    r = await req('POST', '/api/cars', team.member, { name: 'C', params: { susp: { knee: 'x' } } });
    expect(r.statusCode).toBe(400);
    r = await req('POST', '/api/tracks', team.member, { name: 'P', params: { lat0: 120 } });
    expect(json(r).error).toBe('"lat0" deve ser no máximo 90');
    r = await req('POST', '/api/tracks', team.member, { name: 'P', params: { line: [{ x: 1, y: 2 }] } });
    expect(r.statusCode).toBe(400);
    /* tamanho da área do GPS absurdo (o core alocaria até estourar a memória) */
    r = await req('POST', '/api/tracks', team.member, { name: 'P', params: { sizeX: 6e9 } });
    expect(json(r).error).toBe('"sizeX" deve ser no máximo 100000');
    r = await req('POST', '/api/tracks', team.member, { name: 'P', params: { fmt: 'furlongs' } });
    expect(json(r).error).toMatch(/^"fmt" deve ser um destes: auto, V, mV, code, m$/);
    r = await req('POST', '/api/tracks', team.member, { name: 'P', params: { line: [{ x: 1, y: 2 }, { x: 3, y: 4 }], fmt: 'm', centerFixed: false } });
    expect(r.statusCode).toBe(201);
    await req('DELETE', `/api/tracks/${json(r).id}`, team.admin);
  });
});

describe('recálculo quando o perfil muda', () => {
  it('PUT com params novos recalcula em segundo plano; apagar o perfil volta aos padrões', async () => {
    const file = 'ft_log3_shocks_compact.csv';
    const text = fixture(file).toString('utf8');
    const car = json(await req('POST', '/api/cars', team.member, { name: 'BJ26', params: { strokeF: 50, strokeR: 50 } }));
    const track = json(await req('POST', '/api/tracks', team.member, { name: 'Pista', params: { minLap: 15 } }));
    const s = json(await upload(t.app, team.member, file, fixture(file), { carId: car.id, trackId: track.id }));
    const S = parseLog(text, file);
    const direct = (carP: object, trackP: object) =>
      JSON.parse(JSON.stringify(sessionSummary(computeSession(S, { ...trackP, line: null, car: carP }, { autoLine: true }))));
    expect(s.summary).toEqual(direct({ strokeF: 50, strokeR: 50 }, { minLap: 15 }));
    expect(json(await req('GET', `/api/cars/${car.id}`, team.viewer)).sessions).toBe(1);

    /* só o nome: não recalcula */
    await req('PUT', `/api/cars/${car.id}`, team.member, { name: 'BJ26 novo' });
    expect(t.app.recalc.pending).toBe(0);

    await req('PUT', `/api/cars/${car.id}`, team.member, { name: 'BJ26', params: { strokeF: 80, strokeR: 90, mass: 280 } });
    await t.app.recalc.idle();
    let now = json(await req('GET', `/api/sessions/${s.id}`, team.viewer)).summary;
    expect(now).toEqual(direct({ strokeF: 80, strokeR: 90, mass: 280 }, { minLap: 15 }));
    expect(now).not.toEqual(s.summary);

    await req('PUT', `/api/tracks/${track.id}`, team.admin, { name: 'Pista', params: { minLap: 20, sizeX: 250 } });
    await t.app.recalc.idle();
    now = json(await req('GET', `/api/sessions/${s.id}`, team.viewer)).summary;
    expect(now).toEqual(direct({ strokeF: 80, strokeR: 90, mass: 280 }, { minLap: 20, sizeX: 250 }));

    expect((await req('DELETE', `/api/cars/${car.id}`, team.member)).statusCode).toBe(204);
    await t.app.recalc.idle();
    const after = json(await req('GET', `/api/sessions/${s.id}`, team.viewer));
    expect(after.carId).toBeUndefined();
    expect(after.trackId).toBe(track.id);
    expect(after.summary).toEqual(direct({}, { minLap: 20, sizeX: 250 }));
  });

  it('pista com linha de largada salva: usa a linha (sem linha automática)', async () => {
    const file = 'ft_log3_gps.csv';
    const S = parseLog(fixture(file).toString('utf8'), file);
    const line = [{ x: -5, y: 0 }, { x: 5, y: 0 }];
    const track = json(await req('POST', '/api/tracks', team.member, { name: 'Com linha', params: { line } }));
    const s = json(await upload(t.app, team.member, file, fixture(file), { trackId: track.id, allowDuplicate: true }));
    const want = JSON.parse(JSON.stringify(sessionSummary(computeSession(S, { line, car: {} }, { autoLine: false }))));
    expect(s.summary).toEqual(want);
  });
});
