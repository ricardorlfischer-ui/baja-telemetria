/* Equivalência do pipeline (normalizeConfig + computeSession + rangeOf) com o recompute()
 * do app antigo: legacyCompute de test/legacy.ts e Analysis.range() de analysisui.js. */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { loadLegacy, legacyCompute, legacyAnalysis, readFixture, LEGACY_DIR, DEMO_CAR as LEGACY_DEMO_CAR, type LegacyState } from './legacy';
import { same } from './compare';
import { parseLog, parseCSV } from '../src/parsers';
import { demoCSV, DEMO_CAR } from '../src/demo';
import { computeSession, normalizeConfig, rangeOf, getChannel, type SessionContext, type AnalysisConfigInput } from '../src/pipeline';
import type { Session } from '../src/types';

const L = loadLegacy({ ui: true });
const { BT } = L;

/* O app antigo (legacy/js/app.js) chama o canal de rugosidade de
 * 'Rugosidade (vel. amortecedores, RMS 1 s)'; a réplica em test/legacy.ts perdeu a vírgula.
 * O porte segue o app.js: o teste confere o nome no app.js e corrige a réplica. */
const ROUGH_NAME = 'Rugosidade (vel. amortecedores, RMS 1 s)';
const APP_JS = readFileSync(path.join(LEGACY_DIR, 'app.js'), 'utf8');
function fixLegacy(O: LegacyState): LegacyState {
  for (const c of O.all) if (c.key === 'susp:rough') c.name = ROUGH_NAME;
  return O;
}

interface Case { label: string; O: LegacyState; N: SessionContext }
const legacyS = (text: string, name: string, demo = false) => { const S = BT.parseLog(text, name); if (demo) S.demo = true; return S; };
const newS = (text: string, name: string, demo = false): Session => { const S = parseLog(text, name); if (demo) S.demo = true; return S; };

function makeCases(): Case[] {
  const out: Case[] = [];
  {
    const So = BT.parseCSV(BT.demoCSV(), 'exemplo_baja.csv'); So.demo = true;
    const Sn = parseCSV(demoCSV(), 'exemplo_baja.csv'); Sn.demo = true;
    out.push({ label: 'exemplo', O: fixLegacy(legacyCompute(BT, So, { car: LEGACY_DEMO_CAR }, { autoLine: true })), N: computeSession(Sn, { car: DEMO_CAR }, { autoLine: true }) });
    const So2 = BT.parseCSV(BT.demoCSV(), 'exemplo_baja.csv'); So2.demo = true;
    const Sn2 = parseCSV(demoCSV(), 'exemplo_baja.csv'); Sn2.demo = true;
    out.push({ label: 'exemplo sem linha', O: fixLegacy(legacyCompute(BT, So2, { car: LEGACY_DEMO_CAR })), N: computeSession(Sn2, { car: DEMO_CAR }) });
  }
  const cfgs: [string, any, boolean][] = [
    ['padrão, linha automática', {}, true],
    ['padrão, sem linha', {}, false],
    ['centro automático', { centerFixed: false }, true],
  ];
  for (const f of ['ft_log3_gps.csv', 'ft_log3_shocks_compact.csv', 'busmaster_14.log', 'Log 3_20261005-1648_20261005-1651.csv']) {
    const text = readFixture(f);
    if (text === null) continue;
    for (const [lab, cfg, auto] of cfgs) {
      out.push({
        label: `${f} · ${lab}`,
        O: fixLegacy(legacyCompute(BT, legacyS(text, f), JSON.parse(JSON.stringify(cfg)), { autoLine: auto })),
        N: computeSession(newS(text, f), JSON.parse(JSON.stringify(cfg)), { autoLine: auto }),
      });
    }
  }
  /* configuração antiga: curso/massa/MR dentro de susp, canais salvos que não existem no log */
  {
    const cfg = { susp: { compPos: false, strokeF: 120, massR: 70, mrF: 1.4 }, car: { mrF: 0, strokeR: 140 }, chX: 'nao_existe', chY: 'O2_General', chStatus: 'xx', minLap: 0, smooth: 1 };
    const So = BT.parseCSV(BT.demoCSV(), 'exemplo_baja.csv'); So.demo = true;
    const Sn = parseCSV(demoCSV(), 'exemplo_baja.csv'); Sn.demo = true;
    out.push({ label: 'exemplo com configuração antiga', O: fixLegacy(legacyCompute(BT, So, JSON.parse(JSON.stringify(cfg)), { autoLine: true })), N: computeSession(Sn, JSON.parse(JSON.stringify(cfg)) as AnalysisConfigInput, { autoLine: true }) });
  }
  return out;
}
const CASES = makeCases();

