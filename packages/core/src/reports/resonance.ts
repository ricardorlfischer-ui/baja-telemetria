/* Relatório da página Ressonância: porte de renderFreq, showDrop, showPsd e analyzeManual
 * (legacy/js/analysisui.js) e de renderRoadRes (legacy/js/vehicleui.js). Só a conta:
 * eventos de teste de queda (lista + selecionado), resultado por canto (fₙ, ζ, k, c),
 * gráfico do decaimento, espectro andando (modo do seletor frPsdMode), picos, pista ×
 * ressonância (λ e velocidades críticas) e as notas, com os textos do app antigo.
 *
 * O que no antigo dependia de interação entra como opção:
 *   dropIndex  evento selecionado (número do evento, 'manual' = trecho do gráfico)
 *   manual     [t0, t1] (s) do trecho analisado com "Analisar trecho dos gráficos"
 *   psdMode    'all' ou o id de um canto (devagar × rápido)
 *
 * Gráficos e tabelas usam os tipos Susp* de reports/suspension.ts. */
import type { SensorId } from '../types';
import type { ActiveShock, CornerId, DecayExt, DropTest, FreeDecay, Psd, RideRates } from '../analysis';
import type { RoadSpectrum } from '../vehicle';
import type { SessionContext } from '../pipeline';
import { CORNERS, dropTests, freeDecay, psdMask, quant, localPeaks, rideRates } from '../analysis';
import { roadSpectrum } from '../vehicle';
import { idxAt } from '../util';
import {
  suspCornerSensor, suspJoinSensors, suspStoppedSensors, suspSpeedSensors, suspNoShocksText, suspFoundSensors,
  type SuspColumn, type SuspMarker, type SuspPlot, type SuspSeries,
} from './suspension';

/* ---------------------------------------------------------------- tipos */
export interface ResonanceOptions {
  /** Evento selecionado: índice em `events` ou 'manual'. Inválido → o primeiro da lista. */
  dropIndex?: number | 'manual';
  /** Trecho do gráfico [t0, t1] em s (A.charts.v do antigo) analisado como decaimento livre. */
  manual?: [number, number] | null;
  /** 'all' (todos os amortecedores) ou um canto (devagar × rápido). Inválido → 'all'. */
  psdMode?: string;
}

/** Trecho analisado à mão (this.manual do antigo). */
export interface ResManual {
  t0: number;
  t1: number;
  res: (FreeDecay & { id: CornerId })[];
}

export type ResEventValue = number | 'manual' | null;
export interface ResEventOption { value: ResEventValue; label: string }

export interface ResDropRow {
  id: CornerId;
  ok: boolean;                   /* deu fₙ e ζ */
  cells: string[];               /* texto igual ao antigo (a última célula ocupa o resto) */
  sensors: SensorId[];
  fn: number | null;
  zeta: number | null;
  fd: number | null;
  used: string | null;
  rates: RideRates | null;
  msg: string | null;
}

export interface ResPeakRow {
  id: CornerId;
  all: number[];                 /* Hz, picos andando (do mais forte ao mais fraco) */
  slow: number[];
  fast: number[];
  drop: number | null;           /* fₙ do 1º teste de queda */
  cells: string[];
  sensors: SensorId[];
}

export interface ResRoadRow {
  lambda: number;                /* m */
  f: number;                     /* ciclos/m */
  p: number;
  vF: number;                    /* km/h que excita a dianteira (NaN sem fₙ) */
  vR: number;
  obs: string;
  cells: string[];
}

export interface ResonanceReport {
  hasShocks: boolean;
  empty: string | null;
  emptySensors: SensorId[];
  band: { fmin: number; fmax: number };
  /* ---------- teste de queda */
  events: DropTest[];
  eventOptions: ResEventOption[];
  selected: ResEventValue;
  manual: ResManual | null;
  drop: {
    explain: string;
    sensors: SensorId[];
    t: number | null;            /* s do evento selecionado (null = trecho manual ou nenhum) */
    message: string | null;      /* sem evento: a frase do antigo */
    columns: SuspColumn[];
    rows: ResDropRow[];
    plot: SuspPlot;
  };
  /* ---------- espectro andando */
  psd: {
    explain: string;
    sensors: SensorId[];
    modeOptions: { value: string; label: string }[];
    mode: string;
    vlo: number;                 /* km/h, corte devagar (NaN sem GPS) */
    vhi: number;
    spectra: Partial<Record<CornerId, { all: Psd | null; slow?: Psd | null; fast?: Psd | null }>>;
    plot: SuspPlot;
  };
  peaks: {
    explain: string;
    sensors: SensorId[];
    columns: SuspColumn[];
    rows: ResPeakRow[];
  };
  note: { text: string; fs: number; explain: string; sensors: SensorId[] };
  /* ---------- pista × ressonância */
  road: {
    explain: string;
    sensors: SensorId[];
    spectrum: RoadSpectrum | null;
    message: string | null;      /* sem dados: a frase do antigo */
    columns: SuspColumn[];
    rows: ResRoadRow[];
    note: string;
    fnF: number;                 /* Hz, média do eixo no 1º teste de queda (NaN sem) */
    fnR: number;
    v10: number;                 /* km/h, faixa de velocidade usual */
    v50: number;
    v90: number;
    plot: SuspPlot;
  };
}

