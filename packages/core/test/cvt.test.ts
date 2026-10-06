/* Equivalência de cvtReport com renderCvt (legacy/js/vehicleui.js): fonte, blocos, o modelo
 * escrito, medido × modelo, projeção do enduro e a nota, em vários trechos e sessões
 * (com e sem canal da CVT, sem velocidade, modelo que não fecha em trecho curto). */
import { describe, it, expect } from 'vitest';
import { makeCases, windows, newRange, runLegacy, strip, tilesOf, expectPlot, checkTags, L, type Win } from './reports-helpers';
import { cvtReport } from '../src/reports/cvt';
import type { SessionContext } from '../src/pipeline';
import type { LegacyState } from './legacy';

const CASES = makeCases();

function compare(O: LegacyState, N: SessionContext, w: Win, where: string) {
  const [i0, i1] = newRange(N, w);
  runLegacy(O, 'renderCvt', w);
  const el = L.el;
  const r = cvtReport(N, i0, i1);
  checkTags(r, where);
  expect(el('cvPlots').hidden, `${where} cvPlots.hidden`).toBe(!r.ok);
  expect(tilesOf(el('cvTiles').innerHTML), `${where} blocos`).toEqual(r.tiles.map(x => [x.label, x.text, x.unit]));
  expect(el('cvNote').textContent, `${where} nota`).toBe(r.note);
  if (!r.ok) {
    expect(strip(el('cvBody').innerHTML), where).toBe(r.empty);
    expect(el('cvSrc').textContent, where).toBe('');
    return r;
  }
  expect(strip(el('cvSrc').innerHTML), `${where} fonte`).toBe(r.src.text);
  if (r.modelMsg) expect(strip(el('cvBody').innerHTML), `${where} corpo`).toBe(r.modelMsg);
  else expect(strip(el('cvBody').innerHTML), `${where} corpo`).toBe(r.fitText! + r.equation! + ' ' + r.unitsText! + r.reading!);
  expectPlot(el('cvFit').plot, r.fitPlot, `${where} cvFit`);
  expectPlot(el('cvProj').plot, r.projPlot, `${where} cvProj`);
  return r;
}

describe.each(CASES.map(c => [c.label, c] as const))('cvtReport × renderCvt: %s', (_l, { O, N }) => {
  it.each(windows(N).map(w => [w.label, w] as const))('trecho %s', (_w, w) => {
    compare(O, N, w, `${_l} · ${w.label}`);
  });
  it('trechos curtos (modelo não fecha)', () => {
    const t = N.S.t, T0 = t[0];
    for (const d of [3, 20, 60]) compare(O, N, { label: `${d} s`, win: 'view', sel: -1, view: [T0 + 5, T0 + 5 + d] }, `${_l} · ${d} s`);
  });
});

describe('cvtReport: sensores e estados', () => {
  const get = (label: string) => CASES.find(c => c.label === label)!.N;
  it('exemplo: temperatura + roda/GPS + dados do carro no modelo', () => {
    const N = get('exemplo'), r = cvtReport(N, 0, N.S.t.length - 1);
    expect(r.ok && r.fit?.ok).toBe(true);
    expect(r.sensors).toEqual(['cvt_temp', 'wheel', 'gps', 'car_data']);
    expect(r.tiles[0].sensors).toEqual(['cvt_temp']);
    expect(r.fitPlot!.series!.map(s => s.id)).toEqual(['measured', 'model']);
  });
  it('sem roda nem GPS: medida sem modelo', () => {
    const N = get('exemplo sem roda nem GPS'), r = cvtReport(N, 0, N.S.t.length - 1);
    expect(r.modelMsg).toBe('Modelo térmico: precisa de velocidade (roda ou GPS) para o modelo.');
    expect(r.projPlot!.empty).toBe('sem modelo');
  });
  it('sem canal da CVT', () => {
    const N = get('exemplo roda livre, sem CVT'), r = cvtReport(N, 0, N.S.t.length - 1);
    expect(r.ok).toBe(false);
    expect(r.empty).toBe('Nenhum canal de temperatura da CVT com sinal. Escolha o canal em “Dados do carro”.');
  });
});
