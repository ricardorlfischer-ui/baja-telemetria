/* Sessões: envio dos fixtures reais com o resumo conferido contra o core rodando direto,
 * duplicado, data do teste, download byte a byte (com e sem gzip), filtros da lista, PATCH que
 * recalcula, limite de tamanho, erros do parser, recálculo na subida, anotações. */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { computeSession, parseLog, sessionSummary, SUMMARY_VERSION, type AnalysisConfigInput } from '@baja/core';
import { auth, fixture, FIXTURE_FILES, json, makeApp, makeTeam, multipart, upload, type Team, type TestApp } from './helpers';

/* o que o servidor deve calcular: core direto, com a mesma montagem da configuração */
function expected(file: string, text: string, track: Record<string, any> = {}, car: Record<string, any> = {}) {
  const { susp, ...carRest } = car;
  const hasLine = Array.isArray(track.line) && track.line.length >= 2;
  const cfg: AnalysisConfigInput = { ...track, line: hasLine ? track.line : null, car: carRest, ...(susp ? { susp } : {}) };
  const S = parseLog(text, file);
  return JSON.parse(JSON.stringify(sessionSummary(computeSession(S, cfg, { autoLine: !hasLine }))));
}

let t: TestApp, team: Team;
beforeAll(async () => { t = await makeApp(); team = await makeTeam(t.app); });
afterAll(async () => { await t.close(); });

const get = (url: string, token = team.viewer, headers: Record<string, string> = {}) =>
  t.app.inject({ url, headers: { ...auth(token), ...headers } });