/* ---------------------------------------------------------------- formatação (igual ao antigo) */
/* analysisui.js */
const fx = (v: number | null | undefined, d = 1) => (v === v && v !== null && v !== undefined && isFinite(v) ? v.toFixed(d) : '—');
/* vehicleui.js */
const ok = (v: number | null | undefined): v is number => v !== null && v !== undefined && v === v && isFinite(v);
const fxv = (v: number | null | undefined, d = 1) => (ok(v) ? v.toFixed(d) : '—');
const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);

/* resultado do teste de queda por eixo (média dos dois lados) */
function axleDrop(ev: { res: (FreeDecay & { id: CornerId })[] } | null | undefined, axle: 'F' | 'R') {
  const ids = axle === 'F' ? ['FL', 'FR'] : ['RL', 'RR'];
  const r = ev ? ev.res.filter(x => ids.includes(x.id) && x.ok && !x.over) : [];
  return { fn: mean(r.map(x => (x as { fn: number }).fn)), zeta: mean(r.map(x => (x as { zeta: number }).zeta)), n: r.length, ids: r.map(x => x.id) };
}

const DROP_COLUMNS: SuspColumn[] = [
  { key: 'corner', label: 'Canto' },
  { key: 'fn', label: 'f natural', explain: 'susp.naturalFreq' },
  { key: 'zeta', label: 'ζ', explain: 'susp.naturalFreq' },
  { key: 'fd', label: 'f amortecida', explain: 'susp.naturalFreq' },
  { key: 'used', label: 'Medido com', explain: 'freq.dropTest' },
  { key: 'k', label: 'Rigidez na roda', explain: 'susp.rideRate' },
  { key: 'c', label: 'c na roda', explain: 'susp.dampingCoeff' },
  { key: 'cShock', label: 'c no amortecedor', explain: 'susp.dampingCoeff' },
];
const ROAD_COLUMNS: SuspColumn[] = [
  { key: 'lambda', label: 'Ondulação λ', explain: 'freq.roadWavelength' },
  { key: 'vF', label: 'Excita a dianteira a', explain: 'freq.criticalSpeed' },
  { key: 'vR', label: 'Excita a traseira a', explain: 'freq.criticalSpeed' },
  { key: 'obs', label: 'Leitura', explain: 'freq.criticalSpeed' },
];

/** Trecho do gráfico analisado como decaimento livre (analyzeManual do antigo): [t0, t1] em s.
 *  null sem amortecedor com sinal. */
export function resonanceManual(ctx: SessionContext, t0: number, t1: number): ResManual | null {
  const t = ctx.S.t;
  const i0 = idxAt(t, t0), i1 = idxAt(t, t1);
  const act = ctx.susp.shocks.filter((k): k is ActiveShock => k.active);
  if (!act.length) return null;
  return { t0, t1, res: act.map(k => Object.assign({ id: k.id }, freeDecay(t, k.disp, i0, i1))) };
}

/** Página Ressonância no trecho [i0, i1] (= renderFreq + showDrop + showPsd + renderRoadRes;
 *  com opts.manual, também analyzeManual). */
