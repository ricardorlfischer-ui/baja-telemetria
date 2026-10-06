/* APIs pedidas pela revisão para as páginas não fazerem conta: mín/máx de canal com o
 * instante (channelExtremes), fₙ/ζ por eixo e regra de Olley no relatório da Ressonância
 * (sem depender do espectro da pista) e o aviso de amortecedor quase parado na Suspensão. */
import { describe, it, expect } from 'vitest';
import { readFixture } from './legacy';
import { parseLog, parseCSV } from '../src/parsers';
import { demoCSV, DEMO_CAR } from '../src/demo';
import { computeSession, channelExtremes, getChannel } from '../src/pipeline';
import { resonanceReport, olleyStatus } from '../src/reports/resonance';
import { designReport } from '../src/reports/design';
import { suspensionReport } from '../src/reports/suspension';
import { SHOCK_STILL_MM } from '../src/quality';

const demo = () => { const S = parseCSV(demoCSV(), 'exemplo_baja.csv'); S.demo = true; return computeSession(S, { car: DEMO_CAR }, { autoLine: true }); };
const N = demo();
const n = N.S.t.length;

describe('channelExtremes', () => {
  it('mín e máx com instante e índice, no trecho', () => {
    for (const key of ['Shock_-_Front_Left', 'gps:speed', 'veh:v', 'CVT_temp']) {
      const c = getChannel(N, key)!;
      const e = channelExtremes(N, key, 0, n - 1)!;
      expect(e.min.v, key).toBe(c.lo);
      expect(e.max.v, key).toBe(c.hi);
      expect(c.data[e.min.i]).toBe(e.min.v);
      expect(c.data[e.max.i]).toBe(e.max.v);
      expect(e.min.t).toBe(N.S.t[e.min.i]);
      expect(e.max.t).toBe(N.S.t[e.max.i]);
    }
    const L = N.laps[0];
    const e = channelExtremes(N, 'gps:speed', L.i0, L.i1)!;
    expect(e.max.i).toBeGreaterThanOrEqual(L.i0);
    expect(e.max.i).toBeLessThanOrEqual(L.i1);
    let mx = -Infinity;
    const d = getChannel(N, 'gps:speed')!.data;
    for (let i = L.i0; i <= L.i1; i++) if (d[i] > mx) mx = d[i];
    expect(e.max.v).toBe(mx);
    /* índices invertidos ou fora: corta */
    expect(channelExtremes(N, 'gps:speed', L.i1, L.i0)).toEqual(e);
    expect(channelExtremes(N, 'gps:speed', -10, n + 10)).toEqual(channelExtremes(N, 'gps:speed', 0, n - 1));
  });
  it('canal inexistente ou sem dado no trecho → null', () => {
    expect(channelExtremes(N, 'nao_existe', 0, n - 1)).toBeNull();
    const S = parseLog(readFixture('busmaster_14.log')!, 'busmaster_14.log');
    const ctx = computeSession(S);
    expect(channelExtremes(ctx, 'GPS · latitude', 0, S.t.length - 1)).toBeNull();
    expect(channelExtremes(ctx, 'PIC · status GPS', 0, S.t.length - 1)!.max.v).toBe(85);
  });
});