const CH_FIELDS = ['key', 'name', 'unit', 'group', 'src', 'data', 'lo', 'hi', 'count', 'constant'] as const;
const pickCh = (c: any) => Object.fromEntries(CH_FIELDS.map(k => [k, c[k]]));

describe('pipeline: o nome do canal de rugosidade é o do app.js', () => {
  it('app.js usa o nome com vírgula', () => {
    expect(APP_JS.includes(`'${ROUGH_NAME}'`)).toBe(true);
  });
});

describe.each(CASES.map(c => [c.label, c] as const))('computeSession × legacyCompute: %s', (_l, { O, N }) => {
  it('todos os canais, na mesma ordem e com os mesmos dados', () => {
    expect(N.all.map(c => c.key)).toEqual(O.all.map((c: any) => c.key));
    expect(same(O.all.map(pickCh), N.all.map(pickCh))).toEqual([]);
  });
  it('configuração normalizada', () => {
    expect(same(O.cfg, N.cfg)).toEqual([]);
  });
  it('trajetória, voltas, parado, acelerações e ângulos', () => {
    expect(same(O.track, N.track)).toEqual([]);
    expect(same(O.laps, N.laps)).toEqual([]);
    expect(same(O.stopped, N.stopped)).toEqual([]);
    expect(same(O.acc, N.acc)).toEqual([]);
    expect(same(O.ang, N.ang)).toEqual([]);
  });
  it('suspensão, veículo e dinâmica', () => {
    expect(same(O.susp, N.susp)).toEqual([]);
    expect(same(O.veh, N.veh)).toEqual([]);
    expect(same(O.dyn, N.dyn)).toEqual([]);
    expect(typeof N.veh.Fres).toBe('function');
    for (const v of [0, 3, 8.5, 15]) expect(N.veh.Fres(v)).toBeCloseTo(O.veh.Fres(v), 9);
  });
  it('a sessão (grupos dos canais do log) fica igual', () => {
    expect(same(O.S, N.S)).toEqual([]);
  });
  it('sem fórmulas não há erros de fórmula', () => {
    expect(N.formulaErrors).toEqual([]);
  });
  it('getChannel = A.channel', () => {
    for (const c of O.all) expect(getChannel(N, c.key)!.key).toBe(c.key);
    expect(getChannel(N, 'nao:existe')).toBeUndefined();
  });
  it('rangeOf × Analysis.range() nos 3 modos', () => {
    const t = N.S.t, n = t.length;
    for (const win of ['session', 'lap', 'view'] as const) {
      const sels = [-1, ...N.laps.map((_, k) => k)];
      for (const sel of sels) {
        O.sel = sel;
        const an = legacyAnalysis(L, O, win);
        const views: [number, number][] = [[t[0], t[n - 1]], [t[0] + (t[n - 1] - t[0]) * 0.31, t[0] + (t[n - 1] - t[0]) * 0.47], [t[0] - 5, t[n - 1] + 5]];
        for (const v of views) {
          (O as any).charts.v = { t0: v[0], t1: v[1] };
          expect(rangeOf(N, win, sel, v)).toEqual(an.range());
        }
      }
    }
    O.sel = -1;
    /* 'view' sem janela = sessão inteira */
    (O as any).charts.v = { t0: t[0], t1: t[n - 1] };
    expect(rangeOf(N, 'view', -1)).toEqual(legacyAnalysis(L, O, 'view').range());
  });
});