export function resonanceReport(ctx: SessionContext, i0: number, i1: number, opts: ResonanceOptions = {}): ResonanceReport {
  const A = ctx, S = A.S, t = S.t, sp = A.cfg.susp, sh = (A.susp || { shocks: [] }).shocks;
  const act = sh.filter((k): k is ActiveShock => k.active);
  const fmin = +sp.fmin || 0.6, fmax = +sp.fmax || 4.5;
  const stopS = suspStoppedSensors(A);
  const shockS = act.map(k => suspCornerSensor(k.id));
  const rep: ResonanceReport = {
    hasShocks: act.length > 0, empty: null, emptySensors: [],
    band: { fmin, fmax },
    events: [], eventOptions: [], selected: null, manual: null,
    drop: { explain: 'freq.dropTest', sensors: [], t: null, message: null, columns: DROP_COLUMNS, rows: [], plot: { key: 'frDropPlot', title: 'Teste de queda', explain: 'freq.dropTest', sensors: [] } },
    psd: { explain: 'freq.spectrum', sensors: [], modeOptions: [], mode: 'all', vlo: NaN, vhi: NaN, spectra: {}, plot: { key: 'frPsd', title: 'Espectro com o carro andando', explain: 'freq.spectrum', sensors: [] } },
    peaks: { explain: 'freq.peaks', sensors: [], columns: [], rows: [] },
    note: { text: '', fs: NaN, explain: 'freq.sampleRate', sensors: [] },
    road: {
      explain: 'freq.roadWavelength', sensors: [], spectrum: null, message: null, columns: ROAD_COLUMNS, rows: [], note: '',
      fnF: NaN, fnR: NaN, v10: NaN, v50: NaN, v90: NaN,
      plot: { key: 'rrPlot', title: 'Pista × ressonância', explain: 'freq.roadWavelength', sensors: [] },
    },
  };
  if (!act.length) {
    rep.empty = suspNoShocksText(sh);
    rep.emptySensors = suspFoundSensors(sh);
    return rep;
  }

  /* ---------- testes de queda achados no trecho */
  const events = rep.events = dropTests(t, sh, A.stopped, i0, i1);
  const manual = rep.manual = opts.manual ? resonanceManual(A, opts.manual[0], opts.manual[1]) : null;
  const options: ResEventOption[] = events.map((e, k) => ({ value: k, label: `Evento ${k + 1} · t = ${e.t.toFixed(2)} s` }));
  if (manual) options.push({ value: 'manual', label: `Trecho do gráfico · ${manual.t0.toFixed(1)}–${manual.t1.toFixed(1)} s` });
  if (!options.length) options.push({ value: null, label: 'nenhum evento achado' });
  rep.eventOptions = options;
  /* como o <select> do antigo: mantém a escolha se ela ainda existe, senão fica a 1ª opção */
  const want: ResEventValue = opts.dropIndex === undefined ? options[0].value : opts.dropIndex;
  const sel = rep.selected = options.some(o => o.value === want) ? want : options[0].value;
  const drop = sel === 'manual' ? manual : sel === null ? null : events[sel];
  showDrop(A, rep, drop, sel === 'manual' ? null : drop ? (drop as DropTest).t : null, stopS);

  /* ---------- espectro andando */
  const mv = A.stopped ? Uint8Array.from(A.stopped, v => 1 - v) : null;
  const speeds: number[] = [];
  if (A.track && A.track.ok) for (let i = i0; i <= i1; i++) if (mv && mv[i] && A.track.speed[i] === A.track.speed[i]) speeds.push(A.track.speed[i]);
  speeds.sort((a, b) => a - b);
  /* devagar × rápido: a excitação da pista muda de frequência com a velocidade, a
   * ressonância não. Separa o mais possível (terços) mas precisa de trechos de ~5 s
   * seguidos em cada faixa; se não der, aproxima os cortes até a mediana. */
  const P: ResonanceReport['psd']['spectra'] = {};
  act.forEach(k => { P[k.id] = { all: psdMask(t, k.disp, i0, i1, mv, 2, 256) || psdMask(t, k.disp, i0, i1, mv, 2, 128) }; });
  let vlo = NaN, vhi = NaN;
  for (const [ql, qh] of [[1 / 3, 2 / 3], [0.4, 0.6], [0.5, 0.5]]) {
    if (!speeds.length) break;
    const tr = A.track as Extract<typeof A.track, { ok: true }>, m = mv!;
    const a = quant(speeds, ql), b = quant(speeds, qh);
    const slow = Uint8Array.from(tr.speed, (v, i) => (m[i] && v < a ? 1 : 0));
    const fast = Uint8Array.from(tr.speed, (v, i) => (m[i] && v >= b ? 1 : 0));
    const r = act.map(k => [psdMask(t, k.disp, i0, i1, slow, 2, 128), psdMask(t, k.disp, i0, i1, fast, 2, 128)]);
    if (r.every(([s, f]) => s && f && s.nseg >= 2 && f.nseg >= 2) || ql === 0.5) {
      act.forEach((k, j) => { P[k.id]!.slow = r[j][0]; P[k.id]!.fast = r[j][1]; });
      vlo = a; vhi = b;
      break;
    }
  }
  const ps = rep.psd;
  ps.spectra = P;
  ps.modeOptions = [{ value: 'all', label: 'todos os amortecedores' }, ...act.map(k => ({ value: k.id as string, label: `${k.id}: devagar × rápido` }))];
  ps.mode = opts.psdMode !== undefined && ps.modeOptions.some(o => o.value === opts.psdMode) ? opts.psdMode : 'all';
  ps.vlo = vlo; ps.vhi = vhi;
  const speedS: SensorId[] = speeds.length ? ['gps'] : [];
  ps.sensors = suspJoinSensors(ps.mode === 'all' ? shockS : [suspCornerSensor(ps.mode as CornerId)], mv && stopS, ps.mode === 'all' ? [] : speedS);
  ps.plot = showPsd(rep, act, drop, fmin, fmax, ps.sensors);

  /* ---------- tabela de picos */
  const pk = rep.peaks;
  pk.columns = [
    { key: 'corner', label: 'Canto' },
    { key: 'all', label: 'Picos andando (Hz)', explain: 'freq.peaks' },
    { key: 'slow', label: `Devagar (< ${fx(vlo, 0)} km/h)`, explain: 'freq.speedSplit' },
    { key: 'fast', label: `Rápido (≥ ${fx(vhi, 0)} km/h)`, explain: 'freq.speedSplit' },
    { key: 'drop', label: 'Teste de queda', explain: 'susp.naturalFreq' },
  ];
  const ev0 = events && events[0];
  act.forEach(k => {
    const Pk = P[k.id]!, peaks = (r: Psd | null | undefined) => (r ? localPeaks(r.f, r.p, fmin, fmax, 3) : []);
    const a = peaks(Pk.all), s = peaks(Pk.slow), f = peaks(Pk.fast);
    const d = ev0 && ev0.res.find(r => r.id === k.id);
    const dfn = d && d.ok && !d.over ? d.fn : null;
    pk.rows.push({
      id: k.id, all: a.map(x => x.f), slow: s.map(x => x.f), fast: f.map(x => x.f), drop: dfn,
      sensors: suspJoinSensors(suspCornerSensor(k.id), mv && stopS, (s.length > 0 || f.length > 0) && speedS),
      cells: [k.id, a.map(x => x.f.toFixed(2)).join(' · ') || '—', s.map(x => x.f.toFixed(2)).join(' · ') || '—',
        f.map(x => x.f.toFixed(2)).join(' · ') || '—', dfn !== null ? dfn.toFixed(2) : '—'],
    });
  });
  pk.sensors = suspJoinSensors(...pk.rows.map(r => r.sensors));

  const fs = (i1 - i0) / (t[i1] - t[i0]);
  rep.note = {
    fs, explain: 'freq.sampleRate', sensors: ['logger', ...shockS],
    text: `Log a ${fs.toFixed(0)} Hz → só enxerga até ${(fs / 2).toFixed(1)} Hz. ` +
      `A frequência da roda (massa não suspensa, ~8–15 Hz) fica no limite ou acima disso. Para vê-la, grave os amortecedores a 100 Hz ou mais, se a FT permitir.`,
  };

  roadRes(A, i0, i1, rep, act, ev0 || null);
  return rep;
}

