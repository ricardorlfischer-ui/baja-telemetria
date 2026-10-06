/* Relatório da página CVT: porte de renderCvt (legacy/js/vehicleui.js). O modelo térmico é o
 * cvtFit de vehicle.js; aqui só se monta o que a aba mostrava (fonte, blocos, o modelo
 * escrito, gráfico medido × modelo, projeção do enduro e a nota), com os sensores de cada
 * número. */
import type { SensorId } from '../types';
import type { CvtFit, CvtOk, VehMotion } from '../vehicle';
import type { SessionContext } from '../pipeline';
import { cvtFit } from '../vehicle';
import { mergeSensors, vehSpeedSensors, type RepPlot, type RepSeries, type RepText, type RepTile } from './powertrain';

/* mesmos helpers de vehicleui.js */
const ok = (v: number | null | undefined): v is number => v !== null && v !== undefined && v === v && isFinite(v);
const fx = (v: number | null | undefined, d = 1) => (ok(v) ? v.toFixed(d) : '—');
const num = (v: number | null | undefined): number | null => (ok(v) ? v : null);

export interface CvtReport {
  ok: boolean;                   /* false = sem canal da CVT com sinal (gráficos escondidos) */
  empty?: string;                /* sem canal: a frase do antigo */
  src: RepText;                  /* canal, ambiente, limite e enduro (cvSrc) */
  tiles: RepTile[];
  tmax: number; tmin: number;    /* °C medidos no trecho */
  fit: CvtFit | null;            /* resultado do modelo (null sem canal) */
  modelMsg?: string;             /* modelo não fechou: 'Modelo térmico: <motivo>.' */
  /* modelo ajustado (cvBody): resumo, equação, unidades e leitura */
  fitText?: string;
  equation?: string;
  unitsText?: string;
  reading?: string;
  each10?: number;               /* °C a menos no regime por +10 % de troca de calor */
  fitPlot: RepPlot | null;       /* medida × modelo (cvFit) */
  projPlot: RepPlot | null;      /* projeção do enduro (cvProj) */
  note: string;                  /* cvNote */
  explain: string;
  sensors: SensorId[];           /* sensores do modelo */
}