describe('normalizeConfig', () => {
  it('não altera a configuração recebida', () => {
    const S = parseCSV(demoCSV(), 'x.csv');
    const cfg = { susp: { strokeF: 120 }, car: { mass: 300 } } as AnalysisConfigInput;
    const copy = JSON.parse(JSON.stringify(cfg));
    const N = normalizeConfig(S, cfg);
    expect(cfg).toEqual(copy);
    expect(N.car.strokeF).toBe(120);
    expect('strokeF' in N.susp).toBe(false);
    expect(N.car.mass).toBe(300);
    expect(N.chX).toBe('Back_pressure');
    expect(N.chY).toBe('O2_General');
  });
  it('mantém os canais X/Y salvos se existirem no log', () => {
    const S = parseCSV(demoCSV(), 'x.csv');
    const N = normalizeConfig(S, { chX: 'O2_General', chY: 'Back_pressure' });
    expect([N.chX, N.chY]).toEqual(['O2_General', 'Back_pressure']);
  });
});

describe('fórmulas no pipeline', () => {
  const So = BT.parseCSV(BT.demoCSV(), 'exemplo_baja.csv'); So.demo = true;
  const O = fixLegacy(legacyCompute(BT, So, { car: LEGACY_DEMO_CAR }, { autoLine: true }));
  const Sn = parseCSV(demoCSV(), 'exemplo_baja.csv'); Sn.demo = true;
  const formulas = [
    { id: 'dif', name: 'Diferença FL − FR', unit: 'mm', expr: '[Shock_-_Front_Left] - [Shock_-_Front_Right]' },
    { id: 'ruim', name: 'Com erro', unit: '', expr: '[nao_existe] * 2' },
    { id: 'kmh', name: 'Velocidade GPS em m/s', unit: 'm/s', expr: '[gps:speed] / 3.6' },
    { id: 'dobro', name: 'Dobro da diferença', unit: 'mm', expr: '2 * [f:dif]' },
    { id: 'sint', name: 'Erro de sintaxe', unit: '', expr: '(1 + ' },
  ];
  const N = computeSession(Sn, { car: DEMO_CAR, formulas }, { autoLine: true });
  it('os canais do app antigo continuam iguais, na frente', () => {
    const base = N.all.slice(0, O.all.length);
    expect(same(O.all.map(pickCh), base.map(pickCh))).toEqual([]);
  });
  it('as fórmulas válidas entram no fim, grupo Fórmulas, src formula', () => {
    const extra = N.all.slice(O.all.length);
    expect(extra.map(c => c.key)).toEqual(['f:dif', 'f:kmh', 'f:dobro']);
    extra.forEach(c => { expect(c.group).toBe('Fórmulas'); expect(c.src).toBe('formula'); });
    const fl = getChannel(N, 'Shock_-_Front_Left')!.data, fr = getChannel(N, 'Shock_-_Front_Right')!.data;
    const dif = getChannel(N, 'f:dif')!, dobro = getChannel(N, 'f:dobro')!, sp = getChannel(N, 'gps:speed')!.data;
    for (let i = 0; i < fl.length; i += 97) {
      expect(same(fl[i] - fr[i], dif.data[i])).toEqual([]);
      expect(same(2 * (fl[i] - fr[i]), dobro.data[i])).toEqual([]);
      expect(same(sp[i] / 3.6, getChannel(N, 'f:kmh')!.data[i])).toEqual([]);
    }
    expect(dif.unit).toBe('mm');
    expect(dif.name).toBe('Diferença FL − FR');
  });
  it('as com erro ficam em formulaErrors', () => {
    expect(N.formulaErrors.map(e => e.id)).toEqual(['ruim', 'sint']);
    expect(N.formulaErrors[0].msg).toContain('Canal desconhecido [nao_existe]');
    expect(N.formulaErrors[1].msg).toMatch(/posição \d+/);
  });
});