/* showDrop: tabela e gráfico do evento selecionado */
function showDrop(A: SessionContext, rep: ResonanceReport, ev: { res: (FreeDecay & { id: CornerId })[] } | null | undefined, evT: number | null, stopS: SensorId[]): void {
  const d = rep.drop;
  d.t = evT;
  if (!ev) {
    d.message = 'Nenhum teste de queda achado com o carro parado neste trecho. Dê zoom no trecho do evento nos gráficos (Shift + arrastar) e clique em “Analisar trecho do gráfico”.';
    d.sensors = suspJoinSensors(A.susp.shocks.filter(k => k.active).map(k => suspCornerSensor(k.id)), stopS);
    d.plot = { key: 'frDropPlot', title: 'Teste de queda', explain: 'freq.dropTest', sensors: d.sensors, empty: 'sem evento' };
    return;
  }
  /* o trecho manual não usa a máscara "parado"; os eventos achados, sim */
  const evS = evT === null ? [] : stopS;
  const series: SuspSeries[] = [];
  const car = A.cfg.car;
  ev.res.forEach(r => {
    const k = CORNERS.find(c => c.id === r.id)!, F = k.axle === 'F';
    const g = r.ok && !r.over ? r : null;
    const msg = (r as { msg?: string }).msg;
    const rr = g ? rideRates(g.fn, g.zeta, +(F ? car.massF : car.massR), +(F ? car.mrF : car.mrR)) : null;
    const cells: string[] = [r.id];
    if (g) {
      cells.push(`${fx(g.fn, 2)} Hz`, fx(g.zeta, 2), `${fx(g.fd, 2)} Hz`, g.used,
        rr ? fx(rr.k / 1000, 1) + ' N/mm' : 'informe a massa', rr ? fx(rr.c, 0) + ' N·s/m' : '—',
        rr && rr.cShock === rr.cShock ? fx(rr.cShock, 0) + ' N·s/m' : '—');
    } else cells.push(msg || 'sem resultado');
    d.rows.push({
      id: r.id, ok: !!g, cells,
      sensors: suspJoinSensors(suspCornerSensor(r.id), evS, rr && 'car_data'),
      fn: g ? g.fn : null, zeta: g ? g.zeta : null, fd: g ? g.fd : null, used: g ? g.used : null,
      rates: rr, msg: g ? null : msg || null,
    });
    if (r.ts) {
      const E = (r as { E?: DecayExt[] }).E;
      const t0 = E ? E[0].t : r.ts[0];
      series.push({ id: r.id, x: Float64Array.from(r.ts, x => x - t0), y: r.d!, label: r.id, dots: (E || []).map(e => ({ x: e.t - t0, y: e.a })) });
    }
  });
  d.sensors = suspJoinSensors(...d.rows.map(r => r.sensors));
  d.plot = {
    key: 'frDropPlot', title: 'Teste de queda', explain: 'freq.dropTest', sensors: suspJoinSensors(ev.res.map(r => suspCornerSensor(r.id)), evS),
    series, xLabel: 's depois do pico', yLabel: 'mm (em relação à base)', zeroY: true, xRange: [-0.2, 1.6],
  };
}