/** CVT no trecho [i0, i1] (= renderCvt). */
export function cvtReport(ctx: Pick<SessionContext, 'S' | 'cfg' | 'veh'>, i0: number, i1: number): CvtReport {
  const veh = ctx.veh, car = ctx.cfg.car, t = ctx.S.t;
  if (!veh || !veh.cvt) {
    return {
      ok: false, src: { text: '', explain: 'cvt.source', sensors: [] }, tiles: [], tmax: NaN, tmin: NaN, fit: null,
      empty: `Nenhum canal de temperatura da CVT com sinal${veh && veh.cvtAny ? ` (o canal ${veh.cvtAny.name} está constante)` : ''}. Escolha o canal em “Dados do carro”.`,
      fitPlot: null, projPlot: null, note: '', explain: 'cvt.thermalModel', sensors: [],
    };
  }
  const T = veh.cvt.data;
  let tmax = -Infinity, tmin = Infinity;
  for (let i = i0; i <= i1; i++) { if (T[i] > tmax) tmax = T[i]; if (T[i] < tmin) tmin = T[i]; }
  const cvtS: SensorId[] = ['cvt_temp'];
  /* modelo: temperatura + potência e velocidade (roda ou GPS) + dados do carro */
  const modelS = mergeSensors(cvtS, vehSpeedSensors(veh), 'car_data');
  const src: RepText = {
    text: `Canal ${veh.cvt.name} · ambiente ${car.tAmb} °C · limite ${car.tCvtMax} °C · enduro ${car.endurance} min (em “Dados do carro”).`,
    explain: 'cvt.source', sensors: mergeSensors(cvtS, 'car_data'),
  };
  const r: CvtFit = veh.v ? cvtFit(t, T, veh.v, (veh as VehMotion).P, car, i0, i1) : { ok: false, msg: 'precisa de velocidade (roda ou GPS) para o modelo' };
  const tx: number[] = [], ty: number[] = [];
  for (let i = i0; i <= i1; i += 5) { tx.push(t[i]); ty.push(T[i]); }
  const meas: RepSeries = { id: 'measured', role: 'c1', x: Float64Array.from(tx), y: Float64Array.from(ty), label: 'medida' };
  const tTmax: RepTile = { key: 'tmax', label: 'Máxima medida', value: num(tmax), text: fx(tmax, 1), unit: '°C', explain: 'cvt.tmax', sensors: cvtS };
  if (!r.ok) {
    return {
      ok: true, src, tmax, tmin, fit: r,
      tiles: [tTmax, { key: 'tmin', label: 'Mínima medida', value: num(tmin), text: fx(tmin, 1), unit: '°C', explain: 'cvt.tmin', sensors: cvtS }],
      modelMsg: `Modelo térmico: ${r.msg}.`,
      fitPlot: {
        id: 'cvFit', explain: 'cvt.thermalModel', sensors: cvtS,
        series: [meas], xLabel: 's', yLabel: '°C', hlines: [{ id: 'limit', role: 'crit', y: +car.tCvtMax, label: 'limite' }],
      },
      projPlot: { id: 'cvProj', explain: 'cvt.enduranceProjection', sensors: modelS, empty: 'sem modelo' },
      note: '', explain: 'cvt.thermalModel', sensors: modelS,
    };
  }
  const th = r.th;
  const tiles: RepTile[] = [
    tTmax,
    { key: 'heatRate', label: 'Aquece andando', value: num(r.heatRate), text: fx(r.heatRate, 1), unit: '°C/min (média)', explain: 'cvt.heatRate', sensors: mergeSensors(cvtS, vehSpeedSensors(veh)) },
    { key: 'coolRate', label: 'Esfria parado', value: num(r.coolRate), text: fx(r.coolRate, 1), unit: '°C/min (média)', explain: 'cvt.coolRate', sensors: mergeSensors(cvtS, vehSpeedSensors(veh)) },
    { key: 'Tss', label: 'Regime no enduro', value: num(r.Tss), text: fx(r.Tss, 0), unit: `°C com ${fx(r.Pm, 1)} kW a ${fx(r.vm * 3.6, 0)} km/h`, explain: 'cvt.steadyState', sensors: modelS },
    { key: 'tau', label: 'Constante de tempo', value: num(r.tauMove / 60), text: fx(r.tauMove / 60, 1), unit: `min andando · ${isFinite(r.tauStop) ? fx(r.tauStop / 60, 0) + ' min parado' : '—'}`, explain: 'cvt.timeConstant', sensors: modelS },
    { key: 'Tend', label: `Após ${car.endurance} min`, value: num(r.Tend), text: fx(r.Tend, 0), unit: '°C repetindo este trecho', explain: 'cvt.enduranceProjection', sensors: modelS },
    { key: 'tReach', label: 'Chega no limite', value: num(r.tReach), text: ok(r.tReach) ? r.tReach.toFixed(0) : 'não', unit: ok(r.tReach) ? 'min de enduro' : `chega (limite ${car.tCvtMax} °C)`, explain: 'cvt.reachLimit', sensors: modelS },
    {
      key: 'coolNeed', label: 'Troca de calor', value: num(r.coolNeed > 1 ? (r.coolNeed - 1) * 100 : r.Tlim - r.Tss),
      text: r.coolNeed > 1 ? `+${((r.coolNeed - 1) * 100).toFixed(0)} %` : 'ok',
      unit: r.coolNeed > 1 ? `necessária para ficar em ${car.tCvtMax} °C` : `margem de ${fx(r.Tlim - r.Tss, 0)} °C no regime`,
      explain: 'cvt.coolingNeed', sensors: modelS,
    },
  ];
  const each10 = (r.Tss - r.Ta) * (1 - 1 / 1.1);
  const Tm: number[] = [];
  for (let i = i0; i <= i1; i += 5) Tm.push(r.Tm[i]);
  return {
    ok: true, src, tiles, tmax, tmin, fit: r,
    fitText: `Modelo ajustado (R² ${r.r2.toFixed(2)}, erro RMS ${r.rmse.toFixed(1)} °C):`,
    equation: `dT/dt = ${th[0].toExponential(2)}·P − (${th[1].toExponential(2)} + ${th[2].toExponential(2)}·v)·(T − ${r.Ta})`,
    unitsText: '(°C/s, P em kW na roda, v em m/s)',
    reading: `Leitura: o ar em movimento ${ok(r.vGain) && isFinite(r.vGain) ? `dobra a troca de calor a partir de ${(r.vGain * 3.6).toFixed(0)} km/h` : 'pouco muda a troca de calor'}; ` +
      `cada +10 % de troca de calor (duto, abertura, ventoinha) baixa o regime em ~${each10.toFixed(0)} °C. O regime supõe o enduro com o mesmo ritmo deste trecho.`,
    each10,
    fitPlot: {
      id: 'cvFit', explain: 'cvt.thermalModel', sensors: modelS,
      series: [meas, { id: 'model', role: 'c2', x: meas.x, y: Float64Array.from(Tm), label: 'modelo' }],
      xLabel: 's', yLabel: '°C', hlines: [{ id: 'limit', role: 'crit', y: +car.tCvtMax, label: 'limite' }],
      tipX: { dec: 0, suffix: ' s' }, fmtY: { dec: 1, suffix: ' °C' },
    },
    projPlot: projPlot(r, car, tmin, tmax, modelS),
    note: 'Modelo de 1ª ordem: o calor gerado na correia é proporcional à potência transmitida e a troca de calor cresce com a velocidade do carro. Não vê patinação da correia em baixa nem sol direto; confira com logs longos.',
    explain: 'cvt.thermalModel', sensors: modelS,
  };
}

function projPlot(r: CvtOk, car: SessionContext['cfg']['car'], tmin: number, tmax: number, sensors: SensorId[]): RepPlot {
  return {
    id: 'cvProj', explain: 'cvt.enduranceProjection', sensors,
    series: [{ id: 'projection', role: 'c1', x: r.proj.x, y: r.proj.y, label: 'projeção' }],
    hlines: [{ id: 'limit', role: 'crit', y: +car.tCvtMax, label: `limite ${car.tCvtMax} °C` }, { id: 'steady', role: 'muted', y: r.Tss, label: `regime ${r.Tss.toFixed(0)} °C` }],
    xLabel: 'min de enduro (começando na temperatura ambiente)', yLabel: '°C', yRange: [Math.min(+car.tAmb, tmin) - 5, Math.max(+car.tCvtMax, r.Tss, tmax) + 8],
    tipX: { dec: 0, suffix: ' min' }, fmtY: { dec: 1, suffix: ' °C' },
  };
}
