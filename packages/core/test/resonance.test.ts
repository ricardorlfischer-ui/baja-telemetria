/* Equivalência do relatório da Ressonância (reports/resonance.ts) com renderFreq + showDrop +
 * showPsd + analyzeManual (legacy/js/analysisui.js) e renderRoadRes (legacy/js/vehicleui.js),
 * rodando a interface antiga com o DOM falso de test/legacy.ts. Os <select> do antigo
 * (frEvent, frPsdMode) são imitados aqui: trocar as opções põe a 1ª como valor, como no
 * navegador, e `options` lista as opções escritas no innerHTML. */
import { describe, it, expect } from 'vitest';
import { loadLegacy, legacyCompute, legacyAnalysis, readFixture, DEMO_CAR as LEGACY_DEMO_CAR, type LegacyState, type FakeEl } from './legacy';
import { same } from './compare';
import { parseLog, parseCSV } from '../src/parsers';
import { demoCSV, DEMO_CAR } from '../src/demo';
import { dropTests } from '../src/analysis';
import { computeSession, rangeOf, type SessionContext, type AnalysisConfigInput } from '../src/pipeline';
import { resonanceReport, type ResonanceOptions, type ResonanceReport, type ResEventValue } from '../src/reports/resonance';
import type { SuspPlot } from '../src/reports/suspension';
import { SENSORS } from '../src/sensors';
import { EXPLAIN_AREAS } from '../src/explain';

const L = loadLegacy({ ui: true });
const { BT } = L;

