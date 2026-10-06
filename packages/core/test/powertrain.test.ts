/* Equivalência de powertrainReport com renderPower + renderCoast + showCoast
 * (legacy/js/vehicleui.js): fonte, blocos, curva de potência, largadas, escorregamento e
 * coast-down (lista, trecho escolhido, trecho manual, resultado, gráfico e o botão "Usar
 * estes Crr e CdA"), em vários trechos e sessões. */
import { describe, it, expect } from 'vitest';
import { makeCases, windows, newRange, runLegacy, selectify, strip, tilesOf, tableOf, expectPlot, checkTags, L, BT, type Win } from './reports-helpers';
import { powertrainReport, mergeSensors, vehSpeedSensors, fmtRep, type PowertrainOpts } from '../src/reports/powertrain';
import type { SessionContext } from '../src/pipeline';
import type { LegacyState } from './legacy';

const CASES = makeCases();
const IDS = new Set<string>();

/* roda o antigo e devolve o que ele escreveu */
function legacyPower(O: LegacyState, w: Win, sel?: string, manual?: { t0: number; t1: number }) {
  const an = runLegacy(O, 'renderPower', w, an => {
    selectify(L.el('cdSel'), sel);
    if (manual) { const t = O.S.t; an.coastManual = { i0: BT.idxAt(t, manual.t0), i1: BT.idxAt(t, manual.t1), t0: manual.t0, t1: manual.t1 }; }
  });
  const el = L.el;
  return {
    an, src: el('pwSrc'), tiles: el('pwTiles').innerHTML, hidden: el('pwContent').hidden, curve: el('pwCurve').plot,
    launch: el('pwLaunch').innerHTML, slip: el('pwSlip').plot, cdSel: el('cdSel'), cdRes: el('cdRes').innerHTML,
    cdPlot: el('cdPlot').plot, cdApply: el('cdApply').disabled,
  };
}

function compare(O: LegacyState, N: SessionContext, w: Win, opts: PowertrainOpts, where: string) {
  const [i0, i1] = newRange(N, w);
  const sel = opts.coastSel === undefined ? undefined : String(opts.coastSel);
  const o = legacyPower(O, w, sel, opts.coastManual ?? undefined);
  const r = powertrainReport(N, i0, i1, opts);
  checkTags(r, where, IDS);
  expect(o.hidden, `${where} pwContent.hidden`).toBe(!r.ok);
  if (!r.ok) {
    expect(strip(o.tiles), where).toBe(r.empty);
    expect(o.src.textContent, where).toBe(r.src.text);
    return r;
  }
  expect(strip(o.src.innerHTML), `${where} pwSrc`).toBe(r.src.text);
  expect(tilesOf(o.tiles), `${where} blocos`).toEqual(r.tiles.map(x => [x.label, x.text, x.unit]));
  expectPlot(o.curve, r.curve, `${where} pwCurve`);
  /* largadas */
  if (r.launchTable) {
    const tb = tableOf(o.launch);
    expect(tb[0], `${where} cabeçalho`).toEqual(r.launchTable.columns);
    expect(tb.slice(1), `${where} largadas`).toEqual(r.launchTable.rows.map(x => x.cells));
    const ts = [...o.launch.matchAll(/data-t="([^"]*)"/g)].map(m => +m[1] - 0.5);
    expect(ts, `${where} ir ao ponto`).toEqual(r.launchTable.rows.map(x => x.seek));
  } else expect(strip(o.launch), `${where} sem largadas`).toBe(r.launchEmpty);
  expect(o.an.launchList.length, where).toBe(r.launchList.length);
  expectPlot(o.slip, r.slip, `${where} pwSlip`);
  /* coast-down */
  const c = r.coast!;
  expect(o.cdSel.options.map((x: any) => [x.value, x.text]), `${where} cdSel`).toEqual(c.options.map(x => [x.value, x.label]));
  expect(o.cdSel.value, `${where} cdSel.value`).toBe(c.selected);
  expect(o.cdApply, `${where} cdApply`).toBe(!c.fit);
  if (!c.fit) expect(strip(o.cdRes), `${where} cdRes`).toBe(c.empty);
  else {
    const tb = tableOf(o.cdRes);
    expect(tb, `${where} cdRes tabela`).toEqual(c.rows.map(x => x.cells));
    const ps = [...o.cdRes.matchAll(/<p class="mut small">([\s\S]*?)<\/p>/g)].map(m => strip(m[1]));
    expect(ps, `${where} cdRes avisos`).toEqual([...(c.warn.length ? [`⚠ ${c.warn.join('; ')}.`] : []), c.note]);
    /* "Usar estes Crr e CdA no carro": o que o antigo gravaria em cfg.car */
    const f = o.an.coastRes, car: any = {};
    car.crr = +f.crr.toFixed(4);
    if (f.cda > 0) car.cda = +f.cda.toFixed(3);
    expect(c.apply, where).toEqual({ crr: car.crr, cda: car.cda ?? null });
  }
  expectPlot(o.cdPlot, c.plot, `${where} cdPlot`);
  return r;
}

