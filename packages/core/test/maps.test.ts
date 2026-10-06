/* Equivalência de channelMaps com renderMaps (legacy/js/analysisui.js): lista de canais
 * (com e sem os constantes), faixa 2–98 % e o texto dela, casas decimais, escala do
 * mini-mapa e a cor (faixa 0…15) de cada pedaço da pista — conferida contra os traços que o
 * antigo desenha (Path2D gravado), na sessão inteira e em cada volta. Também os sensores de
 * cada canal (sensorsOfChannel). */
import { describe, it, expect } from 'vitest';
import { makeCases, runLegacy, strip, checkTags, L, BT, type Win } from './reports-helpers';
import { same } from './compare';
import type { LegacyState } from './legacy';
import { channelMaps, sensorsOfChannel, miniMapTransform, MINI_MAP_BINS } from '../src/reports/maps';
import { computeSession, rangeOf, type SessionContext } from '../src/pipeline';
import { detectRoles } from '../src/quality';
import { parseCSV } from '../src/parsers';
import { demoCSV, DEMO_CAR } from '../src/demo';
import type { TrackOk } from '../src/gps';

const CASES = makeCases();
const ROUGH_NAME = 'Rugosidade (vel. amortecedores, RMS 1 s)';   /* nome do app.js (a réplica perdeu a vírgula) */

/* canvas e Path2D falsos dentro do app antigo: gravam o que seria desenhado */
const G: any = new L.BT.esc.constructor('return this')();
G.Path2D = class { ops: any[] = []; moveTo(x: number, y: number) { this.ops.push(['M', x, y]); } lineTo(x: number, y: number) { this.ops.push(['L', x, y]); } };
let recs: any[] = [];
BT.setupCanvas = (_c: any, w: number, h: number) => { const g: any = { strokes: [] as any[], stroke(p: any) { g.strokes.push(p); } }; recs.push(g); return [g, w, h]; };

function fakeFig(k: string) {
  const sub: Record<string, any> = {
    canvas: { getBoundingClientRect: () => ({ width: 800, height: 300 }) },
    '.mm-r': { textContent: '' }, '.mm-bar': { style: {} }, '.mm-v': { textContent: '' },
  };
  return { dataset: { k }, querySelector: (s: string) => sub[s], classList: { toggle: () => undefined }, sub };
}

