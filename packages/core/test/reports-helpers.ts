/* Apoio dos testes de equivalência dos relatórios (powertrain, cvt, dynamics, laps, maps):
 * monta as mesmas sessões no app antigo (legacyCompute) e no novo (computeSession), roda os
 * render*() antigos com o DOM falso de legacy.ts e extrai o que eles escreveram (texto dos
 * blocos e tabelas, specs dos gráficos) para comparar com os relatórios. */
import { expect } from 'vitest';
import { loadLegacy, legacyCompute, legacyAnalysis, readFixture, DEMO_CAR as LEGACY_DEMO_CAR, type LegacyState, type FakeEl } from './legacy';
import { same } from './compare';
import { parseLog, parseCSV } from '../src/parsers';
import { demoCSV, DEMO_CAR } from '../src/demo';
import { DEFAULT_CAR } from '../src/vehicle';
import { computeSession, rangeOf, type SessionContext, type RangeMode } from '../src/pipeline';
import { SENSORS } from '../src/sensors';
import { EXPLAIN_AREAS } from '../src/explain';
import { fmtRep, type RepPlot, type RepFmt } from '../src/reports/powertrain';
import type { Session } from '../src/types';

export const L = loadLegacy({ ui: true });
export const BT = L.BT;

/* ------------------------------------------------------------------ sessões */
export interface Case { label: string; O: LegacyState; N: SessionContext }

/** Exemplo, variações do exemplo tirando sensores (sem roda, sem GPS, roda livre sem CVT, só
 *  a frente com outro carro, sem CVT) e os fixtures (mais o log grande, se existir). */
export function makeCases(opts: { fixtures?: boolean } = {}): Case[] {
  const out: Case[] = [];
  const variants: [string, (k: string) => boolean, any][] = [
    ['exemplo', () => true, { car: DEMO_CAR }],
    ['exemplo sem roda', k => k !== 'Wheel_speed', { car: DEMO_CAR }],
    ['exemplo sem GPS', k => k !== 'O2_General' && k !== 'Back_pressure', { car: DEMO_CAR }],
    ['exemplo só a frente', k => !/Rear|_R[LR]$/.test(k), { car: DEFAULT_CAR, susp: { compPos: false, strokeF: 120 } }],
    ['exemplo roda livre, sem CVT', k => k !== 'CVT_temp', { car: { ...DEMO_CAR, wheelDriven: false } }],
    ['exemplo sem roda nem GPS', k => !['Wheel_speed', 'O2_General', 'Back_pressure'].includes(k), { car: DEMO_CAR }],
  ];
  for (const [label, keep, cfg] of variants) {
    const So = BT.parseCSV(BT.demoCSV(), 'exemplo_baja.csv'); So.demo = true;
    const Sn: Session = parseCSV(demoCSV(), 'exemplo_baja.csv'); Sn.demo = true;
    So.channels = So.channels.filter((c: any) => keep(c.key)); Sn.channels = Sn.channels.filter(c => keep(c.key));
    const cfgO = label === 'exemplo' ? { car: LEGACY_DEMO_CAR } : JSON.parse(JSON.stringify(cfg));
    out.push({ label, O: legacyCompute(BT, So, cfgO, { autoLine: true }), N: computeSession(Sn, JSON.parse(JSON.stringify(cfg)), { autoLine: true }) });
  }
  if (opts.fixtures !== false) {
    for (const f of ['ft_log3_gps.csv', 'ft_log3_shocks_compact.csv', 'busmaster_14.log', 'Log 3_20261005-1648_20261005-1651.csv']) {
      const text = readFixture(f);
      if (text === null) continue;
      out.push({ label: f, O: legacyCompute(BT, BT.parseLog(text, f), {}, { autoLine: true }), N: computeSession(parseLog(text, f), {}, { autoLine: true }) });
    }
  }
  return out;
}

/** Trechos como a aba antiga: sessão, cada volta (até 6), 'lap' sem volta, duas janelas. */
export interface Win { label: string; win: RangeMode; sel: number; view: [number, number] | null }
export function windows(N: SessionContext): Win[] {
  const t = N.S.t, n = t.length, out: Win[] = [{ label: 'sessão', win: 'session', sel: -1, view: null }];
  N.laps.slice(0, 6).forEach((l, k) => out.push({ label: `volta ${l.n}`, win: 'lap', sel: k, view: null }));
  out.push({ label: 'volta (nenhuma)', win: 'lap', sel: -1, view: null });
  const T0 = t[0], T1 = t[n - 1];
  out.push({ label: 'janela do meio', win: 'view', sel: -1, view: [T0 + (T1 - T0) / 3, T0 + 2 * (T1 - T0) / 3] });
  out.push({ label: 'janela 30 s', win: 'view', sel: -1, view: [T0 + (T1 - T0) * 0.2, T0 + (T1 - T0) * 0.2 + 30] });
  return out;
}
export const newRange = (N: SessionContext, w: Win) => rangeOf(N, w.win, w.sel, w.view ?? undefined);

/** Roda um render*() antigo com o trecho pedido, num DOM limpo. prep roda antes (seletores). */
export function runLegacy(O: LegacyState, fn: string, w: Win, prep?: (an: any) => void): any {
  L.els.clear();
  const t = O.S.t;
  O.sel = w.sel;
  (O as any).charts = { v: w.view ? { t0: w.view[0], t1: w.view[1] } : { t0: t[0], t1: t[t.length - 1] } };
  const an = legacyAnalysis(L, O, w.win);
  prep?.(an);
  an[fn]();
  return an;
}

