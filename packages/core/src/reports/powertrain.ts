/* Relatório da página Trem de força: porte de renderPower + renderCoast + showCoast
 * (legacy/js/vehicleui.js). As contas são as do app antigo (vehicle.js); aqui só se monta o
 * que a aba mostrava — blocos, tabela de largadas, séries dos gráficos no formato do BT.Plot
 * (sem cores nem callbacks), textos e avisos — mais os sensores que entraram em cada número.
 *
 * Este arquivo também define os tipos comuns dos relatórios (Rep*), usados por cvt.ts,
 * dynamics.ts, laps.ts e maps.ts. */
import type { CarConfig, SensorId } from '../types';
import type { Veh, VehMotion, Launch, Coast, CoastFit } from '../vehicle';
import type { SessionContext } from '../pipeline';
import { powerCurve, launches, findCoasts, coastFit } from '../vehicle';
import { quant } from '../analysis';
import { idxAt, range } from '../util';

/* ================================================================ tipos comuns */
/** Formato de um número no tooltip: v.toFixed(dec) + suffix (sign: '+' na frente se ≥ 0;
 *  prec: v.toPrecision(prec) no lugar do toFixed, como nos espectros do antigo). */
export interface RepFmt { dec: number; suffix: string; sign?: boolean; prec?: number }

/** Bloco de número (tile do app antigo): rótulo, valor em negrito e o texto pequeno embaixo. */
export interface RepTile {
  key: string;                   /* chave estável do bloco na página */
  label: string;
  value: number | null;          /* número cru (null = '—') */
  text: string;                  /* valor formatado igual ao antigo */
  unit: string;                  /* texto pequeno embaixo (unidade e contexto), igual ao antigo */
  explain: string;
  sensors: SensorId[];           /* sensores que de fato entraram nesta conta, nesta sessão */
}

/** Série de linha. role = cor da paleta (c1…c8, muted, crit, ref, cmp, pos, neg, FL…). */
export interface RepSeries { id: string; role?: string; label?: string; x: Float64Array; y: Float64Array; width?: number }
export interface RepPoints { id: string; x: Float64Array; y: Float64Array; alpha?: number }
export interface RepBars { x0: number; w: number; y: Float64Array; roles?: string[] }
export interface RepHLine { id: string; role?: string; y: number; label: string }
export interface RepMarker { x: number; id?: string; role?: string; label?: string }
export interface RepLegend { label: string; role: string }
/** Tooltip de uma barra: <b>title</b> note<br>text. */
export interface RepBarTip { title: string; note?: string; text: string }

/** Spec de gráfico no formato do BT.Plot (legacy/js/plots.js), sem cores nem callbacks. */
export interface RepPlot {
  id: string;                    /* id do gráfico no app antigo (pwCurve, cdPlot, ...) */
  explain: string;
  sensors: SensorId[];
  empty?: string;                /* mensagem no lugar do gráfico */
  series?: RepSeries[];
  points?: RepPoints;
  bars?: RepBars;
  hlines?: RepHLine[];
  markers?: RepMarker[];
  circles?: number[];
  xLabel?: string;
  yLabel?: string;
  logY?: boolean;
  equal?: boolean;
  xRange?: [number, number];
  yRange?: [number, number];
  zeroY?: boolean;
  legend?: RepLegend[];          /* legenda explícita (senão: séries com rótulo, se > 1) */
  tipX?: RepFmt;                 /* 1ª linha do tooltip: <b>texto</b> */
  fmtY?: RepFmt;
  barTips?: RepBarTip[];         /* tooltip de cada barra */
  clickSeek?: boolean;           /* clique no gráfico = ir ao ponto (ver laps.ts) */
}

/** Linha de tabela: o texto de cada célula (igual ao antigo) e os números crus. */
export interface RepRow {
  cells: string[];
  values: (number | null)[];
  role?: string;                 /* cor da marquinha da linha */
  seek?: number;                 /* s: clique = ir a este instante */
  explain?: string;
  sensors?: SensorId[];
}
export interface RepTable { id: string; explain: string; sensors: SensorId[]; columns: string[]; rows: RepRow[] }

/** Texto com explicação (fonte dos dados, notas). */
export interface RepText { text: string; explain: string; sensors: SensorId[] }

/** Texto do tooltip/eixo no formato RepFmt (a página usa para tipX/fmtY). */
export const fmtRep = (f: RepFmt, v: number): string => (f.sign && v >= 0 ? '+' : '') + (f.prec ? v.toPrecision(f.prec) : v.toFixed(f.dec)) + f.suffix;