/* ------------------------------------------------------------------ HTML antigo → texto */
const decode = (s: string) => s.replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const tableRows = (html: string): string[][] =>
  [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(m => [...m[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map(c => decode(c[1])));
const afterTable = (html: string) => decode(html.includes('</table>') ? html.slice(html.lastIndexOf('</table>') + 8) : html);
const IGN = ['color', 'colors', 'id', 'role', 'roles', 'key', 'title', 'explain', 'sensors'];

/** <select> falso: innerHTML novo → valor = 1ª opção; options = opções do innerHTML. */
const parseOptions = (html: string) => [...html.matchAll(/<option value="([^"]*)">([^<]*)<\/option>/g)].map(m => ({ value: m[1], text: decode(m[2]) }));
function selectify(e: FakeEl): void {
  let html = '';
  Object.defineProperty(e, 'innerHTML', {
    get: () => html,
    set: (v: string) => { html = v; const o = parseOptions(v); e.value = o.length ? o[0].value : ''; },
    configurable: true,
  });
  Object.defineProperty(e, 'options', { get: () => parseOptions(html), configurable: true });
}
const evValue = (v: ResEventValue) => (v === null ? '' : v === 'manual' ? 'm' : String(v));

/* ------------------------------------------------------------------ sessões */
interface Case { label: string; O: LegacyState; N: SessionContext }
function makeCases(): Case[] {
  const out: Case[] = [];
  const demo = (label: string, cfg: any, keep: (k: string) => boolean = () => true) => {
    const So = BT.parseCSV(BT.demoCSV(), 'exemplo_baja.csv'); So.demo = true;
    const Sn = parseCSV(demoCSV(), 'exemplo_baja.csv'); Sn.demo = true;
    So.channels = So.channels.filter((c: any) => keep(c.key)); Sn.channels = Sn.channels.filter(c => keep(c.key));
    out.push({
      label,
      O: legacyCompute(BT, So, JSON.parse(JSON.stringify(cfg.legacy ?? cfg)), { autoLine: true }),
      N: computeSession(Sn, JSON.parse(JSON.stringify(cfg.ported ?? cfg)) as AnalysisConfigInput, { autoLine: true }),
    });
  };
  demo('exemplo', { legacy: { car: LEGACY_DEMO_CAR }, ported: { car: DEMO_CAR } });
  demo('exemplo sem roda', { car: DEMO_CAR }, k => k !== 'Wheel_speed');
  demo('exemplo sem GPS', { car: DEMO_CAR }, k => k !== 'O2_General' && k !== 'Back_pressure');
  demo('exemplo só FL e RL, sem vel. da FT, sem MR', { car: { ...DEMO_CAR, mrF: 0, mrR: 0 } }, k => !/Right|velocity/.test(k));
  demo('exemplo só a frente, sem massa, banda 1–3 Hz', { susp: { compPos: false, fmin: 1, fmax: 3 } }, k => !/Rear|_R[LR]$/.test(k));
  demo('exemplo sem amortecedores', { car: DEMO_CAR }, k => !/Shock/i.test(k));
  for (const f of ['ft_log3_gps.csv', 'ft_log3_shocks_compact.csv', 'busmaster_14.log', 'Log 3_20261005-1648_20261005-1651.csv']) {
    const text = readFixture(f);
    if (text === null) continue;
    out.push({ label: f, O: legacyCompute(BT, BT.parseLog(text, f), {}, { autoLine: true }), N: computeSession(parseLog(text, f), {}, { autoLine: true }) });
  }
  return out;
}
const CASES = makeCases();

interface Win { label: string; win: 'session' | 'lap' | 'view'; sel: number; view?: [number, number]; full: boolean }
function windows(N: SessionContext): Win[] {
  const t = N.S.t, n = t.length, T0 = t[0], T1 = t[n - 1];
  const out: Win[] = [{ label: 'sessão', win: 'session', sel: -1, full: true }];
  N.laps.slice(0, 6).forEach((l, k) => out.push({ label: `volta ${l.n}`, win: 'lap', sel: k, full: k === 0 }));
  out.push({ label: 'janela do meio', win: 'view', sel: -1, view: [T0 + (T1 - T0) / 3, T0 + 2 * (T1 - T0) / 3], full: false });
  out.push({ label: 'janela 30 s', win: 'view', sel: -1, view: [T0 + (T1 - T0) * 0.2, T0 + (T1 - T0) * 0.2 + 30], full: false });
  out.push({ label: 'janela 3 s', win: 'view', sel: -1, view: [T0 + (T1 - T0) * 0.5, T0 + (T1 - T0) * 0.5 + 3], full: false });
  /* começo do log (com o 1º teste de queda) + 70/120 s andando: no exemplo, os cortes
   * devagar × rápido caem nos 40/60 % (a 1ª tentativa, terços, não dá 2 segmentos) */
  out.push({ label: 'começo + 70 s', win: 'view', sel: -1, view: [T0, T0 + 70], full: false });
  out.push({ label: 'começo + 120 s', win: 'view', sel: -1, view: [T0, T0 + 120], full: true });
  return out;
}
/** Combinações de opções (evento, trecho manual, modo do espectro). */
function optionSets(N: SessionContext, w: Win): ResonanceOptions[] {
  const out: ResonanceOptions[] = [{}];
  if (!w.full) return out;
  const t = N.S.t, n = t.length;
  const ev = dropTests(t, N.susp.shocks, N.stopped, 0, n - 1);
  const manuals: [number, number][] = [];
  if (ev[0]) manuals.push([ev[0].t - 0.3, ev[0].t + 2.5]);
  manuals.push([t[n >> 1], t[n >> 1] + 4]);
  ev.slice(0, 3).forEach((_, k) => out.push({ dropIndex: k }));
  out.push({ dropIndex: 99 }, { dropIndex: 'manual' });
  manuals.forEach(m => out.push({ manual: m }, { manual: m, dropIndex: 0 }, { manual: m, dropIndex: 'manual', psdMode: 'FL' }));
  ['FL', 'FR', 'RL', 'RR', 'XX'].forEach(m => out.push({ psdMode: m }, { psdMode: m, dropIndex: 1 }));
  return out;
}
const optLabel = (o: ResonanceOptions) => JSON.stringify(o);

/** Roda a interface antiga: (analyzeManual) + renderFreq com as escolhas nos <select>. */
function runLegacy(O: LegacyState, w: Win, o: ResonanceOptions) {
  L.els.clear();
  selectify(L.el('frEvent')); selectify(L.el('frPsdMode'));
  const an = legacyAnalysis(L, O, w.win);
  O.sel = w.sel;
  const v = w.view ? { t0: w.view[0], t1: w.view[1] } : { t0: O.S.t[0], t1: O.S.t[O.S.t.length - 1] };
  if (o.manual) { (O as any).charts = { v: { t0: o.manual[0], t1: o.manual[1] } }; an.analyzeManual(); }
  (O as any).charts = { v };
  L.el('frEvent').value = o.dropIndex === undefined ? '' : evValue(o.dropIndex);
  L.el('frPsdMode').value = o.psdMode ?? '';
  an.renderFreq();
  return an;
}

function compare(O: LegacyState, N: SessionContext, w: Win, o: ResonanceOptions): { rep: ResonanceReport; diffs: string[] } {
  const an = runLegacy(O, w, o);
  const [i0, i1] = rangeOf(N, w.win, w.sel, w.view);
  expect([i0, i1]).toEqual(an.range().slice(0, 2));
  const rep = resonanceReport(N, i0, i1, o);
  const d: string[] = [];
  const chk = (what: string, a: unknown, b: unknown) => { const r = same(a, b); if (r.length) d.push(`${what}: ${r.slice(0, 5).join(' | ')}`); };
  const plot = (what: string, a: unknown, p: SuspPlot) => { const r = same(a, p, { ignore: IGN }); if (r.length) d.push(`${what}: ${r.slice(0, 5).join(' | ')}`); };
  chk('frContent.hidden', L.el('frContent').hidden, !rep.hasShocks);
  chk('rrBox.hidden', L.el('rrBox').hidden, !rep.hasShocks);
  if (!rep.hasShocks) {
    chk('estado vazio', decode(L.el('frBody').innerHTML), rep.empty);
    return { rep, diffs: d };
  }
  chk('frBody', L.el('frBody').innerHTML, '');
  /* eventos */
  chk('eventos', an.events, rep.events);
  chk('trecho manual', an.manual ?? null, rep.manual);
  const fe = L.el('frEvent');
  chk('opções do evento', (fe as any).options, rep.eventOptions.map(x => ({ value: evValue(x.value), text: x.label })));
  chk('evento selecionado', fe.value, evValue(rep.selected));
  /* teste de queda */
  const dh = L.el('frDrop').innerHTML;
  if (rep.drop.message) chk('frDrop (sem evento)', decode(dh), rep.drop.message);
  else {
    const rows = tableRows(dh);
    chk('frDrop: cabeçalho', rows[0], rep.drop.columns.map(c => c.label));
    chk('frDrop: linhas', rows.slice(1), rep.drop.rows.map(r => r.cells));
  }
  plot('frDropPlot', L.el('frDropPlot').plot, rep.drop.plot);
  /* espectro */
  const fm = L.el('frPsdMode');
  chk('opções do espectro', (fm as any).options, rep.psd.modeOptions.map(x => ({ value: x.value, text: x.label })));
  chk('modo do espectro', fm.value, rep.psd.mode);
  chk('espectros', an.psd, rep.psd.spectra);
  chk('vlo/vhi', [an.vlo, an.vhi], [rep.psd.vlo, rep.psd.vhi]);
  plot('frPsd', L.el('frPsd').plot, rep.psd.plot);
  const pr = tableRows(L.el('frPeaks').innerHTML);
  chk('picos: cabeçalho', pr[0], rep.peaks.columns.map(c => c.label));
  chk('picos: linhas', pr.slice(1), rep.peaks.rows.map(r => r.cells));
  chk('frNote', decode(L.el('frNote').innerHTML), rep.note.text);
  /* pista × ressonância */
  const rr = L.el('rrTable').innerHTML;
  if (rep.road.message) chk('rrTable (sem dados)', decode(rr), rep.road.message);
  else {
    const rows = tableRows(rr);
    chk('rrTable: cabeçalho', rows[0], rep.road.columns.map(c => c.label));
    chk('rrTable: linhas', rows.slice(1), rep.road.rows.map(r => r.cells));
    chk('rrTable: nota', afterTable(rr), rep.road.note);
  }
  plot('rrPlot', L.el('rrPlot').plot, rep.road.plot);
  return { rep, diffs: d };
}

/* ------------------------------------------------------------------ testes */
describe.each(CASES.map(c => [c.label, c] as const))('resonanceReport × renderFreq/showDrop/showPsd/renderRoadRes: %s', (_l, { O, N }) => {
  for (const w of windows(N)) {
    it(`trecho ${w.label}`, () => {
      const bad: string[] = [];
      for (const o of optionSets(N, w)) {
        const { diffs } = compare(O, N, w, o);
        if (diffs.length) bad.push(`${optLabel(o)} → ${diffs.join(' || ')}`);
      }
      expect(bad).toEqual([]);
    });
  }
});

/* ------------------------------------------------------------------ explicações e sensores */
function walk(o: unknown, fn: (k: string, v: unknown) => void, seen = new Set<unknown>()): void {
  if (!o || typeof o !== 'object' || seen.has(o) || ArrayBuffer.isView(o)) return;
  seen.add(o);
  for (const [k, v] of Object.entries(o as object)) { fn(k, v); walk(v, fn, seen); }
}
const AREAS = new Set<string>(EXPLAIN_AREAS);

describe('resonanceReport: explicações e sensores', () => {
  const byLabel = (l: string) => CASES.find(c => c.label === l)!.N;
  it('todo explain é <área>.<item> e todo sensor existe', () => {
    const ids = new Set<string>();
    for (const { N } of CASES) {
      const rep = resonanceReport(N, 0, N.S.t.length - 1, { psdMode: 'FL' });
      walk(rep, (k, v) => {
        if (k === 'explain' && v !== undefined) {
          const [area, item] = String(v).split('.');
          expect(AREAS.has(area) && /^[a-zA-Z0-9]+$/.test(item)).toBe(true);
          ids.add(String(v));
        }
        if (k === 'sensors' || k === 'emptySensors') {
          expect(Array.isArray(v)).toBe(true);
          for (const s of v as string[]) expect(Object.hasOwn(SENSORS, s)).toBe(true);
          expect(new Set(v as string[]).size).toBe((v as string[]).length);
        }
      });
    }
    expect([...ids].sort()).toEqual([
      'freq.criticalSpeed', 'freq.dropTest', 'freq.peaks', 'freq.roadWavelength', 'freq.sampleRate', 'freq.spectrum', 'freq.speedSplit',
      'susp.dampingCoeff', 'susp.naturalFreq', 'susp.rideRate',
    ]);
  });
  it('exemplo: queda pelos 4 amortecedores + GPS parado + dados do carro; pista pela roda', () => {
    const N = byLabel('exemplo'), rep = resonanceReport(N, 0, N.S.t.length - 1);
    expect(rep.events.length).toBeGreaterThan(0);
    expect(rep.selected).toBe(0);
    expect(rep.drop.sensors).toEqual(['shock_fl', 'gps', 'car_data', 'shock_fr', 'shock_rl', 'shock_rr']);
    expect(rep.drop.rows[0].fn!.toFixed(2)).toBe('1.61');
    expect(rep.road.plot.sensors).toEqual(['shock_fl', 'shock_fr', 'shock_rl', 'shock_rr', 'wheel', 'gps']);
    expect(rep.road.rows.some(r => r.lambda.toFixed(1) === '3.2')).toBe(true);
    expect(rep.note.sensors[0]).toBe('logger');
  });
  it('sem MR: sem c no amortecedor; sem massa: "informe a massa" e sem car_data', () => {
    const a = resonanceReport(byLabel('exemplo só FL e RL, sem vel. da FT, sem MR'), 0, byLabel('exemplo só FL e RL, sem vel. da FT, sem MR').S.t.length - 1);
    const okRow = a.drop.rows.find(r => r.ok)!;
    expect(okRow.cells[7]).toBe('—');
    expect(okRow.sensors).toContain('car_data');
    const Nb = byLabel('exemplo só a frente, sem massa, banda 1–3 Hz'), b = resonanceReport(Nb, 0, Nb.S.t.length - 1);
    const r = b.drop.rows.find(x => x.ok);
    if (r) { expect(r.cells[5]).toBe('informe a massa'); expect(r.sensors).not.toContain('car_data'); }
    expect(b.band).toEqual({ fmin: 1, fmax: 3 });
  });
  it('trecho manual: selecionado, sem a máscara "parado" nos sensores', () => {
    const N = byLabel('exemplo'), t = N.S.t;
    const ev = dropTests(t, N.susp.shocks, N.stopped, 0, t.length - 1)[0];
    const rep = resonanceReport(N, 0, t.length - 1, { manual: [ev.t - 0.3, ev.t + 2.5] });
    expect(rep.selected).toBe(0);
    const m = resonanceReport(N, 0, t.length - 1, { manual: [ev.t - 0.3, ev.t + 2.5], dropIndex: 'manual' });
    expect(m.selected).toBe('manual');
    expect(m.drop.t).toBeNull();
    expect(m.drop.plot.sensors).toEqual(['shock_fl', 'shock_fr', 'shock_rl', 'shock_rr']);
    expect(m.eventOptions.at(-1)!.label).toMatch(/^Trecho do gráfico · /);
  });
});
