/* Equivalência de dynamicsReport com renderDyn (legacy/js/analysisui.js): fonte das
 * acelerações, blocos, diagrama g-g (com os círculos) e tempo por faixa de velocidade. */
import { describe, it, expect } from 'vitest';
import { makeCases, windows, newRange, runLegacy, strip, tilesOf, expectPlot, checkTags, L, type Win } from './reports-helpers';
import { same } from './compare';
import { dynamicsReport } from '../src/reports/dynamics';
import type { SessionContext } from '../src/pipeline';
import type { LegacyState } from './legacy';

const CASES = makeCases();

function compare(O: LegacyState, N: SessionContext, w: Win, where: string) {
  const [i0, i1] = newRange(N, w);
  const an = runLegacy(O, 'renderDyn', w);
  const el = L.el;
  const r = dynamicsReport(N, i0, i1);
  checkTags(r, where);
  expect(el('dyPlots').hidden, `${where} dyPlots.hidden`).toBe(!r.ok);
  if (!r.ok) {
    expect(strip(el('dyTiles').innerHTML), where).toBe(r.empty);
    expect(an.acc).toBeNull();
    return r;
  }
  expect(el('dySrc').textContent, `${where} fonte`).toBe(r.src.text);
  expect(tilesOf(el('dyTiles').innerHTML), `${where} blocos`).toEqual(r.tiles.map(x => [x.label, x.text, x.unit]));
  expectPlot(el('dyGG').plot, r.gg, `${where} dyGG`);
  expectPlot(el('dySpd').plot, r.speed, `${where} dySpd`);
  /* ponto atual do g-g: o antigo usa this.acc.lat[i] / lon[i] */
  expect(same(an.acc.lat, r.cursor!.lat), where).toEqual([]);
  expect(same(an.acc.lon, r.cursor!.lon), where).toEqual([]);
  return r;
}

describe.each(CASES.map(c => [c.label, c] as const))('dynamicsReport × renderDyn: %s', (_l, { O, N }) => {
  it.each(windows(N).map(w => [w.label, w] as const))('trecho %s', (_w, w) => {
    compare(O, N, w, `${_l} · ${w.label}`);
  });
  it('trechos curtos', () => {
    const t = N.S.t, T0 = t[0];
    for (const d of [0, 0.5, 4]) compare(O, N, { label: `${d} s`, win: 'view', sel: -1, view: [T0 + 7, T0 + 7 + d] }, `${_l} · ${d} s`);
  });
});

describe('dynamicsReport: sensores', () => {
  const get = (label: string) => CASES.find(c => c.label === label)!.N;
  const tile = (r: ReturnType<typeof dynamicsReport>, k: string) => r.tiles.find(x => x.key === k)!;
  it('exemplo: longitudinal pela roda (calibrada pelo GPS), lateral roda × guinada do GPS', () => {
    const N = get('exemplo'), r = dynamicsReport(N, 0, N.S.t.length - 1);
    expect(tile(r, 'amax').sensors).toEqual(['wheel', 'gps']);
    expect(tile(r, 'latR').sensors).toEqual(['wheel', 'gps']);
    expect(tile(r, 'vmax').sensors).toEqual(['gps']);
    expect(r.gg!.sensors).toEqual(['wheel', 'gps']);
  });
  it('sem roda: tudo pelo GPS', () => {
    const N = get('exemplo sem roda'), r = dynamicsReport(N, 0, N.S.t.length - 1);
    expect(r.gg!.sensors).toEqual(['gps']);
    expect(r.src.text).toBe('pela trajetória do GPS');
  });
  it('sem GPS: estado vazio', () => {
    const N = get('exemplo sem GPS'), r = dynamicsReport(N, 0, N.S.t.length - 1);
    expect(r.ok).toBe(false);
    expect(r.empty).toBe('Sem trajetória de GPS.');
  });
});