/** Junta listas de sensores sem repetir (aceita false/null para os condicionais). */
export const mergeSensors = (...l: (SensorId | SensorId[] | false | null | undefined)[]): SensorId[] => {
  const out: SensorId[] = [];
  for (const x of l) for (const s of (Array.isArray(x) ? x : x ? [x] : [])) if (!out.includes(s)) out.push(s);
  return out;
};

/** Sensores da velocidade do veículo (veh.v, veh.ax, veh.dist): a roda (calibrada pelo GPS,
 *  se houve calibração) ou só o GPS. Sem velocidade: []. */
export const vehSpeedSensors = (veh: Pick<Veh, 'src' | 'kN' | 'v'>): SensorId[] =>
  !veh.v ? [] : veh.src === 'roda' ? (veh.kN ? ['wheel', 'gps'] : ['wheel']) : ['gps'];

/* mesmos helpers de vehicleui.js */
const ok = (v: number | null | undefined): v is number => v !== null && v !== undefined && v === v && isFinite(v);
const fx = (v: number | null | undefined, d = 1) => (ok(v) ? v.toFixed(d) : '—');
const num = (v: number | null | undefined): number | null => (ok(v) ? v : null);

/* ================================================================ trem de força */
export interface PowertrainOpts {
  /** valor do seletor de coast-down: índice do trecho achado ('0', '1', ...) ou 'm' (trecho
   *  dos gráficos). Valor que não existe na lista = o primeiro, como o <select> do antigo. */
  coastSel?: string | number;
  /** "Usar trecho dos gráficos": a janela de tempo dos gráficos (s). */
  coastManual?: { t0: number; t1: number } | null;
}

export interface CoastOption { value: string; label: string }

export interface CoastReport {
  options: CoastOption[];        /* lista do seletor cdSel */
  selected: string;              /* opção escolhida */
  coasts: Coast[];               /* trechos achados no trecho analisado */
  manual: (Coast | { i0: number; i1: number; t0: number; t1: number }) | null;
  fit: CoastFit | null;
  empty?: string;                /* sem ajuste: o texto do teste a fazer */
  rows: RepRow[];                /* resultado (cdRes): [nome, valor] */
  warn: string[];                /* avisos (antigo: '⚠ ' + join('; ') + '.') */
  note: string;                  /* massa usada e o que o botão faz */
  F30: number | null;            /* N a 30 km/h */
  apply: { crr: number; cda: number | null } | null;   /* "Usar estes Crr e CdA no carro" (cda null = não muda) */
  plot: RepPlot;
  explain: string;
  sensors: SensorId[];
}

export interface PowertrainReport {
  ok: boolean;                   /* false = sem velocidade (o conteúdo fica escondido) */
  empty?: string;
  src: RepText;                  /* de onde vem a velocidade (pwSrc) */
  tiles: RepTile[];
  vmax: number; amax: number; bmax: number;   /* m/s e g no trecho */
  pmax: number; pv: number;      /* kW e km/h do pico da curva */
  aTr: number; Ftr: number;      /* g (percentil 98) e N */
  best30: number;                /* s (Infinity = nenhuma) */
  curve: RepPlot | null;
  launchList: Launch[];
  launchTable: RepTable | null;
  launchEmpty?: string;
  slip: RepPlot | null;
  coast: CoastReport | null;
}

