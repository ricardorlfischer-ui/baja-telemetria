/* Equivalência do relatório da Suspensão (reports/suspension.ts) com renderSusp +
 * renderSuspExtra do app antigo (legacy/js/analysisui.js e vehicleui.js), rodando a
 * interface antiga com o DOM falso de test/legacy.ts: o que ela escreveu nos elementos
 * (tabelas, notas, títulos) é comparado célula a célula com o texto do relatório, e os
 * specs mandados para o BT.Plot (el(id).plot) com os gráficos do relatório (same()). */
import { describe, it, expect } from 'vitest';
import { loadLegacy, legacyCompute, legacyAnalysis, readFixture, DEMO_CAR as LEGACY_DEMO_CAR, type LegacyState } from './legacy';
import { same } from './compare';
import { parseLog, parseCSV } from '../src/parsers';
import { demoCSV, DEMO_CAR } from '../src/demo';
import { computeSession, rangeOf, type SessionContext, type AnalysisConfigInput } from '../src/pipeline';
import { suspensionReport, type SuspPlot, type SuspensionReport } from '../src/reports/suspension';
import { SENSORS } from '../src/sensors';
import { EXPLAIN_AREAS } from '../src/explain';

const L = loadLegacy({ ui: true });
const { BT } = L;

/* ------------------------------------------------------------------ HTML antigo → texto */
const decode = (s: string) => s.replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
/** Linhas de <table> como listas do texto de cada célula. */
const tableRows = (html: string): string[][] =>
  [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(m => [...m[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map(c => decode(c[1])));
const afterTable = (html: string) => decode(html.includes('</table>') ? html.slice(html.lastIndexOf('</table>') + 8) : html);
const elText = (id: string) => { const e = L.el(id); return e.innerHTML ? decode(e.innerHTML) : e.textContent; };

/** Spec do relatório sem os campos que o antigo não tem (ids/papéis/explicações). */
const IGN = ['color', 'colors', 'id', 'role', 'roles', 'key', 'title', 'explain', 'sensors'];
const cmpPlot = (legacySpec: unknown, p: SuspPlot) => same(legacySpec, p, { ignore: IGN });

/* ------------------------------------------------------------------ sessões */
interface Case { label: string; O: LegacyState; N: SessionContext }
function makeCases(): Case[] {
  const out: Case[] = [];
  const demo = (label: string, cfg: any, keep: (k: string) => boolean = () => true, autoLine = true) => {
    const So = BT.parseCSV(BT.demoCSV(), 'exemplo_baja.csv'); So.demo = true;
    const Sn = parseCSV(demoCSV(), 'exemplo_baja.csv'); Sn.demo = true;
    So.channels = So.channels.filter((c: any) => keep(c.key)); Sn.channels = Sn.channels.filter(c => keep(c.key));
    out.push({
      label,
      O: legacyCompute(BT, So, JSON.parse(JSON.stringify(cfg.legacy ?? cfg)), { autoLine }),
      N: computeSession(Sn, JSON.parse(JSON.stringify(cfg.ported ?? cfg)) as AnalysisConfigInput, { autoLine }),
    });
  };
  demo('exemplo', { legacy: { car: LEGACY_DEMO_CAR }, ported: { car: DEMO_CAR } });
  demo('exemplo sem roda', { car: DEMO_CAR }, k => k !== 'Wheel_speed');
  demo('exemplo sem GPS', { car: DEMO_CAR }, k => k !== 'O2_General' && k !== 'Back_pressure');
  demo('exemplo só FL e RL, sem vel. da FT', { car: { ...DEMO_CAR, mrF: 0 } }, k => !/Right|velocity/.test(k));
  demo('exemplo só a frente, compressão invertida', { susp: { compPos: false, strokeF: 120 } }, k => !/Rear|_R[LR]$/.test(k));
  demo('exemplo sem curso, todas as amostras, joelho 50', { car: { ...DEMO_CAR, strokeF: 0, strokeR: 0 }, susp: { moving: false, knee: 50 } });
  demo('exemplo só curso traseiro, roda livre', { car: { ...DEMO_CAR, strokeF: 0, wheelDriven: false } });
  demo('exemplo sem amortecedores', { car: DEMO_CAR }, k => !/Shock/i.test(k));
  for (const f of ['ft_log3_gps.csv', 'ft_log3_shocks_compact.csv', 'busmaster_14.log', 'Log 3_20261005-1648_20261005-1651.csv']) {
    const text = readFixture(f);
    if (text === null) continue;
    out.push({ label: f, O: legacyCompute(BT, BT.parseLog(text, f), {}, { autoLine: true }), N: computeSession(parseLog(text, f), {}, { autoLine: true }) });
  }
  return out;
}
const CASES = makeCases();

/* trechos como Analysis.range(): sessão, cada volta (até 6), janelas do gráfico */
interface Win { label: string; win: 'session' | 'lap' | 'view'; sel: number; view?: [number, number] }
function windows(N: SessionContext): Win[] {
  const t = N.S.t, n = t.length, T0 = t[0], T1 = t[n - 1];
  const out: Win[] = [{ label: 'sessão', win: 'session', sel: -1 }, { label: 'volta sem seleção', win: 'lap', sel: -1 }];
  N.laps.slice(0, 6).forEach((l, k) => out.push({ label: `volta ${l.n}`, win: 'lap', sel: k }));
  out.push({ label: 'janela do meio', win: 'view', sel: -1, view: [T0 + (T1 - T0) / 3, T0 + 2 * (T1 - T0) / 3] });
  out.push({ label: 'janela 30 s', win: 'view', sel: -1, view: [T0 + (T1 - T0) * 0.2, T0 + (T1 - T0) * 0.2 + 30] });
  out.push({ label: 'janela 1 s', win: 'view', sel: -1, view: [T0 + (T1 - T0) * 0.5, T0 + (T1 - T0) * 0.5 + 1] });
  return out;
}

/** Roda a interface antiga no trecho e devolve os elementos que ela escreveu. */
function runLegacy(O: LegacyState, w: Win) {
  L.els.clear();
  const an = legacyAnalysis(L, O, w.win);
  O.sel = w.sel;
  (O as any).charts = { v: w.view ? { t0: w.view[0], t1: w.view[1] } : { t0: O.S.t[0], t1: O.S.t[O.S.t.length - 1] } };
  an.renderSusp();
  return an;
}

function compare(O: LegacyState, N: SessionContext, w: Win): { rep: SuspensionReport; diffs: string[] } {
  const an = runLegacy(O, w);
  const [i0, i1] = rangeOf(N, w.win, w.sel, w.view);
  const [a0, a1] = an.range();
  expect([i0, i1]).toEqual([a0, a1]);
  const rep = suspensionReport(N, i0, i1);
  const d: string[] = [];
  const chk = (what: string, a: unknown, b: unknown) => { const r = same(a, b); if (r.length) d.push(`${what}: ${r.slice(0, 5).join(' | ')}`); };
  const plot = (what: string, a: unknown, p: SuspPlot) => { const r = cmpPlot(a, p); if (r.length) d.push(`${what}: ${r.slice(0, 5).join(' | ')}`); };
  chk('spPlots.hidden', L.el('spPlots').hidden, !rep.hasShocks);
  chk('spExtra.hidden', L.el('spExtra').hidden, !rep.hasShocks);
  const body = L.el('spBody').innerHTML;
  if (!rep.hasShocks) {
    chk('estado vazio', decode(body), rep.empty);
    return { rep, diffs: d };
  }
  /* tabela por canto */
  const rows = tableRows(body);
  chk('cabeçalho', rows[0], rep.table.columns.map(c => c.label));
  chk('linhas', rows.slice(1), rep.table.rows.map(r => r.cells));
  chk('nota da tabela', afterTable(body), rep.table.note);
  /* histogramas */
  const vt = [...L.el('spVel').innerHTML.matchAll(/<h4>([\s\S]*?)<\/h4>/g)].map(m => decode(m[1]));
  chk('títulos vel.', vt, rep.velHist.map(p => p.title));
  const pt = [...L.el('spPos').innerHTML.matchAll(/<h4>([\s\S]*?)<\/h4>/g)].map(m => decode(m[1]));
  chk('títulos curso', pt, rep.posHist.map(p => p.title));
  rep.velHist.forEach(p => plot(p.key, L.el(p.key).plot, p));
  rep.posHist.forEach(p => plot(p.key, L.el(p.key).plot, p));
  /* rolagem e arfagem */
  chk('grNote', L.el('grNote').textContent, rep.body.note);
  chk('grRollT', elText('grRollT'), rep.body.rollTitle);
  chk('grPitchT', elText('grPitchT'), rep.body.pitchTitle);
  plot('grRoll', L.el('grRoll').plot, rep.body.rollPlot);
  plot('grPitch', L.el('grPitch').plot, rep.body.pitchPlot);
  chk('gradientes', an.grad, rep.body.gradients);
  /* saltos e fim de curso */
  const jp = L.el('jpTable').innerHTML;
  const jr = tableRows(jp);
  if (rep.jumps.rows.length) {
    chk('saltos: cabeçalho', jr[0], rep.jumps.columns.map(c => c.label));
    chk('saltos: linhas', jr.slice(1), rep.jumps.rows.map(r => r.cells));
    chk('saltos: tempo (ir ao salto)', [...jp.matchAll(/data-t="([^"]*)"/g)].map(m => +m[1]), rep.jumps.rows.map(r => r.t));
    chk('saltos: lista', an.jumpList, rep.jumps.list);
    chk('fim de curso', afterTable(jp), rep.bottom.text);
  } else {
    chk('sem saltos', jr.length, 0);
    chk('sem saltos: texto', decode(jp), (rep.jumps.none ?? '') + rep.bottom.text);
  }
  return { rep, diffs: d };
}

/* ------------------------------------------------------------------ testes */
describe.each(CASES.map(c => [c.label, c] as const))('suspensionReport × renderSusp/renderSuspExtra: %s', (_l, { O, N }) => {
  it.each(windows(N).map(w => [w.label, w] as const))('trecho %s', (_w, w) => {
    const { diffs } = compare(O, N, w);
    expect(diffs).toEqual([]);
  });
  it('os amortecedores ficam com o mesmo ext/thr que o antigo (jumps altera os objetos)', () => {
    expect(same(O.susp.shocks.map((k: any) => [k.ext, k.thr]), N.susp.shocks.map(k => [k.ext, k.thr]))).toEqual([]);
  });
});

/* ------------------------------------------------------------------ explicações e sensores */
function walk(o: unknown, fn: (k: string, v: unknown) => void, seen = new Set<unknown>()): void {
  if (!o || typeof o !== 'object' || seen.has(o) || ArrayBuffer.isView(o)) return;
  seen.add(o);
  for (const [k, v] of Object.entries(o as object)) { fn(k, v); walk(v, fn, seen); }
}
const AREAS = new Set<string>(EXPLAIN_AREAS);
const SUSP_EXPLAIN_IDS = new Set<string>();

describe('suspensionReport: explicações e sensores', () => {
  it('todo explain é <área>.<item> e todo sensor existe', () => {
    for (const { N } of CASES) {
      const rep = suspensionReport(N, 0, N.S.t.length - 1);
      walk(rep, (k, v) => {
        if (k === 'explain' && v !== undefined) {
          expect(typeof v).toBe('string');
          const [area, item] = String(v).split('.');
          expect(AREAS.has(area) && /^[a-zA-Z0-9]+$/.test(item)).toBe(true);
          SUSP_EXPLAIN_IDS.add(String(v));
        }
        if (k === 'sensors' || k === 'emptySensors' || k === 'noteSensors') {
          expect(Array.isArray(v)).toBe(true);
          for (const s of v as string[]) expect(Object.hasOwn(SENSORS, s)).toBe(true);
          expect(new Set(v as string[]).size).toBe((v as string[]).length);
        }
      });
    }
    expect([...SUSP_EXPLAIN_IDS].sort()).toEqual([
      'susp.bottomOut', 'susp.cornerTable', 'susp.jumps', 'susp.pitchGradient', 'susp.reboundRatio', 'susp.rollGradient',
      'susp.staticHeight', 'susp.travelHistogram', 'susp.travelUsed', 'susp.velocityBands', 'susp.velocityHistogram', 'susp.velocityP95',
    ]);
  });

  const byLabel = (l: string) => CASES.find(c => c.label === l)!.N;
  it('exemplo: estático pelo GPS parado, curso informado, acelerações pela roda + GPS', () => {
    const N = byLabel('exemplo'), rep = suspensionReport(N, 0, N.S.t.length - 1);
    expect(rep.hasShocks).toBe(true);
    const fl = rep.table.rows.find(r => r.id === 'FL')!;
    expect(fl.staticFromStop).toBe(true);
    expect(fl.sensors).toEqual(['shock_fl', 'gps', 'car_data']);
    expect(rep.body.rollPlot.sensors).toEqual(['shock_fl', 'shock_fr', 'shock_rl', 'shock_rr', 'wheel', 'gps', 'car_data']);
    expect(rep.body.pitchPlot.sensors).toContain('wheel');
    expect(rep.bottom.sensors).toEqual(['shock_fl', 'shock_fr', 'shock_rl', 'shock_rr', 'car_data']);
    expect(rep.velHist.map(p => p.sensors)).toEqual([['shock_fl', 'gps'], ['shock_fr', 'gps'], ['shock_rl', 'gps'], ['shock_rr', 'gps']]);
  });
  it('sem GPS: parado pela roda, sem aceleração lateral (rolagem vazia), sem gps nos saltos', () => {
    const N = byLabel('exemplo sem GPS'), rep = suspensionReport(N, 0, N.S.t.length - 1);
    expect(rep.table.rows.every(r => !r.sensors.includes('gps'))).toBe(true);
    expect(rep.velHist[0].sensors).toEqual(['shock_fl', 'wheel']);
    expect(rep.body.rollPlot.empty).toBeTruthy();
    expect(rep.jumps.sensors).not.toContain('gps');
  });
  it('sem roda: velocidade e acelerações só pelo GPS', () => {
    const N = byLabel('exemplo sem roda'), rep = suspensionReport(N, 0, N.S.t.length - 1);
    expect(rep.body.noteSensors).toEqual(['gps', 'car_data']);
    expect(rep.jumps.sensors).not.toContain('wheel');
  });
  it('sem amortecedores: estado vazio com a frase do antigo', () => {
    const N = byLabel('exemplo sem amortecedores'), rep = suspensionReport(N, 0, N.S.t.length - 1);
    expect(rep.hasShocks).toBe(false);
    expect(rep.empty).toBe('Nenhum amortecedor com sinal neste trecho/log. Nenhum canal com “Shock”, “amort” ou “susp” no nome.');
  });
});