/** <select> falso: innerHTML vira opções, o valor passa a ser o da 1ª (como no navegador). */
export function selectify(el: FakeEl, raw?: string): void {
  let html = '', val = '', opts: { value: string; text: string }[] = [];
  Object.defineProperty(el, 'innerHTML', {
    configurable: true, get: () => html,
    set: (h: string) => { html = h; opts = [...h.matchAll(/<option value="([^"]*)">([\s\S]*?)<\/option>/g)].map(m => ({ value: m[1], text: m[2] })); val = opts.length ? opts[0].value : ''; },
  });
  Object.defineProperty(el, 'options', { configurable: true, get: () => opts });
  Object.defineProperty(el, 'value', { configurable: true, get: () => val, set: (v: string) => { val = opts.some(o => o.value === String(v)) ? String(v) : ''; } });
  if (raw !== undefined) val = raw;
}

/* ------------------------------------------------------------------ texto do HTML antigo */
const decode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
export const strip = (h: string) => decode(h.replace(/<[^>]*>/g, ''));
/** Blocos do antigo: [rótulo, valor, texto pequeno]. */
export const tilesOf = (h: string): string[][] =>
  [...h.matchAll(/<div class="tile"><span>([\s\S]*?)<\/span><b>([\s\S]*?)<\/b><small>([\s\S]*?)<\/small><\/div>/g)].map(m => [strip(m[1]), strip(m[2]), strip(m[3])]);
/** Tabela do antigo: linhas × células (texto). */
export const tableOf = (h: string): string[][] =>
  [...h.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(m => [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map(c => strip(c[1])));

/* ------------------------------------------------------------------ gráficos */
const omit = (o: any, keys: string[]) => { const r: any = {}; for (const k of Object.keys(o)) if (!keys.includes(k) && typeof o[k] !== 'function') r[k] = o[k]; return r; };
/** Spec do BT.Plot sem cores nem callbacks. */
export function normLegacyPlot(spec: any): any {
  if (!spec) return spec;
  const o = omit(spec, []);
  if (o.series) o.series = o.series.map((s: any) => omit(s, ['color']));
  if (o.points) o.points = omit(o.points, ['color']);
  if (o.bars) o.bars = omit(o.bars, ['colors', 'color']);
  if (o.hlines) o.hlines = o.hlines.map((s: any) => omit(s, ['color']));
  if (o.legend) o.legend = o.legend.map((s: any) => omit(s, ['color']));
  if (o.markers) o.markers = o.markers.map((s: any) => omit(s, ['color']));
  return o;
}
/** Relatório no mesmo formato (sem ids, papéis, explicação e formatos). */
export function normRepPlot(p: RepPlot | null): any {
  if (!p) return p;
  const o = omit(p, ['id', 'explain', 'sensors', 'tipX', 'fmtY', 'barTips', 'clickSeek']);
  if (o.series) o.series = o.series.map((s: any) => omit(s, ['id', 'role']));
  if (o.points) o.points = omit(o.points, ['id']);
  if (o.bars) o.bars = omit(o.bars, ['roles']);
  if (o.hlines) o.hlines = o.hlines.map((s: any) => omit(s, ['id', 'role']));
  if (o.legend) o.legend = o.legend.map((s: any) => omit(s, ['role']));
  if (o.markers) o.markers = o.markers.map((s: any) => omit(s, ['id', 'role']));
  return o;
}
/** Compara o gráfico (dados e textos dos tooltips) com o spec gravado pelo BT.Plot falso. */
export function expectPlot(spec: any, p: RepPlot | null, where: string): void {
  expect(p, where).not.toBeNull();
  expect(same(normLegacyPlot(spec), normRepPlot(p)), where).toEqual([]);
  const xs = [0, 0.37, 1, 12.345, -3.5, 100.05];
  const chk = (f: ((x: number) => string) | undefined, r: RepFmt | undefined, bold: boolean, what: string) => {
    expect(!!f, `${where} ${what}`).toBe(!!r);
    if (f && r) for (const x of xs) expect(f(x), `${where} ${what}(${x})`).toBe(bold ? `<b>${fmtRep(r, x)}</b>` : fmtRep(r, x));
  };
  chk(spec.tipX, p!.tipX, true, 'tipX');
  chk(spec.fmtY, p!.fmtY, false, 'fmtY');
  expect(!!spec.tipBar, `${where} tipBar`).toBe(!!p!.barTips);
  if (spec.tipBar) p!.barTips!.forEach((l, j) => expect(spec.tipBar(j), `${where} tipBar(${j})`).toBe(`<b>${l[0]}</b><br>${l[1]}`));
  expect(!!spec.onClick, `${where} onClick`).toBe(!!p!.clickSeek);
}

/* ------------------------------------------------------------------ explicações e sensores */
const ID_RE = new RegExp(`^(${EXPLAIN_AREAS.join('|')})\\.[a-zA-Z][a-zA-Z0-9]*$`);
/** Percorre o relatório: todo explain bem formado e todo sensor existe. Devolve os ids. */
export function checkTags(rep: unknown, where: string, ids = new Set<string>()): Set<string> {
  const walk = (x: any) => {
    if (!x || typeof x !== 'object' || ArrayBuffer.isView(x)) return;
    if (Array.isArray(x)) { x.forEach(walk); return; }
    if ('explain' in x) {
      expect(typeof x.explain === 'string' && ID_RE.test(x.explain), `${where}: explain ${x.explain}`).toBe(true);
      ids.add(x.explain);
      expect(Array.isArray(x.sensors), `${where}: sensors de ${x.explain}`).toBe(true);
    }
    if (Array.isArray(x.sensors)) for (const s of x.sensors) expect(Object.hasOwn(SENSORS, s), `${where}: sensor ${s}`).toBe(true);
    for (const k of Object.keys(x)) if (k !== 'lap' && k !== 'refLap') walk(x[k]);
  };
  walk(rep);
  return ids;
}
