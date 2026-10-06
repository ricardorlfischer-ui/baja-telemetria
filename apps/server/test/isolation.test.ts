/* Isolamento da análise (src/analyzer.ts): um log que faz o core estourar a memória ou passar
 * do tempo derruba só a thread de análise, não o servidor.
 *
 * Prova do problema (antes da correção): um CSV de 70 kB com um único ponto da roda a 6e8 km/h
 * faz o powerCurve do core criar 3e8 listas; rodando na thread principal, o Node morria com
 * "FATAL ERROR: Reached heap limit" e levava o servidor junto (qualquer membro derrubava). */
import { afterEach, describe, expect, it } from 'vitest';
import { computeSession, parseLog, sessionSummary } from '@baja/core';
import { auth, fixture, json, makeApp, makeTeam, upload, type TestApp } from './helpers';

/* roda com um pico absurdo num único ponto (sensor com defeito, ou de propósito) */
function wheelSpikeLog(spike: number): Buffer {
  let s = 'TIME,Wheel_speed\n';
  for (let i = 0; i < 3000; i++) {
    const v = i === 1500 ? String(spike) : (20 + 10 * Math.sin(i / 50) + i * 0.01).toFixed(2);
    s += `${(i * 0.02).toFixed(3)},${v}\n`;
  }
  return Buffer.from(s);
}

let t: TestApp | null = null;
afterEach(async () => { await t?.close(); t = null; });

describe('thread de análise', () => {
  it('log que estoura a memória: só a thread morre; a sessão fica com summaryError e o servidor segue', async () => {
    t = await makeApp({ analysisMemoryMb: 256 });
    const team = await makeTeam(t.app);
    const r = await upload(t.app, team.member, 'roda_com_pico.csv', wheelSpikeLog(6e8));
    expect(r.statusCode).toBe(201);
    const s = json(r);
    expect(s.kind).toBe('FT');
    expect(s.summary).toBeUndefined();
    expect(s.summaryError).toBe('Não deu para calcular o resumo: passou do limite de memória da análise (256 MB)');

    /* o servidor continua respondendo e a próxima análise sobe uma thread nova */
    expect(json(await t.app.inject('/api/health')).ok).toBe(true);
    const ok = await upload(t.app, team.member, 'ft_log3_gps.csv', fixture('ft_log3_gps.csv'));
    expect(ok.statusCode).toBe(201);
    const S = parseLog(fixture('ft_log3_gps.csv').toString('utf8'), 'ft_log3_gps.csv');
    expect(json(ok).summary).toEqual(JSON.parse(JSON.stringify(sessionSummary(computeSession(S, { line: null, car: {} }, { autoLine: true })))));

    /* recalcular o log problemático de novo: mesmo resultado, sem derrubar nada */
    const again = await t.app.inject({ method: 'POST', url: `/api/sessions/${s.id}/summary`, headers: auth(team.member) });
    expect(again.statusCode).toBe(200);
    expect(json(again).summaryError).toMatch(/limite de memória/);
    expect((await t.app.inject({ url: '/api/sessions', headers: auth(team.viewer) })).statusCode).toBe(200);
  });

  it('análise que passa do tempo limite: 400 em português e o servidor segue', async () => {
    t = await makeApp({ analysisTimeoutS: 0.2 });
    const team = await makeTeam(t.app);
    /* 0,2 s não dá nem para a thread subir e ler o log */
    const r = await upload(t.app, team.member, 'ft_log3_shocks_compact.csv', fixture('ft_log3_shocks_compact.csv'));
    expect(r.statusCode).toBe(400);
    expect(json(r).error).toBe('Não consegui ler o log "ft_log3_shocks_compact.csv": passou do tempo limite da análise (0.2 s)');
    expect(json(await t.app.inject('/api/health')).ok).toBe(true);
    expect(json(await t.app.inject({ url: '/api/sessions', headers: auth(team.viewer) }))).toEqual([]);
  });

  it('fechar o servidor com análise na fila responde 503 e não deixa processo vivo', async () => {
    t = await makeApp();
    const team = await makeTeam(t.app);
    /* um envio completo sobe o processo de análise (que fica parado esperando o próximo) */
    expect((await upload(t.app, team.member, 'ft_log3_gps.csv', fixture('ft_log3_gps.csv'))).statusCode).toBe(201);
    const pid = (t.app.analyzer as unknown as { child: { pid: number } | null }).child?.pid;
    expect(pid).toBeGreaterThan(0);
    const pending = upload(t.app, team.member, 'ft_log3_shocks_compact.csv', fixture('ft_log3_shocks_compact.csv'));
    await new Promise(r => setTimeout(r, 30));
    await t.app.analyzer.close();
    const r = await pending;
    expect([201, 503]).toContain(r.statusCode);
    if (r.statusCode === 503) expect(json(r).error).toMatch(/encerrando/);
    /* o processo filho morreu */
    expect(() => process.kill(pid!, 0)).toThrow();
  });
});