/** Trem de força no trecho [i0, i1] (= renderPower + renderCoast + showCoast). */
export function powertrainReport(ctx: Pick<SessionContext, 'S' | 'cfg' | 'veh' | 'track'>, i0: number, i1: number, opts: PowertrainOpts = {}): PowertrainReport {
  const veh0 = ctx.veh, car = ctx.cfg.car, t = ctx.S.t;
  if (!veh0 || !veh0.v) {
    return {
      ok: false, empty: 'Sem velocidade: o log não tem velocidade da roda nem GPS.',
      src: { text: '', explain: 'power.speedSource', sensors: [] }, tiles: [],
      vmax: NaN, amax: NaN, bmax: NaN, pmax: NaN, pv: NaN, aTr: NaN, Ftr: NaN, best30: NaN,
      curve: null, launchList: [], launchTable: null, slip: null, coast: null,
    };
  }
  const veh = veh0 as VehMotion;
  const spd = vehSpeedSensors(veh);
  const pwr = mergeSensors(spd, 'car_data');
  const src: RepText = {
    text: veh.wheel
      ? `Velocidade da roda: ${veh.wheel.name} (${car.wheelDriven ? 'roda de tração' : 'roda livre'})` +
        (veh.kN ? `, corrigida pelo GPS (fator ${veh.k.toFixed(4)}).` : ' — sem GPS para calibrar.')
      : 'Sem canal de velocidade da roda: usando o GPS (aceleração bem menos precisa).',
    explain: 'power.speedSource', sensors: spd,
  };
  let vmax = 0, amax = 0, bmax = 0;
  for (let i = i0; i <= i1; i++) {
    if (veh.v[i] > vmax) vmax = veh.v[i];
    if (veh.ax[i] > amax) amax = veh.ax[i];
    if (-veh.ax[i] > bmax) bmax = -veh.ax[i];
  }
  const pc = powerCurve(veh.v, veh.P, veh.ax, i0, i1, 2, veh.slip);
  let pmax = 0, pv = NaN;
  pc.y.forEach((y, k) => { if (y > pmax) { pmax = y; pv = pc.x[k]; } });
  /* tração: P = F·v; um percentil alto da aceleração evita picos do sensor */
  const accs: number[] = [];
  for (let i = i0; i <= i1; i++) if (veh.ax[i] > 0.05) accs.push(veh.ax[i]);
  accs.sort((a, b) => a - b);
  const aTr = quant(accs, 0.98), Ftr = (+car.mass) * aTr * 9.81;
  const gpsDist = !!(car.wheelDriven && ctx.track && ctx.track.ok);
  const dist = gpsDist && ctx.track.ok ? ctx.track.dist : veh.dist;
  const distS: SensorId[] = gpsDist ? ['gps'] : spd;
  const L = launches(t, veh.v, dist, veh.slip, veh.ax).filter(l => l.t0 >= t[i0] && l.t0 <= t[i1]);
  const best30 = Math.min(...L.map(l => l.d30).filter(ok));
  const launchS = mergeSensors(spd, distS);
  const tiles: RepTile[] = [
    {
      key: 'tireCal', label: 'A roda marca', value: veh.kN ? (1 / veh.k - 1) * 100 : null,
      text: veh.kN ? `${veh.k < 1 ? '+' : ''}${((1 / veh.k - 1) * 100).toFixed(1)} %` : '—',
      unit: veh.kN ? `em relação ao GPS · circunferência na FT × ${veh.k.toFixed(4)}` : 'precisa de GPS e roda',
      explain: 'power.tireCalibration', sensors: veh.kN ? ['wheel', 'gps'] : [],
    },
    { key: 'vmax', label: 'Velocidade máx.', value: num(vmax * 3.6), text: fx(vmax * 3.6, 1), unit: 'km/h', explain: 'power.vmax', sensors: spd },
    {
      key: 'pmax', label: 'Potência máx. na roda', value: num(pmax), text: fx(pmax, 2),
      unit: ok(pv) ? `kW a ${pv.toFixed(0)} km/h · ${(pmax / car.power * 100).toFixed(0)} % de ${car.power} kW` : 'kW',
      explain: 'power.wheelPower', sensors: pwr,
    },
    { key: 'ftr', label: 'Força trativa máx.', value: num(Ftr), text: fx(Ftr, 0), unit: `N (${fx(aTr, 2)} g, percentil 98)`, explain: 'power.tractiveForce', sensors: pwr },
    { key: 'best30', label: 'Melhor 0–30 m', value: isFinite(best30) ? best30 : null, text: isFinite(best30) ? best30.toFixed(2) : '—', unit: 's', explain: 'power.launch', sensors: isFinite(best30) ? launchS : [] },
    { key: 'bmax', label: 'Frenagem máx.', value: num(bmax), text: fx(bmax, 2), unit: 'g', explain: 'power.braking', sensors: spd },
    { key: 'res', label: 'Resistências usadas', value: null, text: `${car.crr} · ${car.cda}`, unit: 'Crr · CdA (m²)', explain: 'power.resistances', sensors: ['car_data'] },
  ];

  /* curva de potência */
  const sc: number[] = [], sp: number[] = [];
  for (let i = i0; i <= i1; i += 2) if (veh.v[i] > 1.5 && veh.ax[i] > 0.03 && ok(veh.P[i]) && !(veh.slip && veh.slip[i] > 0.12)) { sc.push(veh.v[i] * 3.6); sp.push(veh.P[i]); }
  const series: RepSeries[] = [{ id: 'power', role: 'c1', x: pc.x, y: pc.y, label: 'P na roda (percentil 90)', width: 2.5 }];
  if (Ftr > 0 && pmax > 0) {
    const vlim = pmax * 1000 / Ftr;                           /* onde tração e potência se encontram */
    series.push({ id: 'tractionLimit', role: 'muted', x: Float64Array.from([0, vlim * 3.6]), y: Float64Array.from([0, pmax]), label: 'limite de tração (F·v)' });
  }
  const curve: RepPlot = pc.x.length ? {
    id: 'pwCurve', explain: 'power.powerCurve', sensors: pwr,
    series, points: { id: 'samples', x: Float64Array.from(sc), y: Float64Array.from(sp), alpha: 0.12 },
    hlines: [{ id: 'engine', role: 'muted', y: +car.power, label: `motor ${car.power} kW` }],
    xLabel: 'km/h', yLabel: 'kW', yRange: [0, Math.max(pmax, +car.power) * 1.1],
    tipX: { dec: 0, suffix: ' km/h' }, fmtY: { dec: 2, suffix: ' kW' },
  } : { id: 'pwCurve', explain: 'power.powerCurve', sensors: pwr, empty: 'sem trechos acelerando' };

  /* largadas */
  const slipS: SensorId[] = veh.slip ? ['wheel', 'gps'] : [];
  const launchTable: RepTable | null = L.length ? {
    id: 'pwLaunch', explain: 'power.launch', sensors: mergeSensors(launchS, slipS),
    columns: ['#', 't', '0–10 m', '0–20 m', '0–30 m', '0–20 km/h', '0–40 km/h', 'Acel. máx.', 'Escorreg. 10 m'],
    rows: L.map((l, k) => ({
      cells: [`${k + 1}`, `${l.t0.toFixed(1)} s`, fx(l.d10, 2), fx(l.d20, 2), fx(l.d30, 2), fx(l.v20, 2), fx(l.v40, 2),
        `${fx(l.amax, 2)} g`, ok(l.slip10) ? (l.slip10 * 100).toFixed(0) + ' %' : '—'],
      values: [k + 1, l.t0, num(l.d10), num(l.d20), num(l.d30), num(l.v20), num(l.v40), num(l.amax), ok(l.slip10) ? l.slip10 * 100 : null],
      role: 'c' + (k % 4 + 1), seek: l.t0 - 0.5,
    })),
  } : null;
  let slip: RepPlot;
  if (veh.slip && L.length) {
    const vs = veh.slip;
    const ser = L.slice(0, 4).map((l, k): RepSeries => {
      const xs: number[] = [], ys: number[] = [], d0 = dist[l.i0];
      for (let i = l.i0; i < t.length && dist[i] - d0 <= 30; i++) if (ok(vs[i])) { xs.push(dist[i] - d0); ys.push(vs[i] * 100); }
      return { id: `launch${k + 1}`, role: 'c' + (k + 1), x: Float64Array.from(xs), y: Float64Array.from(ys), label: `largada ${k + 1}` };
    });
    slip = { id: 'pwSlip', explain: 'power.launchSlip', sensors: mergeSensors(slipS, distS), series: ser, xLabel: 'm desde a largada', yLabel: '% (roda × GPS)', zeroY: true, tipX: { dec: 1, suffix: ' m' }, fmtY: { dec: 0, suffix: ' %' } };
  } else slip = { id: 'pwSlip', explain: 'power.launchSlip', sensors: slipS, empty: car.wheelDriven ? 'precisa de largadas e GPS' : 'sensor na roda livre: não mede escorregamento' };

  return {
    ok: true, src, tiles, vmax, amax, bmax, pmax, pv, aTr, Ftr, best30,
    curve, launchList: L, launchTable,
    launchEmpty: L.length ? undefined : 'Nenhuma largada do carro parado neste trecho (parado ≥ 0,8 s e depois acelerando até 10 m).',
    slip, coast: coastReport(ctx, veh, car, i0, i1, opts),
  };
}