function compare(O: LegacyState, N: SessionContext, sel: number, includeConst: boolean, where: string) {
  const n = O.S.t.length;
  (O as any).range = () => (O.sel >= 0 && O.laps[O.sel] ? [O.laps[O.sel].i0, O.laps[O.sel].i1] : [0, n - 1]);
  (O as any).colorKey = '';
  (O as any).setColorKey = () => undefined;
  recs = [];
  let figs: any[] = [];
  const w: Win = { label: 'mapas', win: 'session', sel, view: null };
  const an = runLegacy(O, 'renderMaps', w, () => {
    L.el('mmConst').checked = includeConst;
    L.el('mmGrid').querySelectorAll = () => (figs = [...L.el('mmGrid').innerHTML.matchAll(/data-k="([^"]*)"/g)].map(m => fakeFig(strip(m[1]))));
  });
  const [i0, i1] = rangeOf(N, 'lap', sel);
  const r = channelMaps(N, i0, i1, { includeConst });
  checkTags(r, where);
  if (!r.ok) { expect(strip(L.el('mmGrid').innerHTML), where).toBe(r.empty); expect(an.minis).toEqual([]); return r; }
  expect(figs.map(f => f.dataset.k), `${where} canais`).toEqual(r.items.map(x => x.key));
  const names = [...L.el('mmGrid').innerHTML.matchAll(/<figcaption><b>([\s\S]*?)<\/b>/g)].map((m, j) => (r.items[j].key === 'susp:rough' ? ROUGH_NAME : strip(m[1])));
  expect(names, `${where} nomes`).toEqual(r.items.map(x => x.name));
  expect(recs.length).toBe(r.items.length);
  const tr = N.track as TrackOk;
  const { s, ox, oy } = miniMapTransform(r.bounds, 800, 300);
  const X = (x: number) => ox + (x - r.bounds.x0) * s, Y = (y: number) => 300 - oy - (y - r.bounds.y0) * s;
  r.items.forEach((it, j) => {
    const m = an.minis[j], at = `${where} ${it.key}`;
    expect(figs[j].sub['.mm-r'].textContent, `${at} faixa`).toBe(it.rangeText);
    expect(m.dec, at).toBe(it.dec);
    for (const p of [[0, 0], [r.bounds.x0, r.bounds.y1], [12.5, -40]]) expect(same([m.X(p[0]), m.Y(p[1])], [X(p[0]), Y(p[1])]), at).toEqual([]);
    const st = recs[j].strokes;
    expect(st.length, `${at} traços`).toBe(MINI_MAP_BINS + (it.any ? 1 : 2));
    const P = st.slice(st.length - MINI_MAP_BINS);
    const want: any[][] = Array.from({ length: MINI_MAP_BINS }, () => []);
    for (let i = 0; i < it.bins.length; i++) if (it.bins[i] >= 0) want[it.bins[i]].push(['M', X(tr.x[i - 1]), Y(tr.y[i - 1])], ['L', X(tr.x[i]), Y(tr.y[i])]);
    expect(same(P.map((p: any) => p.ops), want), `${at} cores`).toEqual([]);
  });
  return r;
}

describe.each(CASES.map(c => [c.label, c] as const))('channelMaps × renderMaps: %s', (_l, { O, N }) => {
  it('sessão e cada volta, com e sem canais constantes', () => {
    for (const inc of [false, true]) {
      compare(O, N, -1, inc, `${_l} sessão ${inc}`);
      for (let k = 0; k < Math.min(N.laps.length, 3); k++) compare(O, N, k, inc, `${_l} volta ${k} ${inc}`);
    }
  });
});

describe('sensorsOfChannel', () => {
  const S = parseCSV(demoCSV(), 'exemplo_baja.csv'); S.demo = true;
  const roles0 = detectRoles(S);
  const ctx = computeSession(S, {
    car: DEMO_CAR,
    formulas: [{ id: 'a', name: 'teste', unit: '', expr: `[${roles0.wheel}] * 2 + [susp:heave]` }, { id: 'b', name: 'b', unit: '', expr: '[f:a] + 1' }],
  }, { autoLine: true });
  const roles = detectRoles(ctx.S, ctx.cfg);
  it('canais do log pelo papel', () => {
    expect(sensorsOfChannel(ctx, roles.wheel!)).toEqual(['wheel']);
    expect(sensorsOfChannel(ctx, roles.shock_pos_FL!)).toEqual(['shock_fl']);
    expect(sensorsOfChannel(ctx, roles.cvt_temp!)).toEqual(['cvt_temp']);
    expect(sensorsOfChannel(ctx, roles.gps_x!)).toEqual(['gps']);
  });
  it('calculados', () => {
    expect(sensorsOfChannel(ctx, 'gps:speed')).toEqual(['gps']);
    expect(sensorsOfChannel(ctx, 'veh:P')).toEqual(['wheel', 'gps', 'car_data']);
    expect(sensorsOfChannel(ctx, 'veh:slip')).toEqual(['wheel', 'gps']);
    expect(sensorsOfChannel(ctx, 'susp:vRL')).toEqual(['shock_rl']);   /* (só existe sem a velocidade da FT; a regra vale igual) */
    expect(sensorsOfChannel(ctx, 'susp:rollF')).toEqual(['shock_fl', 'shock_fr', 'car_data']);
    expect(sensorsOfChannel(ctx, 'susp:heave')).toEqual(['shock_fl', 'shock_fr', 'shock_rl', 'shock_rr']);
  });
  it('fórmulas pelos canais usados (também de outra fórmula)', () => {
    expect(ctx.formulaErrors).toEqual([]);
    expect(sensorsOfChannel(ctx, 'f:a')).toEqual(['wheel', 'shock_fl', 'shock_fr', 'shock_rl', 'shock_rr']);
    expect(sensorsOfChannel(ctx, 'f:b')).toEqual(['wheel', 'shock_fl', 'shock_fr', 'shock_rl', 'shock_rr']);
  });
  it('mini-mapa: todo canal leva o GPS', () => {
    const r = channelMaps(ctx, 0, ctx.S.t.length - 1, { includeConst: true });
    expect(r.items.every(x => x.sensors[0] === 'gps')).toBe(true);
    expect(r.items.find(x => x.key === 'f:a')!.sensors).toEqual(['gps', 'wheel', 'shock_fl', 'shock_fr', 'shock_rl', 'shock_rr']);
  });
});