/* showPsd: espectro no modo escolhido, com a banda e a fₙ do teste de queda selecionado */
function showPsd(rep: ResonanceReport, act: ActiveShock[], drop: { res: (FreeDecay & { id: CornerId })[] } | null | undefined,
  fmin: number, fmax: number, sensors: SensorId[]): SuspPlot {
  const mode = rep.psd.mode, P = rep.psd.spectra;
  const markers: SuspMarker[] = [{ x: fmin, role: 'band' }, { x: fmax, role: 'band' }];
  const series: SuspSeries[] = [];
  if (mode === 'all') {
    act.forEach((k, j) => {
      const r = P[k.id] && P[k.id]!.all;
      if (r) series.push({ id: k.id, x: r.f, y: r.p, label: k.id });
      const d = drop && drop.res.find(q => q.id === k.id);
      if (d && d.ok && !d.over) markers.push({ x: d.fn, role: k.id, label: `queda ${k.id}`, row: j });
    });
  } else {
    const Pm = P[mode as CornerId] || {} as { slow?: Psd | null; fast?: Psd | null };
    if (Pm.slow) series.push({ id: 'slow', x: Pm.slow.f, y: Pm.slow.p, label: `devagar (< ${fx(rep.psd.vlo, 0)} km/h)` });
    if (Pm.fast) series.push({ id: 'fast', x: Pm.fast.f, y: Pm.fast.p, label: `rápido (≥ ${fx(rep.psd.vhi, 0)} km/h)` });
    const d = drop && drop.res.find(q => q.id === mode);
    if (d && d.ok && !d.over) markers.push({ x: d.fn, role: 'drop', label: `queda ${fx(d.fn, 2)} Hz` });
  }
  const base = { key: 'frPsd', title: 'Espectro com o carro andando', explain: 'freq.spectrum', sensors };
  return series.length
    ? { ...base, series, logY: true, xLabel: 'Hz', yLabel: 'mm²/Hz', markers, xRange: [0, series[0].x[series[0].x.length - 1]] }
    : { ...base, empty: 'trecho andando curto demais para o espectro (precisa de ≥ 5 s seguidos)' };
}