/* coast-down (= renderCoast + showCoast) */
function coastReport(ctx: Pick<SessionContext, 'S'>, veh: VehMotion, car: CarConfig, i0: number, i1: number, opts: PowertrainOpts): CoastReport {
  const t = ctx.S.t;
  const sens = mergeSensors(vehSpeedSensors(veh), 'car_data');
  const coasts = findCoasts(t, veh.v, veh.ax, i0, i1);
  const m = opts.coastManual;
  const manual = m ? { i0: idxAt(t, m.t0), i1: idxAt(t, m.t1), t0: m.t0, t1: m.t1 } : null;
  let options: CoastOption[] = coasts.map((c, k) => ({ value: String(k), label: `Trecho ${k + 1} · ${c.t0.toFixed(1)}–${c.t1.toFixed(1)} s · ${(c.v0 * 3.6).toFixed(0)} → ${(c.v1 * 3.6).toFixed(0)} km/h` }));
  if (manual) options.push({ value: 'm', label: `Trecho dos gráficos · ${manual.t0.toFixed(1)}–${manual.t1.toFixed(1)} s` });
  if (!options.length) options = [{ value: '', label: 'nenhum trecho de coast-down achado' }];
  const want = opts.coastSel === undefined || opts.coastSel === null ? undefined : String(opts.coastSel);
  const v = want !== undefined && options.some(o => o.value === want) ? want : options[0].value;
  const seg = v === 'm' ? manual : coasts[+v];
  const f = seg && v !== '' ? coastFit(veh.v, veh.a, seg.i0, seg.i1, +car.mass, +car.rho) : null;
  const base = { options, selected: v, coasts, manual, fit: f, explain: 'power.coastDown', sensors: sens };
  if (!f) {
    return {
      ...base, rows: [], warn: [], note: '', F30: null, apply: null,
      empty: 'Sem trecho de coast-down. Faça o teste: embale a ~40 km/h numa reta plana e deixe o carro desacelerar sozinho até ~10 km/h, sem frear. Repita nos dois sentidos para cancelar vento e inclinação.',
      plot: { id: 'cdPlot', explain: 'power.coastDown', sensors: sens, empty: 'sem trecho' },
    };
  }
  const F30 = f.A + f.B * (30 / 3.6) ** 2;
  const warn: string[] = [];
  if (f.r2 < 0.5) warn.push('ajuste ruidoso (R² baixo): repita o teste mais longo, em reta plana');
  if (!(f.cda > 0)) warn.push('CdA não confiável: velocidade baixa demais para separar o arrasto do rolamento');
  const rows: RepRow[] = [
    { cells: ['Resistência ao rolamento Crr', f.crr.toFixed(3)], values: [null, f.crr], explain: 'power.coastDown', sensors: sens },
    { cells: ['Área de arrasto CdA', f.cda > 0 ? f.cda.toFixed(2) + ' m²' : '—'], values: [null, f.cda > 0 ? f.cda : null], explain: 'power.coastDown', sensors: sens },
    { cells: ['Força para rolar a 30 km/h', `${F30.toFixed(0)} N · ${(F30 * 30 / 3.6 / 1000).toFixed(2)} kW`], values: [null, F30], explain: 'power.coastDown', sensors: sens },
    { cells: ['Ajuste', `R² ${f.r2.toFixed(2)} · ${f.n} amostras`], values: [null, f.r2], explain: 'power.coastDown', sensors: sens },
  ];
  let vm = 0;
  for (const x of f.v) if (x > vm) vm = x;
  const xs = Float64Array.from({ length: 30 }, (_, k) => vm * 3.6 * k / 29);
  return {
    ...base, rows, warn, F30,
    note: `Massa usada: ${car.mass} kg. “Usar estes Crr e CdA no carro” atualiza a potência na roda e o modelo da CVT.`,
    apply: { crr: +f.crr.toFixed(4), cda: f.cda > 0 ? +f.cda.toFixed(3) : null },
    plot: {
      id: 'cdPlot', explain: 'power.coastDown', sensors: sens,
      points: { id: 'samples', x: Float64Array.from(f.v, x => x * 3.6), y: f.F, alpha: 0.35 },
      series: [{ id: 'fit', role: 'c2', x: xs, y: Float64Array.from(xs, x => f.A + f.B * (x / 3.6) ** 2), label: 'ajuste Crr·m·g + ½ρCdA·v²', width: 2.5 }],
      xLabel: 'km/h', yLabel: 'força de resistência (N)', yRange: [0, range(f.F).hi * 1.1],
      tipX: { dec: 0, suffix: ' km/h' }, fmtY: { dec: 0, suffix: ' N' },
    },
  };
}