describe('envio dos logs reais', () => {
  const ids: Record<string, string> = {};

  it.each(FIXTURE_FILES)('%s: guarda, calcula o resumo igual ao core e devolve o arquivo byte a byte', async file => {
    const raw = fixture(file);
    const r = await upload(t.app, team.member, file, raw, { driver: 'Ana', tags: ['teste', 'teste', ' pista '] });
    expect(r.statusCode).toBe(201);
    const s = json(r);
    ids[file] = s.id;
    expect(s).toMatchObject({
      name: file.replace(/\.[^.]+$/, ''), fileName: file, kind: file.endsWith('.log') ? 'BUSMASTER' : 'FT',
      size: raw.length, uploadedBy: 'member membro@equipe.br', driver: 'Ana', tags: ['teste', 'pista'],
      summaryVersion: SUMMARY_VERSION,
    });
    expect(s.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(s.summaryError).toBeUndefined();

    /* resumo = core direto (sem perfil: padrões do core + linha automática) */
    const want = expected(file, raw.toString('utf8'));
    expect(s.summary).toEqual(want);
    expect(s.summary.version).toBe(SUMMARY_VERSION);
    const dur = s.summary.metrics.find((m: any) => m.key === 'session.duration');
    expect(dur.value).toBeGreaterThan(1);

    /* arquivo comprimido no disco */
    const gzFile = path.join(t.dir, 'sessions', `${s.id}.gz`);
    expect(fs.existsSync(gzFile)).toBe(true);
    expect(zlib.gunzipSync(fs.readFileSync(gzFile)).equals(raw)).toBe(true);

    /* download com gzip */
    let d = await get(`/api/sessions/${s.id}/file`, team.viewer, { 'accept-encoding': 'gzip, deflate, br' });
    expect(d.statusCode).toBe(200);
    expect(d.headers['content-encoding']).toBe('gzip');
    expect(d.headers['content-disposition']).toBe(`attachment; filename="${file}"; filename*=UTF-8''${file}`);
    expect(d.headers.vary).toMatch(/Accept-Encoding/);
    expect(zlib.gunzipSync(d.rawPayload).equals(raw)).toBe(true);
    /* sem gzip (e com gzip;q=0) */
    for (const ae of [undefined, 'identity', 'gzip;q=0']) {
      d = await get(`/api/sessions/${s.id}/file`, team.viewer, ae ? { 'accept-encoding': ae } : {});
      expect(d.statusCode).toBe(200);
      expect(d.headers['content-encoding']).toBeUndefined();
      expect(d.rawPayload.equals(raw)).toBe(true);
    }
  });

  it('data do teste: tirada do cabeçalho do BUSMASTER', async () => {
    const s = json(await get(`/api/sessions/${ids['busmaster_14.log']}`));
    expect(s.date).toBe('2026-10-05T16:34');
    /* FT sem data no nome: fica sem data */
    expect(json(await get(`/api/sessions/${ids['ft_log3_gps.csv']}`)).date).toBeUndefined();
  });

  it('duplicado: 409 com o id existente; allowDuplicate aceita', async () => {
    const raw = fixture('ft_log3_gps.csv');
    let r = await upload(t.app, team.member2, 'outro-nome.csv', raw);
    expect(r.statusCode).toBe(409);
    expect(json(r)).toMatchObject({ error: expect.stringMatching(/já está na biblioteca/), id: ids['ft_log3_gps.csv'] });
    /* com o nome da FT: data tirada do nome do arquivo */
    r = await upload(t.app, team.member2, 'Log 3_20261005-1644.csv', raw, { allowDuplicate: true, tags: ['dup'] });
    expect(r.statusCode).toBe(201);
    const s = json(r);
    expect(s.date).toBe('2026-10-05T16:44');
    expect(s.name).toBe('Log 3_20261005-1644');
    expect(s.uploadedBy).toBe('member membro2@equipe.br');
    const d = await get(`/api/sessions/${s.id}/file`);
    expect(d.headers['content-disposition']).toBe(`attachment; filename="Log 3_20261005-1644.csv"; filename*=UTF-8''Log%203_20261005-1644.csv`);
    /* a data informada vale mais que a do nome */
    r = await upload(t.app, team.member2, 'Log 3_20261005-1644.csv', raw, { allowDuplicate: true, date: '2026-09-01', name: 'Treino' });
    expect(json(r)).toMatchObject({ date: '2026-09-01', name: 'Treino' });
    await t.app.inject({ method: 'DELETE', url: `/api/sessions/${json(r).id}`, headers: auth(team.member2) });
  });

  it('erros: log ilegível (mensagem do parser), vazio, sem arquivo, meta inválido, não multipart', async () => {
    let r = await upload(t.app, team.member, 'lixo.csv', Buffer.from('só uma coluna\n1\n2\n'));
    expect(r.statusCode).toBe(400);
    expect(json(r).error).toBe('Não consegui ler o log "lixo.csv": Não parece um CSV (uma coluna só)');
    r = await upload(t.app, team.member, 'can.log', Buffer.from('***BUSMASTER Ver 3.2.2***\n***<Time><Tx/Rx><Channel><CAN ID><Type><DLC><DataBytes>***\nnada\n'));
    expect(r.statusCode).toBe(400);
    expect(json(r).error).toMatch(/Nenhum quadro CAN reconhecido/);
    r = await upload(t.app, team.member, 'vazio.csv', Buffer.alloc(0));
    expect(json(r).error).toBe('O arquivo está vazio');
    const mp = multipart({ meta: '{}' });
    r = await t.app.inject({ method: 'POST', url: '/api/sessions', headers: { ...mp.headers, ...auth(team.member) }, payload: mp.payload });
    expect(json(r).error).toMatch(/Falta o arquivo/);
    const mp2 = multipart({ meta: '{nao é json' }, { name: 'a.csv', data: fixture('ft_log3_gps.csv') });
    r = await t.app.inject({ method: 'POST', url: '/api/sessions', headers: { ...mp2.headers, ...auth(team.member) }, payload: mp2.payload });
    expect(r.statusCode).toBe(400);
    expect(json(r).error).toBe('O campo "meta" não é um JSON válido');
    r = await upload(t.app, team.member, 'a.csv', fixture('ft_log3_gps.csv'), { tags: [{}], allowDuplicate: true });
    expect(r.statusCode).toBe(400);
    expect(json(r).error).toBe('"etiquetas (item 1)" deve ser um texto');
    r = await upload(t.app, team.member, 'a.csv', fixture('ft_log3_gps.csv'), { name: '', allowDuplicate: true });
    expect(json(r).error).toBe('Preencha "nome"');
    r = await upload(t.app, team.member, 'a.csv', fixture('ft_log3_gps.csv'), { trackId: 'naoexiste', allowDuplicate: true });
    expect(json(r).error).toBe('Pista não encontrada');
    r = await t.app.inject({ method: 'POST', url: '/api/sessions', headers: auth(team.member), payload: { a: 1 } });
    expect(r.statusCode).toBe(415);
    expect(json(r).error).toMatch(/multipart/);
  });

  it('lista: filtros q, trackId, carId, tag e ordem por data', async () => {
    const car = json(await t.app.inject({ method: 'POST', url: '/api/cars', headers: auth(team.member), payload: { name: 'BJ26' } }));
    const track = json(await t.app.inject({ method: 'POST', url: '/api/tracks', headers: auth(team.member), payload: { name: 'Interlagos' } }));
    const patch = (id: string, body: object, token = team.member) =>
      t.app.inject({ method: 'PATCH', url: `/api/sessions/${id}`, headers: auth(token), payload: body });
    expect((await patch(ids['ft_log3_gps.csv'], { date: '2026-08-01', notes: 'Pneu novo dianteiro', tags: ['gps', 'Seco'], carId: car.id })).statusCode).toBe(200);
    expect((await patch(ids['ft_log3_shocks_compact.csv'], { date: '2026-09-15', driver: 'Bruno', trackId: track.id, carId: car.id })).statusCode).toBe(200);

    const list = async (qs = '') => json<any[]>(await get(`/api/sessions${qs}`));
    const all = await list();
    expect(all.length).toBe(4);
    expect(all.map(s => s.date)).toEqual(['2026-10-05T16:44', '2026-10-05T16:34', '2026-09-15', '2026-08-01']);
    expect(all.every(s => s.summary && s.uploadedBy)).toBe(true);
    expect((await list('?q=bruno')).map(s => s.id)).toEqual([ids['ft_log3_shocks_compact.csv']]);
    expect((await list('?q=pneu%20novo')).map(s => s.id)).toEqual([ids['ft_log3_gps.csv']]);
    expect((await list('?q=seco')).map(s => s.id)).toEqual([ids['ft_log3_gps.csv']]);
    expect((await list('?q=100%25')).length).toBe(0);
    expect((await list(`?carId=${car.id}`)).length).toBe(2);
    expect((await list(`?trackId=${track.id}`)).map(s => s.id)).toEqual([ids['ft_log3_shocks_compact.csv']]);
    expect((await list('?tag=GPS')).map(s => s.id)).toEqual([ids['ft_log3_gps.csv']]);
    expect((await list('?tag=dup')).length).toBe(1);
    expect((await list(`?tag=teste&carId=${car.id}`)).map(s => s.id)).toEqual([ids['ft_log3_shocks_compact.csv']]);
    const bad = await get('/api/sessions?trackId=a%20b');
    expect(bad.statusCode).toBe(400);
  });

  it('PATCH com carro/pista recalcula o resumo; POST /summary recalcula', async () => {
    const id = ids['ft_log3_shocks_compact.csv'];
    const raw = fixture('ft_log3_shocks_compact.csv').toString('utf8');
    const carParams = { mass: 300, strokeF: 60, strokeR: 70, mrF: 0.8, mrR: 0.7, massF: 50, massR: 60, susp: { knee: 80 }, novoCampo: 'fica' };
    const trackParams = { sizeX: 300, sizeY: 300, margin: 12 };
    const car = json(await t.app.inject({ method: 'POST', url: '/api/cars', headers: auth(team.member), payload: { name: 'Setup B', params: carParams } }));
    expect(car.params).toEqual(carParams);
    const track = json(await t.app.inject({ method: 'POST', url: '/api/tracks', headers: auth(team.member), payload: { name: 'Pista B', params: trackParams } }));
    const before = json(await get(`/api/sessions/${id}`)).summary;
    const r = await t.app.inject({ method: 'PATCH', url: `/api/sessions/${id}`, headers: auth(team.member), payload: { carId: car.id, trackId: track.id, summary: { ignorado: true } } });
    expect(r.statusCode).toBe(200);
    const s = json(r);
    expect(s.carId).toBe(car.id);
    expect(s.summary).toEqual(expected('ft_log3_shocks_compact.csv', raw, trackParams, carParams));
    expect(s.summary).not.toEqual(before);
    const pct = s.summary.metrics.find((m: any) => m.key === 'susp.travelPct.R');
    expect(pct.value).not.toBeNull();

    /* tirar o carro: volta aos padrões */
    const r2 = await t.app.inject({ method: 'PATCH', url: `/api/sessions/${id}`, headers: auth(team.member), payload: { carId: null } });
    expect(json(r2).carId).toBeUndefined();
    expect(json(r2).summary).toEqual(expected('ft_log3_shocks_compact.csv', raw, trackParams, {}));

    /* POST /summary: recalcula (resumo apagado no banco volta) */
    t.app.db.prepare('UPDATE sessions SET summary = NULL, summary_version = 0 WHERE id = ?').run(id);
    expect(json(await get(`/api/sessions/${id}`)).summaryOutdated).toBe(true);
    const r3 = await t.app.inject({ method: 'POST', url: `/api/sessions/${id}/summary`, headers: auth(team.member2) });
    expect(r3.statusCode).toBe(200);
    expect(json(r3).summary).toEqual(json(r2).summary);
    expect(json(r3).summaryVersion).toBe(SUMMARY_VERSION);
    expect(json(r3).summaryOutdated).toBeUndefined();
  });

  it('anotações: criar, listar com autor, apagar (autor ou admin)', async () => {
    const id = ids['ft_log3_gps.csv'];
    const url = `/api/sessions/${id}/comments`;
    let r = await t.app.inject({ method: 'POST', url, headers: auth(team.member), payload: { t: 12.5, text: '  Batida na traseira  ' } });
    expect(r.statusCode).toBe(201);
    const c1 = json(r);
    expect(c1).toMatchObject({ sessionId: id, userName: 'member membro@equipe.br', t: 12.5, text: 'Batida na traseira' });
    r = await t.app.inject({ method: 'POST', url, headers: auth(team.member2), payload: { text: 'Geral' } });
    const c2 = json(r);
    expect(c2.t).toBeNull();
    r = await t.app.inject({ method: 'POST', url, headers: auth(team.member2), payload: { text: '   ' } });
    expect(r.statusCode).toBe(400);
    r = await t.app.inject({ method: 'POST', url, headers: auth(team.member2), payload: { text: 'x', t: -1 } });
    expect(json(r).error).toBe('"tempo" deve ser no mínimo 0');
    const list = json<any[]>(await get(url));
    expect(list.map(c => c.id)).toEqual([c1.id, c2.id]);
    expect((await t.app.inject({ method: 'DELETE', url: `/api/comments/${c1.id}`, headers: auth(team.member2) })).statusCode).toBe(403);
    expect((await t.app.inject({ method: 'DELETE', url: `/api/comments/${c1.id}`, headers: auth(team.member) })).statusCode).toBe(204);
    expect((await t.app.inject({ method: 'DELETE', url: `/api/comments/${c2.id}`, headers: auth(team.admin) })).statusCode).toBe(204);
    expect((await t.app.inject({ method: 'DELETE', url: `/api/comments/${c2.id}`, headers: auth(team.admin) })).statusCode).toBe(404);
    expect(json<any[]>(await get(url))).toEqual([]);
    expect((await get('/api/sessions/naoexiste/comments')).statusCode).toBe(404);
  });

  it('DELETE apaga a sessão, o arquivo e as anotações', async () => {
    const r = await upload(t.app, team.member, 'apagar.csv', fixture('ft_log3_gps.csv'), { allowDuplicate: true });
    const id = json(r).id;
    await t.app.inject({ method: 'POST', url: `/api/sessions/${id}/comments`, headers: auth(team.member), payload: { text: 'a' } });
    expect((await t.app.inject({ method: 'DELETE', url: `/api/sessions/${id}`, headers: auth(team.member) })).statusCode).toBe(204);
    expect(fs.existsSync(path.join(t.dir, 'sessions', `${id}.gz`))).toBe(false);
    expect((await get(`/api/sessions/${id}`)).statusCode).toBe(404);
    expect((t.app.db.prepare('SELECT COUNT(*) AS n FROM comments WHERE session_id = ?').get(id) as { n: number }).n).toBe(0);
  });
});

describe('limite de tamanho do envio', () => {
  it('MAX_UPLOAD_MB: arquivo maior → 413 em português, nada guardado', async () => {
    const small = await makeApp({ maxUploadMb: 0.2 });
    try {
      const tm = await makeTeam(small.app);
      const r = await upload(small.app, tm.member, 'ft_log3_shocks_compact.csv', fixture('ft_log3_shocks_compact.csv'));
      expect(r.statusCode).toBe(413);
      expect(json(r).error).toBe('Arquivo grande demais (limite de 0.2 MB)');
      expect(fs.readdirSync(path.join(small.dir, 'sessions'))).toEqual([]);
      const ok = await upload(small.app, tm.member, 'ft_log3_gps.csv', fixture('ft_log3_gps.csv'));
      expect(ok.statusCode).toBe(201);
    } finally {
      await small.close();
    }
  });
});

describe('recálculo na subida', () => {
  it('resumos de versão antiga são recalculados em segundo plano quando o servidor sobe', async () => {
    const first = await makeApp();
    const dir = first.dir;
    const tm = await makeTeam(first.app);
    const id = json(await upload(first.app, tm.member, 'ft_log3_gps.csv', fixture('ft_log3_gps.csv'))).id;
    const good = json(await first.app.inject({ url: `/api/sessions/${id}`, headers: auth(tm.viewer) })).summary;
    first.app.db.prepare("UPDATE sessions SET summary = '{\"version\":0,\"metrics\":[]}', summary_version = 0 WHERE id = ?").run(id);
    await first.app.close();

    const second = await makeApp({ dataDir: dir });
    try {
      await second.app.recalc.idle();
      const row = second.app.db.prepare('SELECT summary, summary_version FROM sessions WHERE id = ?').get(id) as { summary: string; summary_version: number };
      expect(row.summary_version).toBe(SUMMARY_VERSION);
      expect(JSON.parse(row.summary)).toEqual(good);
      /* token antigo continua valendo (mesmo segredo, mesma versão) */
      expect((await second.app.inject({ url: '/api/auth/me', headers: auth(tm.viewer) })).statusCode).toBe(200);
    } finally {
      await second.close();
    }
  });
});