/* renderRoadRes: espectro em distância × frequência natural */
function roadRes(A: SessionContext, i0: number, i1: number, rep: ResonanceReport, act: ActiveShock[], ev: DropTest | null): void {
  const rd = rep.road;
  const dist = A.veh && A.veh.dist ? A.veh.dist : A.track && A.track.ok ? A.track.dist : null;
  const distS: SensorId[] = A.veh && A.veh.dist ? suspSpeedSensors(A) : dist ? ['gps'] : [];
  const mv = A.stopped ? Uint8Array.from(A.stopped, x => 1 - x) : null;
  const r = dist && mv && act.length ? roadSpectrum(act.map(k => k.disp), dist, mv, i0, i1) : null;
  const shockS = act.map(k => suspCornerSensor(k.id));
  const baseS = suspJoinSensors(shockS, distS, mv && suspStoppedSensors(A));
  rd.spectrum = r;
  if (!r) {
    rd.message = 'Precisa de distância (roda ou GPS), amortecedores com sinal e trechos andando de pelo menos ~70 m.';
    rd.sensors = baseS;
    rd.plot = { key: 'rrPlot', title: 'Pista × ressonância', explain: 'freq.roadWavelength', sensors: baseS, empty: 'sem dados' };
    return;
  }
  const F = axleDrop(ev, 'F'), R = axleDrop(ev, 'R');
  const sp: number[] = [];
  for (let i = i0; i <= i1; i++) if (mv![i] && A.veh && A.veh.v && A.veh.v[i] > 1) sp.push(A.veh.v[i] * 3.6);
  sp.sort((a, b) => a - b);
  const v10 = quant(sp, 0.1), v50 = quant(sp, 0.5), v90 = quant(sp, 0.9);
  const peaks = localPeaks(r.f, r.p, 1 / 16, 1 / 0.8, 5);
  const crit = (fn: number, lam: number) => (ok(fn) ? fn * lam * 3.6 : NaN);
  peaks.forEach(p => {
    const lam = 1 / p.f, vf = crit(F.fn, lam), vr = crit(R.fn, lam);
    let obs = '';
    const self = [F.fn, R.fn].some(fn => ok(fn) && Math.abs(lam - v50 / 3.6 / fn) / lam < 0.15);
    if (self) obs = 'provável a própria ressonância (λ ≈ v típica ÷ fₙ)';
    else if ([vf, vr].some(v => ok(v) && v >= v10 && v <= v90)) obs = '⚠ cai na faixa de velocidade usual';
    rd.rows.push({
      lambda: lam, f: p.f, p: p.p, vF: vf, vR: vr, obs,
      cells: [`${lam.toFixed(1)} m`, ok(vf) ? vf.toFixed(0) + ' km/h' : '—', ok(vr) ? vr.toFixed(0) + ' km/h' : '—', obs],
    });
  });
  rd.note = ok(F.fn) || ok(R.fn)
    ? `Com fn do teste de queda: diant. ${fxv(F.fn, 2)} Hz, tras. ${fxv(R.fn, 2)} Hz. Faixa de velocidade usual (10–90 %): ${fxv(v10, 0)}–${fxv(v90, 0)} km/h.`
    : 'Faça um teste de queda (aba Ressonância) para calcular as velocidades críticas.';
  rd.fnF = F.fn; rd.fnR = R.fn; rd.v10 = v10; rd.v50 = v50; rd.v90 = v90;
  /* velocidades críticas: + os amortecedores do teste de queda e o "parado" que achou o evento */
  const dropS = suspJoinSensors([...F.ids, ...R.ids].map(id => suspCornerSensor(id as CornerId)), (F.n > 0 || R.n > 0) && suspStoppedSensors(A));
  rd.sensors = suspJoinSensors(baseS, dropS, sp.length > 0 && suspSpeedSensors(A));
  rd.plot = {
    key: 'rrPlot', title: 'Pista × ressonância', explain: 'freq.roadWavelength', sensors: baseS,
    series: [{ id: 'road', x: r.f, y: r.p, label: 'curso (média dos amortecedores)' }],
    logY: true, legend: [], xRange: [0, 1.25],
    markers: peaks.map((p, k) => ({ x: p.f, role: 'peak', label: `${(1 / p.f).toFixed(1)} m`, row: k % 3 })),
    xLabel: 'ciclos por metro (1/λ)', yLabel: 'mm²·m',
  };
}
