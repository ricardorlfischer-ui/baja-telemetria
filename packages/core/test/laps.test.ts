/* Equivalência de lapReport com renderLaps + frameLaps (legacy/js/analysisui.js) e de
 * lapTable com buildLaps (legacy/js/app.js, extraída do arquivo e rodada com o DOM falso). */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { makeCases, runLegacy, strip, tableOf, expectPlot, checkTags, L, BT, type Win } from './reports-helpers';
import { LEGACY_DIR, type LegacyState } from './legacy';
import { same } from './compare';
import { lapReport, lapSeekTime, lapCursorDist, lapTable } from '../src/reports/laps';
import { idxAt } from '../src/util';
import type { SessionContext } from '../src/pipeline';
import type { TrackOk } from '../src/gps';

const CASES = makeCases();
const W: Win = { label: 'voltas', win: 'session', sel: -1, view: null };

function compare(O: LegacyState, N: SessionContext, cmp: number | null, ref: number | null, sel: number, where: string) {
  O.sel = sel;
  let seekTo = NaN;
  (O as any).seek = (tc: number) => { seekTo = tc; };
  const an = runLegacy(O, 'renderLaps', { ...W, sel }, () => {
    L.el('lpCmp').value = cmp === null ? '' : String(cmp);
    L.el('lpRef').value = ref === null ? '' : String(ref);
  });
  const el = L.el;
  const r = lapReport(N, cmp, ref, sel);
  checkTags(r, where);
  expect(el('lpContent').hidden, `${where} lpContent.hidden`).toBe(!r.ok);
  if (!r.ok) { expect(strip(el('lpBody').innerHTML), where).toBe(r.empty); return r; }
  const opts = [...el('lpCmp').innerHTML.matchAll(/<option value="([^"]*)">([\s\S]*?)<\/option>/g)].map(m => [+m[1], strip(m[2])]);
  expect(opts, `${where} seletores`).toEqual(r.options.map(o => [o.value, o.label]));
  expect(el('lpRef').innerHTML).toBe(el('lpCmp').innerHTML);
  expect([+el('lpCmp').value, +el('lpRef').value], `${where} escolhidas`).toEqual([r.cmp, r.ref]);
  expect(strip(el('lpSum').innerHTML), `${where} resumo`).toBe(r.summary);
  expectPlot(el('lpSpeed').plot, r.speed, `${where} lpSpeed`);
  expectPlot(el('lpDelta').plot, r.delta, `${where} lpDelta`);
  expectPlot(el('lpSect').plot, r.sectors, `${where} lpSect`);
  /* cor das barras: + = perdeu (pos), − = ganhou (neg) */
  expect(r.sectors!.bars!.roles, where).toEqual(Array.from(r.seg!, v => (v > 0 ? 'pos' : 'neg')));
  /* clique = ir ao ponto */
  const D = r.compare!.d[r.compare!.d.length - 1];
  for (const d of [0, D * 0.13, D * 0.5, D, D * 1.2, -5]) {
    el('lpSpeed').plot && (el('lpSpeed').plot as any).onClick(d);
    expect(seekTo, `${where} seek(${d})`).toBe(lapSeekTime(r, d));
    (el('lpDelta').plot as any).onClick(d);
    expect(seekTo, `${where} seek delta(${d})`).toBe(lapSeekTime(r, d));
  }
  /* marcador do cursor (frameLaps) */
  const t = N.S.t, l = r.lap!;
  for (const cur of [t[0], l.t0 - 0.1, l.t0, (l.t0 + l.t1) / 2, l.t0 + (l.t1 - l.t0) * 0.77, l.t1, l.t1 + 0.3]) {
    const i = idxAt(t, cur);
    (O as any).cur = cur;
    an.lapMarker = undefined;
    an.frameLaps(i);
    const m = (el('lpSpeed').plot as any).markers;
    const want = lapCursorDist(r, N.track as TrackOk, i, cur);
    expect(same(m, want === null ? [] : [{ x: want, color: '#888888' }]), `${where} marcador ${cur}`).toEqual([]);
  }
  return r;
}

describe.each(CASES.map(c => [c.label, c] as const))('lapReport × renderLaps: %s', (_l, { O, N }) => {
  it('padrão, cada par de voltas, volta selecionada e índices inválidos', () => {
    const n = N.laps.length;
    compare(O, N, null, null, -1, `${_l} padrão`);
    for (let c = 0; c < Math.min(n, 5); c++) for (let r = 0; r < Math.min(n, 5); r++) compare(O, N, c, r, -1, `${_l} ${c}×${r}`);
    for (let s = 0; s < Math.min(n, 5); s++) compare(O, N, null, null, s, `${_l} sel ${s}`);
    compare(O, N, 99, 77, 0, `${_l} inválidos`);
    if (n >= 2) compare(O, N, null, 1, 1, `${_l} sel = ref`);
  });
});

/* buildLaps de legacy/js/app.js, rodada com o estado do app antigo */
const APP = readFileSync(path.join(LEGACY_DIR, 'app.js'), 'utf8').replace(/\r\n/g, '\n');
const SRC = /\nfunction buildLaps\(\) \{[\s\S]*?\n\}\n/.exec(APP)![0];
const legacyBuildLaps = new Function('A', '$', 'BT', 'updateNow', 'selectLap', `${SRC}; return buildLaps;`);

describe.each(CASES.map(c => [c.label, c] as const))('lapTable × buildLaps: %s', (_l, { O, N }) => {
  it('sem seleção e com cada volta selecionada', () => {
    for (let sel = -1; sel < Math.min(N.laps.length, 4); sel++) {
      const where = `${_l} sel ${sel}`;
      L.els.clear();
      const A: any = Object.assign(Object.create(null), O, { sel, getLine: () => O.cfg.line || null });
      legacyBuildLaps(A, L.el, BT, {}, () => undefined)();
      const html = L.el('laps').innerHTML;
      const r = lapTable(N, sel);
      checkTags(r, where);
      if (!r.ok) { expect(strip(html), where).toBe(r.empty); continue; }
      const tb = tableOf(html);
      expect(tb[0], where).toEqual(r.columns);
      expect(tb.slice(1), where).toEqual(r.rows.map(x => x.cells));
      const cls = [...html.matchAll(/<tr class="lap( sel)?" data-k="(\d+)"><td>[^<]*<\/td><td class="(best)?">/g)].map(m => [!!m[1], +m[2], !!m[3]]);
      expect(cls, where).toEqual(r.rows.map(x => [x.sel, x.k, x.best]));
      expect(strip(html).endsWith(r.note), where).toBe(true);
    }
  });
});

describe('lapTable: estados vazios', () => {
  it('sem linha e sem GPS', () => {
    const ex = CASES.find(c => c.label === 'exemplo')!.N;
    expect(lapTable({ ...ex, cfg: { ...ex.cfg, line: null } }).empty).toBe('Defina a linha de largada no mapa (“Desenhar” ou “Automática”) para separar as voltas.');
    const ng = CASES.find(c => c.label === 'exemplo sem GPS')!.N;
    expect(lapTable(ng).empty).toBe('Sem trajetória de GPS neste log.');
    expect(lapReport(ng).empty).toBe('Precisa de pelo menos 2 voltas. Defina a linha de largada no mapa.');
    expect(lapReport(ex).sensors).toEqual(['gps', 'logger']);
  });
});