describe('resonanceReport: fₙ e ζ por eixo e Olley', () => {
  it('exemplo: igual à ficha e ao road.fnF/fnR', () => {
    const r = resonanceReport(N, 0, n - 1);
    const f = designReport(N, 0, n - 1).facts.drop!;
    expect(r.axles.F.fn).toBe(f.F.fn);
    expect(r.axles.R.fn).toBe(f.R.fn);
    expect(r.axles.F.zeta).toBe(f.F.zeta);
    expect(r.axles.R.zeta).toBe(f.R.zeta);
    expect(r.axles.F.fn).toBe(r.road.fnF);
    expect(r.axles.R.fn).toBe(r.road.fnR);
    expect(r.axles.F.ids).toEqual(['FL', 'FR']);
    expect(r.axles.F.t).toBe(f.t);
    expect(r.axles.F.sensors).toEqual(['shock_fl', 'shock_fr', 'gps']);
    expect(r.axles.R.sensors).toEqual(['shock_rl', 'shock_rr', 'gps']);
    const o = r.olley!;
    expect(o.ratio).toBe(f.R.fn / f.F.fn);
    expect(o.ref).toEqual([1.1, 1.2]);
    expect(o.status).toBe('ok');
    /* a leitura é a da ficha */
    const row = designReport(N, 0, n - 1).rows.find(x => x.item === 'Frequência natural diant. / tras.')!;
    expect(row.read).toBe(o.read);
    expect(o.explain).toBe('susp.naturalFreq');
  });
  it('sem o espectro da pista ainda dá fₙ por eixo (antes só vinha em road)', () => {
    /* trecho curto em volta do teste de queda: sem trechos andando para o espectro */
    const t0 = resonanceReport(N, 0, n - 1).axles.F.t!;
    const i1 = N.S.t.findIndex(t => t > t0 + 4);
    const r = resonanceReport(N, 0, i1);
    expect(r.road.spectrum).toBeNull();
    expect(Number.isNaN(r.road.fnF)).toBe(true);
    expect(r.axles.F.fn).toBeGreaterThan(1);
    expect(r.olley).not.toBeNull();
  });
  it('sem teste de queda / sem amortecedores: NaN e olley null', () => {
    const S = parseLog(readFixture('ft_log3_gps.csv')!, 'ft_log3_gps.csv');
    const ctx = computeSession(S);
    const r = resonanceReport(ctx, 0, S.t.length - 1);
    expect(Number.isNaN(r.axles.F.fn)).toBe(true);
    expect(r.axles.F.sensors).toEqual([]);
    expect(r.olley).toBeNull();
  });
  it('situação e textos (os de "low"/"high" são as recomendações da ficha)', () => {
    expect(olleyStatus(0.9)).toEqual({
      status: 'low', read: 'tras./diant. = 0.90',
      text: 'A traseira está com frequência menor que a dianteira (0.90×). A regra do “flat ride” (Olley) sugere a traseira 10–20 % acima da dianteira, para o carro não “galopar” em lombadas.',
    });
    expect(olleyStatus(1.35)).toMatchObject({ status: 'high', text: 'A traseira está 35 % acima da dianteira em frequência; a referência do “flat ride” é 10–20 %.' });
    expect(olleyStatus(1.15).status).toBe('ok');
    expect(olleyStatus(1.1).status).toBe('ok');
    expect(olleyStatus(1.2).status).toBe('ok');
    expect(olleyStatus(1.05).status).toBe('near');
    expect(olleyStatus(1.25).status).toBe('near');
    expect(olleyStatus(1.3).status).toBe('near');
  });
});

describe('suspensionReport: amortecedor quase parado', () => {
  it('ft_log3_shocks_compact: só RL com sinal, mexendo ~0,2 mm', () => {
    const S = parseLog(readFixture('ft_log3_shocks_compact.csv')!, 'ft_log3_shocks_compact.csv');
    const ctx = computeSession(S);
    const r = suspensionReport(ctx, 0, S.t.length - 1);
    const rl = r.table.rows.find(x => x.id === 'RL')!;
    expect(rl.active).toBe(true);
    expect(rl.still).toBe(true);
    expect(rl.used!).toBeLessThan(SHOCK_STILL_MM);
    expect(r.still!.ids).toEqual(['RL']);
    expect(r.still!.limit).toBe(SHOCK_STILL_MM);
    expect(r.still!.sensors).toEqual(['shock_rl']);
    expect(r.still!.explain).toBe('quality.shockStill');
    expect(r.still!.text).toMatch(/^Amortecedor com sinal mas quase parado \(< 1 mm de curso no trecho\): RL 0\.\d mm\. /);
  });
  it('exemplo: nenhum parado', () => {
    const r = suspensionReport(N, 0, n - 1);
    expect(r.still).toBeNull();
    expect(r.table.rows.every(x => x.still === false)).toBe(true);
  });
});