describe.each(CASES.map(c => [c.label, c] as const))('powertrainReport × renderPower: %s', (_l, { O, N }) => {
  it.each(windows(N).map(w => [w.label, w] as const))('trecho %s', (_w, w) => {
    compare(O, N, w, {}, `${_l} · ${w.label}`);
  });
  it('coast-down: cada trecho, trecho manual e seleção inválida', () => {
    const w: Win = { label: 'sessão', win: 'session', sel: -1, view: null };
    const r = compare(O, N, w, {}, `${_l} padrão`);
    if (!r.ok) return;
    const n = r.coast!.coasts.length;
    for (let k = 0; k < Math.min(n, 4); k++) compare(O, N, w, { coastSel: k }, `${_l} coast ${k}`);
    compare(O, N, w, { coastSel: 'x' }, `${_l} coast inválido`);
    const t = N.S.t, T0 = t[0], T1 = t[t.length - 1];
    const man = { t0: T0 + (T1 - T0) * 0.3, t1: T0 + (T1 - T0) * 0.45 };
    compare(O, N, w, { coastSel: 'm', coastManual: man }, `${_l} coast manual`);
    compare(O, N, w, { coastManual: man }, `${_l} coast manual sem seleção`);
    compare(O, N, { label: 'janela', win: 'view', sel: -1, view: [T0 + 10, T0 + 12] }, { coastSel: 'm', coastManual: { t0: T0 + 10, t1: T0 + 12 } }, `${_l} coast manual curto`);
  });
});

describe('powertrainReport: sensores', () => {
  const get = (label: string) => CASES.find(c => c.label === label)!.N;
  it('exemplo: roda calibrada pelo GPS + dados do carro na potência', () => {
    const N = get('exemplo'), r = powertrainReport(N, 0, N.S.t.length - 1);
    const tile = (k: string) => r.tiles.find(x => x.key === k)!;
    expect(r.src.sensors).toEqual(['wheel', 'gps']);
    expect(tile('pmax').sensors).toEqual(['wheel', 'gps', 'car_data']);
    expect(tile('tireCal').sensors).toEqual(['wheel', 'gps']);
    expect(tile('res').sensors).toEqual(['car_data']);
    expect(r.slip!.sensors).toEqual(['wheel', 'gps']);
    expect(r.coast!.sensors).toEqual(['wheel', 'gps', 'car_data']);
  });
  it('sem roda: tudo pelo GPS, sem calibração do pneu', () => {
    const N = get('exemplo sem roda'), r = powertrainReport(N, 0, N.S.t.length - 1);
    expect(vehSpeedSensors(N.veh)).toEqual(['gps']);
    expect(r.tiles.find(x => x.key === 'tireCal')!.sensors).toEqual([]);
    expect(r.tiles.find(x => x.key === 'pmax')!.sensors).toEqual(['gps', 'car_data']);
    expect(r.tiles.flatMap(x => x.sensors)).not.toContain('wheel');
  });
  it('sem GPS: só a roda (sem calibração)', () => {
    const N = get('exemplo sem GPS'), r = powertrainReport(N, 0, N.S.t.length - 1);
    expect(r.src.sensors).toEqual(['wheel']);
    expect(r.tiles.flatMap(x => x.sensors)).not.toContain('gps');
  });
  it('sem roda nem GPS: estado vazio', () => {
    const N = get('exemplo sem roda nem GPS'), r = powertrainReport(N, 0, N.S.t.length - 1);
    expect(r.ok).toBe(false);
    expect(r.empty).toBe('Sem velocidade: o log não tem velocidade da roda nem GPS.');
  });
  it('mergeSensors e fmtRep', () => {
    expect(mergeSensors('gps', ['wheel', 'gps'], false, null, 'car_data')).toEqual(['gps', 'wheel', 'car_data']);
    expect(fmtRep({ dec: 2, suffix: ' s', sign: true }, 0.123)).toBe('+0.12 s');
    expect(fmtRep({ dec: 2, suffix: ' s', sign: true }, -0.5)).toBe('-0.50 s');
  });
  it('ids de explicação usados', () => {
    expect([...IDS].sort()).toEqual(expect.arrayContaining(['power.wheelPower', 'power.coastDown', 'power.launch', 'power.tireCalibration']));
  });
});
