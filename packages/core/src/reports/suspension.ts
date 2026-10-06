/* Relatório da página Suspensão: porte de renderSusp (legacy/js/analysisui.js) e
 * renderSuspExtra (legacy/js/vehicleui.js). Só a conta: devolve as tabelas (valores e o
 * texto formatado igual ao do app antigo), os gráficos no formato do spec do BT.Plot
 * (legacy/js/plots.js) sem cores nem callbacks (cada série/barra/marcador tem um id/role
 * para a página escolher a cor; os tooltips vêm como dados: barTips/tipX/fmtY no formato
 * de RepPlot), as notas e os estados vazios.
 *
 * Cada tabela, coluna, linha e gráfico leva `explain` (id do card em explain.ts) e
 * `sensors` (os sensores que DE FATO entraram naquela conta nesta sessão).
 *
 * Os tipos de gráfico/tabela (Susp*) também são usados por reports/resonance.ts. */
import type { CarConfig, SensorId } from '../types';
import type { ActiveShock, CornerId, Shock, VelStats } from '../analysis';
import type { Gradients, Jump, BottomOut, LinFit } from '../vehicle';
import type { SessionContext } from '../pipeline';
import type { RepBarTip, RepFmt } from './powertrain';
import { velStats, quant, hist } from '../analysis';
import { gradients, jumps, bottomOuts } from '../vehicle';
import { niceTicks } from '../util';
import { SHOCK_STILL_MM } from '../quality';

/* ---------------------------------------------------------------- tipos (gráficos) */
/** Série de linha do spec do BT.Plot, sem cor: `id` diz quem é (canto, 'fit', 'brake'...). */
export interface SuspSeries {
  id: string;
  x: ArrayLike<number>;
  y: ArrayLike<number>;
  label?: string;
  width?: number;
  dots?: { x: number; y: number }[];
}
/** Barras: barra j cobre [x0 + j·w, x0 + (j+1)·w); roles[j] escolhe a cor. */
export interface SuspBars { x0: number; w: number; y: ArrayLike<number>; roles: string[] }
export interface SuspPoints { x: ArrayLike<number>; y: ArrayLike<number>; alpha?: number }
/** Marcador vertical em x (role: 'knee', 'static', 'band', 'drop', 'peak' ou um canto). */
export interface SuspMarker { x: number; role: string; label?: string; row?: number }
export interface SuspLegendItem { label: string; role: string }
/** Spec de um gráfico XY (o do BT.Plot sem cores nem callbacks). `key` é o id do elemento
 *  no app antigo (spvFL, grRoll, frPsd...). Com `empty`, o gráfico mostra só a mensagem. */
export interface SuspPlot {
  key: string;
  title: string;
  explain: string;
  sensors: SensorId[];
  empty?: string;
  series?: SuspSeries[];
  bars?: SuspBars;
  points?: SuspPoints;
  markers?: SuspMarker[];
  legend?: SuspLegendItem[];
  xLabel?: string;
  yLabel?: string;
  logY?: boolean;
  zeroY?: boolean;
  xRange?: [number, number];
  /** Tooltips no mesmo formato de RepPlot (powertrain.ts): tipX = 1ª linha (<b>texto</b>),
   *  fmtY = valor de cada série, barTips = <b>title</b><br>text de cada barra. */
  tipX?: RepFmt;
  fmtY?: RepFmt;
  barTips?: RepBarTip[];
}
/** Coluna de tabela: o texto do cabeçalho igual ao antigo e o card que explica a coluna. */
export interface SuspColumn { key: string; label: string; explain?: string }

/* ---------------------------------------------------------------- tipos (relatório) */
/** Linha da tabela por canto. `cells` é o texto de cada célula igual ao do app antigo; quando
 *  há menos células que colunas, a última ocupa as colunas que faltam (colspan). */
export interface SuspCornerRow {
  id: CornerId;
  label: string;
  active: boolean;
  cells: string[];
  sensors: SensorId[];
  explain: string;
  static?: number;               /* mm */
  staticFromStop?: boolean;      /* false = mediana do log todo (o * do antigo) */
  min?: number;                  /* mm, no trecho */
  max?: number;
  used?: number;                 /* mm = máx − mín */
  stroke?: number;               /* mm, curso total informado (0 = não informado) */
  usedFrac?: number | null;      /* used / stroke (null sem curso) */
  vel?: VelStats | null;         /* null = sem amostras andando */
  vCalc?: boolean;
  /** Com sinal mas quase parado no trecho (curso usado < SHOCK_STILL_MM): ruído, não curso. */
  still?: boolean;
}

/** Aviso dos amortecedores com sinal mas quase parados no trecho (< SHOCK_STILL_MM). */
export interface SuspStillWarning {
  ids: CornerId[];
  limit: number;                 /* mm (= SHOCK_STILL_MM) */
  text: string;
  explain: string;
  sensors: SensorId[];
}

export interface SuspJumpRow {
  n: number;                     /* 1, 2, ... */
  t: number;                     /* s, decolagem (o antigo vai para t − 0,5 s ao clicar) */
  seekT: number;                 /* t − 0,5 */
  jump: Jump;
  cells: string[];
  sensors: SensorId[];
}

export interface SuspensionReport {
  /** Há amortecedor com sinal? Sem nenhum, só `empty` vale (o resto fica vazio). */
  hasShocks: boolean;
  empty: string | null;
  emptySensors: SensorId[];
  /** Opções do app antigo (cfg.susp) e se a máscara "andando" foi de fato aplicada. */
  options: { compPos: boolean; knee: number; moving: boolean; movingApplied: boolean };
  table: {
    explain: string;
    columns: SuspColumn[];
    rows: SuspCornerRow[];
    note: string;
    sensors: SensorId[];
  };
  /** Amortecedores com sinal mas quase parados no trecho (null = nenhum). */
  still: SuspStillWarning | null;
  /** Histogramas de velocidade (spv<ID>) e de curso (spp<ID>), mesma escala em todos. */
  velHist: SuspPlot[];
  posHist: SuspPlot[];
  velScale: { R: number; bw: number; nb: number };
  posScale: { lo: number; w: number; nb: number };
  /** Rolagem e arfagem da carroceria × acelerações. */
  body: {
    note: string;
    noteSensors: SensorId[];
    gradients: Gradients;
    rollTitle: string;
    roll: LinFit | null;
    rollPlot: SuspPlot;
    pitchTitle: string;
    pitchBrake: LinFit | null;
    pitchAccel: LinFit | null;
    pitchPlot: SuspPlot;
  };
  /** Saltos e impactos (jpTable). */
  jumps: {
    explain: string;
    sensors: SensorId[];
    list: Jump[];
    columns: SuspColumn[];
    rows: SuspJumpRow[];
    none: string | null;         /* 'Nenhum salto detectado neste trecho.' */
  };
  /** Batidas no fim de curso (≥ 95 % do curso total). */
  bottom: {
    explain: string;
    sensors: SensorId[];
    strokeKnown: boolean;
    events: BottomOut[];
    counts: { id: CornerId; n: number }[];
    text: string;
  };
}

/* ---------------------------------------------------------------- formatação (igual ao antigo) */
/* analysisui.js */
const fx = (v: number | null | undefined, d = 1) => (v === v && v !== null && v !== undefined && isFinite(v) ? v.toFixed(d) : '—');
const pct = (v: number) => (v === v ? (v * 100).toFixed(0) + ' %' : '—');
/* vehicleui.js */
const ok = (v: number | null | undefined): v is number => v !== null && v !== undefined && v === v && isFinite(v);

/* ---------------------------------------------------------------- sensores (comuns aos relatórios) */
/** Sensor do amortecedor de um canto. */
export const suspCornerSensor = (id: CornerId): SensorId => ('shock_' + id.toLowerCase()) as SensorId;
/** Junta listas de sensores sem repetir, na ordem em que aparecem. */
export const suspJoinSensors = (...lists: (SensorId[] | SensorId | null | undefined | false)[]): SensorId[] => {
  const out: SensorId[] = [];
  for (const l of lists) {
    if (!l) continue;
    for (const s of Array.isArray(l) ? l : [l]) if (!out.includes(s)) out.push(s);
  }
  return out;
};
/** De onde veio a máscara "parado" (ctx.stopped): GPS (andou < 3 m em 3 s) ou, sem GPS,
 *  a velocidade da roda abaixo de 0,8 m/s. */
export const suspStoppedSensors = (ctx: Pick<SessionContext, 'track' | 'stopped'>): SensorId[] =>
  !ctx.stopped ? [] : ctx.track && ctx.track.ok ? ['gps'] : ['wheel'];
/** Sensores da velocidade do carro (veh.v): roda (calibrada pelo GPS quando dá) ou GPS. */
export const suspSpeedSensors = (ctx: Pick<SessionContext, 'veh'>): SensorId[] => {
  const veh = ctx.veh;
  if (!veh || !veh.v) return [];
  return veh.src === 'roda' ? (veh.kN ? ['wheel', 'gps'] : ['wheel']) : ['gps'];
};
/** Sensores da aceleração longitudinal e lateral usadas (ctx.acc), como no recompute:
 *  lon = veh.ax (roda ou GPS) || dyn.along (GPS); lat = roda × guinada do GPS || dyn.alat. */
export const suspAccSensors = (ctx: Pick<SessionContext, 'veh' | 'dyn' | 'acc'>): { lon: SensorId[]; lat: SensorId[] } => {
  const veh = ctx.veh, acc = ctx.acc || {};
  const lon: SensorId[] = !acc.lon ? [] : veh && veh.ax ? suspSpeedSensors(ctx) : ['gps'];
  const lat: SensorId[] = !acc.lat ? [] : veh && veh.wheel && veh.ay ? ['wheel', 'gps'] : ['gps'];
  return { lon, lat };
};

/** Texto do estado vazio "sem amortecedores" (noShocks do antigo), sem HTML. */
export function suspNoShocksText(shocks: Shock[]): string {
  const found = shocks.filter(k => k.pos).map(k => `${k.id}: ${k.pos!.name}${k.active ? '' : ' (constante = sem sinal)'}`);
  return 'Nenhum amortecedor com sinal neste trecho/log.' +
    (found.length ? ` Canais encontrados: ${found.join(' · ')}.` : ' Nenhum canal com “Shock”, “amort” ou “susp” no nome.');
}
/** Sensores citados no estado vazio: os amortecedores cujo canal existe (mesmo constante). */
export const suspFoundSensors = (shocks: Shock[]): SensorId[] => shocks.filter(k => k.pos).map(k => suspCornerSensor(k.id));

const activeOf = (shocks: Shock[]) => shocks.filter((k): k is ActiveShock => k.active);

/* ---------------------------------------------------------------- colunas */
const CORNER_COLUMNS: SuspColumn[] = [
  { key: 'corner', label: 'Canto' },
  { key: 'static', label: 'Estático', explain: 'susp.staticHeight' },
  { key: 'minmax', label: 'Mín … máx', explain: 'susp.travelUsed' },
  { key: 'used', label: 'Curso usado', explain: 'susp.travelUsed' },
  { key: 'usedPct', label: '% do curso', explain: 'susp.travelUsed' },
  { key: 'p95C', label: 'Comp. p95', explain: 'susp.velocityP95' },
  { key: 'p95R', label: 'Ext. p95', explain: 'susp.velocityP95' },
  { key: 'lsC', label: 'Comp. lenta', explain: 'susp.velocityBands' },
  { key: 'hsC', label: 'Comp. rápida', explain: 'susp.velocityBands' },
  { key: 'lsR', label: 'Ext. lenta', explain: 'susp.velocityBands' },
  { key: 'hsR', label: 'Ext. rápida', explain: 'susp.velocityBands' },
  { key: 'ratio', label: 'Ext./comp. média', explain: 'susp.reboundRatio' },
];

/* ---------------------------------------------------------------- relatório */
/** Página Suspensão no trecho [i0, i1] (= renderSusp + renderSuspExtra).
 *  Atenção (como no antigo): jumps() grava ext/thr nos amortecedores de ctx.susp. */
export function suspensionReport(ctx: SessionContext, i0: number, i1: number): SuspensionReport {
  const A = ctx, sp = A.cfg.susp, car = A.cfg.car, t = A.S.t;
  const sh = (A.susp || { shocks: [] }).shocks, act = activeOf(sh);
  const moving = sp.moving && A.stopped ? Uint8Array.from(A.stopped, v => 1 - v) : null;
  const knee = +sp.knee || 100;
  const stopS = suspStoppedSensors(A);
  const movingS = moving ? stopS : [];
  const strokeKnown = +car.strokeF > 0 || +car.strokeR > 0;

  const rep: SuspensionReport = {
    hasShocks: act.length > 0,
    empty: null,
    emptySensors: [],
    options: { compPos: !!sp.compPos, knee: sp.knee, moving: !!sp.moving, movingApplied: !!moving },
    table: { explain: 'susp.cornerTable', columns: CORNER_COLUMNS, rows: [], note: '', sensors: [] },
    still: null,
    velHist: [],
    posHist: [],
    velScale: { R: 0, bw: 0, nb: 0 },
    posScale: { lo: 0, w: 0, nb: 0 },
    body: emptyBody(),
    jumps: { explain: 'susp.jumps', sensors: [], list: [], columns: [], rows: [], none: null },
    bottom: { explain: 'susp.bottomOut', sensors: [], strokeKnown, events: [], counts: [], text: '' },
  };
  if (!act.length) {
    rep.empty = suspNoShocksText(sh);
    rep.emptySensors = suspFoundSensors(sh);
    return rep;
  }

  /* ---------- tabela por canto */
  sh.forEach(k => {
    const cornerS = suspCornerSensor(k.id);
    if (!k.active) {
      const note = k.pos ? 'canal constante (sensor sem sinal?)' : 'sem canal no log';
      rep.table.rows.push({ id: k.id, label: k.label, active: false, cells: [`${k.id} · ${k.label}`, note], sensors: [cornerS], explain: 'susp.cornerTable' });
      return;
    }
    const a = k as ActiveShock;
    const pos = a.pos.data;
    let mn = Infinity, mx = -Infinity;
    for (let i = i0; i <= i1; i++) { const v = pos[i]; if (v === v) { if (v < mn) mn = v; if (v > mx) mx = v; } }
    const stroke = a.axle === 'F' ? +car.strokeF : +car.strokeR;
    const vs = velStats(a.v, i0, i1, moving, +sp.knee || 100);
    const used = mx - mn;
    const cells = [
      `${a.id} · ${a.label}`,
      `${fx(a.static)} mm${a.staticFromStop ? '' : '*'}`,
      `${fx(mn)} … ${fx(mx)}`,
      `${fx(used)} mm`,
      stroke > 0 ? pct(used / stroke) : 'informe o curso',
    ];
    if (vs) cells.push(fx(vs.p95C, 0), fx(vs.p95R, 0), pct(vs.lsC), pct(vs.hsC), pct(vs.lsR), pct(vs.hsR), fx(vs.meanR / vs.meanC, 2));
    else cells.push('sem amostras andando');
    rep.table.rows.push({
      id: a.id, label: a.label, active: true, cells, explain: 'susp.cornerTable',
      sensors: suspJoinSensors(cornerS, a.staticFromStop && 'gps', stroke > 0 && 'car_data', movingS),
      static: a.static, staticFromStop: a.staticFromStop, min: mn, max: mx, used, stroke,
      usedFrac: stroke > 0 ? used / stroke : null, vel: vs, vCalc: a.vCalc, still: used < SHOCK_STILL_MM,
    });
  });
  const still = rep.table.rows.filter(r => r.still);
  if (still.length) {
    rep.still = {
      ids: still.map(r => r.id), limit: SHOCK_STILL_MM, explain: 'quality.shockStill',
      sensors: still.map(r => suspCornerSensor(r.id)),
      text: `Amortecedor com sinal mas quase parado (< ${SHOCK_STILL_MM} mm de curso no trecho): ${still.map(r => `${r.id} ${fx(r.used)} mm`).join(', ')}. ` +
        'Potenciômetro solto, travado ou mal calibrado (ou o carro ficou parado neste trecho).',
    };
  }
  rep.table.note = `${car.strokeF > 0 ? '' : 'Informe o curso total dos amortecedores em “Dados do carro” para ver a % usada e as batidas no fim de curso. '}Velocidades em mm/s${act.some(k => k.vCalc) ? ' (derivada da posição onde não há canal de velocidade)' : ''}. ` +
    `Lenta/rápida: abaixo/acima de ${+sp.knee || 100} mm/s, em % do tempo${moving ? ' com o carro andando' : ''}.` +
    (act.some(k => !k.staticFromStop) ? ' * estático pela mediana do log (não achou o carro parado).' : '');
  rep.table.sensors = suspJoinSensors(...rep.table.rows.filter(r => r.active).map(r => r.sensors));

  /* ---------- histogramas (pequenos múltiplos, mesma escala em todos) */
  let R = 0;
  act.forEach(k => {
    const a: number[] = [];
    for (let i = i0; i <= i1; i++) { const v = k.v[i]; if (v === v && (!moving || moving[i])) a.push(Math.abs(v)); }
    a.sort((x, y) => x - y);
    R = Math.max(R, quant(a, 0.995) || 0);
  });
  const step = niceTicks(0, Math.max(R, 10), 12);
  const bw = step.length > 1 ? step[1] - step[0] : 10, nb = Math.ceil(Math.max(R, 10) / bw);
  let dl = 0, dh = 0;
  act.forEach(k => {
    const a: number[] = [];
    for (let i = i0; i <= i1; i++) { const v = k.disp[i]; if (v === v) a.push(v); }
    a.sort((x, y) => x - y);
    dl = Math.min(dl, quant(a, 0.003)); dh = Math.max(dh, quant(a, 0.997));
  });
  const pstep = niceTicks(0, Math.max(dh - dl, 4), 24), pw = pstep.length > 1 ? pstep[1] - pstep[0] : 1;
  const plo = Math.floor(dl / pw) * pw, pnb = Math.max(1, Math.ceil((dh - plo) / pw));
  rep.velScale = { R, bw, nb };
  rep.posScale = { lo: plo, w: pw, nb: pnb };
  act.forEach(k => {
    const title = `${k.id} · ${k.label}`, cs = suspCornerSensor(k.id);
    const hv = hist(k.v, i0, i1, moving, -nb * bw, nb * bw, 2 * nb);
    rep.velHist.push({
      key: 'spv' + k.id, title, explain: 'susp.velocityHistogram', sensors: suspJoinSensors(cs, movingS),
      bars: { x0: hv.lo, w: hv.w, y: hv.y, roles: Array.from(hv.y, (_, j) => (hv.lo + (j + 0.5) * hv.w >= 0 ? 'comp' : 'ext')) },
      legend: [{ label: 'Compressão', role: 'comp' }, { label: 'Extensão', role: 'ext' }],
      markers: [{ x: -knee, role: 'knee' }, { x: knee, role: 'knee' }],
      xLabel: 'mm/s', yLabel: '% do tempo',
      barTips: Array.from(hv.y, (y, j) => ({ title: `${(hv.lo + j * hv.w).toFixed(0)} … ${(hv.lo + (j + 1) * hv.w).toFixed(0)} mm/s`, text: `${y.toFixed(1)} % do tempo` })),
    });
    const hp = hist(k.disp, i0, i1, null, plo, plo + pnb * pw, pnb);
    rep.posHist.push({
      key: 'spp' + k.id, title, explain: 'susp.travelHistogram', sensors: suspJoinSensors(cs, k.staticFromStop && 'gps'),
      bars: { x0: hp.lo, w: hp.w, y: hp.y, roles: Array.from(hp.y, () => k.id) },
      markers: [{ x: 0, role: 'static', label: 'estático' }],
      xLabel: 'mm (+ = comprimido)', yLabel: '% do tempo',
      barTips: Array.from(hp.y, (y, j) => ({ title: `${(hp.lo + j * hp.w).toFixed(1)} … ${(hp.lo + (j + 1) * hp.w).toFixed(1)} mm`, text: `${y.toFixed(1)} % do tempo` })),
    });
  });

  suspExtra(A, i0, i1, rep);
  return rep;
}

function emptyBody(): SuspensionReport['body'] {
  return {
    note: '', noteSensors: [], gradients: {},
    rollTitle: 'Rolagem × aceleração lateral', roll: null,
    rollPlot: { key: 'grRoll', title: 'Rolagem × aceleração lateral', explain: 'susp.rollGradient', sensors: [] },
    pitchTitle: 'Arfagem × aceleração longitudinal', pitchBrake: null, pitchAccel: null,
    pitchPlot: { key: 'grPitch', title: 'Arfagem × aceleração longitudinal', explain: 'susp.pitchGradient', sensors: [] },
  };
}

/* renderSuspExtra: rolagem, arfagem, saltos e fim de curso */
function suspExtra(A: SessionContext, i0: number, i1: number, rep: SuspensionReport): void {
  const car: CarConfig = A.cfg.car, ang = A.ang || ({} as Partial<SessionContext['ang']>), acc = A.acc || {}, t = A.S.t;
  const mv = A.stopped ? Uint8Array.from(A.stopped, x => 1 - x) : null;
  const gr = gradients(ang, acc, mv, i0, i1);
  const act = activeOf(A.susp.shocks);
  const aS = suspAccSensors(A), mvS = mv ? suspStoppedSensors(A) : [];
  const on = (id: CornerId) => act.some(k => k.id === id);
  /* amortecedores que entram em cada ângulo (bodyAngles) */
  const rollShocks: SensorId[] = [];
  if (on('FL') && on('FR')) rollShocks.push('shock_fl', 'shock_fr');
  if (on('RL') && on('RR')) rollShocks.push('shock_rl', 'shock_rr');
  const pitchShocks = act.map(k => suspCornerSensor(k.id));
  const body = rep.body;
  body.gradients = gr;
  body.note = (ang.mrKnown ? '' : 'Relação roda/amortecedor não informada: os ângulos saem com o curso do amortecedor (ficam menores que os reais). ') +
    `Acelerações ${acc.src || '—'}. Bitola ${car.trackF}/${car.trackR} mm, entre-eixos ${car.wb} mm.`;
  body.noteSensors = suspJoinSensors(aS.lon, aS.lat, 'car_data');
  const sample = (xa: ArrayLike<number>, ya: ArrayLike<number>, m: ((i: number) => boolean) | null) => {
    const x: number[] = [], y: number[] = [];
    for (let i = i0; i <= i1; i += 2) if (ok(xa[i]) && ok(ya[i]) && (!m || m(i))) { x.push(xa[i]); y.push(ya[i]); }
    return { x: Float64Array.from(x), y: Float64Array.from(y) };
  };
  const line = (f: LinFit, a: number, b: number, id: string, label: string): SuspSeries =>
    ({ id, x: Float64Array.from([a, b]), y: Float64Array.from([f.slope * a + f.icpt, f.slope * b + f.icpt]), label, width: 2.5 });

  const rollS = suspJoinSensors(rollShocks, aS.lat, 'car_data', mvS);
  if (ang.roll && acc.lat) {
    const p = sample(acc.lat, ang.roll, i => !mv || !!mv[i]);
    const lim = Math.max(0.3, ...Array.from(p.x).map(Math.abs).filter(ok).sort((a, b) => b - a).slice(0, Math.ceil(p.x.length * 0.01) + 1));
    body.roll = gr.roll || null;
    body.rollTitle = gr.roll ? `Rolagem × aceleração lateral: ${gr.roll.slope.toFixed(2)} °/g (R² ${gr.roll.r2.toFixed(2)})` : 'Rolagem × aceleração lateral';
    body.rollPlot = {
      key: 'grRoll', title: body.rollTitle, explain: 'susp.rollGradient', sensors: rollS,
      points: { x: p.x, y: p.y, alpha: 0.2 }, series: gr.roll ? [line(gr.roll, -lim, lim, 'fit', `${gr.roll.slope.toFixed(2)} °/g`)] : [],
      xLabel: 'aceleração lateral (g, + direita)', yLabel: 'rolagem (°, + esq. comprimida)', xRange: [-lim, lim], legend: [],
    };
  } else {
    body.rollTitle = 'Rolagem × aceleração lateral';
    body.rollPlot = { key: 'grRoll', title: body.rollTitle, explain: 'susp.rollGradient', sensors: rollS, empty: 'precisa dos dois amortecedores de um eixo e de aceleração lateral' };
  }
  const pitchS = suspJoinSensors(ang.pitch ? pitchShocks : [], aS.lon, 'car_data', mvS);
  if (ang.pitch && acc.lon) {
    const p = sample(acc.lon, ang.pitch, i => !mv || !!mv[i]);
    let lo = -0.3, hi = 0.3;
    for (const x of p.x) { if (x < lo) lo = x; if (x > hi) hi = x; }
    const s: SuspSeries[] = [];
    if (gr.pitchBrake) s.push(line(gr.pitchBrake, lo, 0, 'brake', 'frenagem'));
    if (gr.pitchAccel) s.push(line(gr.pitchAccel, 0, hi, 'accel', 'aceleração'));
    body.pitchBrake = gr.pitchBrake || null;
    body.pitchAccel = gr.pitchAccel || null;
    body.pitchTitle = 'Arfagem × aceleração longitudinal: ' +
      (gr.pitchBrake ? `frenagem ${Math.abs(gr.pitchBrake.slope).toFixed(2)} °/g ` : '') +
      (gr.pitchAccel ? `· aceleração ${Math.abs(gr.pitchAccel.slope).toFixed(2)} °/g` : '');
    body.pitchPlot = {
      key: 'grPitch', title: body.pitchTitle, explain: 'susp.pitchGradient', sensors: pitchS,
      points: { x: p.x, y: p.y, alpha: 0.2 }, series: s, xLabel: 'aceleração longitudinal (g, + acelerando)', yLabel: 'arfagem (°, + frente baixa)',
    };
  } else {
    body.pitchTitle = 'Arfagem × aceleração longitudinal';
    body.pitchPlot = { key: 'grPitch', title: body.pitchTitle, explain: 'susp.pitchGradient', sensors: pitchS, empty: 'precisa de amortecedor na frente e atrás e de aceleração longitudinal' };
  }

  /* ---------- saltos e fim de curso */
  const J = A.veh ? jumps(t, A.susp, A.veh, car, i0, i1) : [];
  const B = bottomOuts(t, A.susp, car, i0, i1);
  const strokeKnown = +car.strokeF > 0 || +car.strokeR > 0;
  const shockS = act.map(k => suspCornerSensor(k.id));
  /* o estático medido com o carro parado (GPS) entra no limiar de "no ar" dos saltos (o
   * deslocamento é relativo a ele); o fim de curso usa a posição absoluta = estático +
   * deslocamento, em que o estático cancela com compPos e só conta com a compressão
   * invertida (2·estático − posição) */
  const staticS = act.some(k => k.staticFromStop) && 'gps';
  const absS = !A.cfg.susp.compPos && staticS;
  const jp = rep.jumps;
  jp.list = J;
  jp.sensors = suspJoinSensors(shockS, staticS, suspSpeedSensors(A), strokeKnown && 'car_data', A.veh && A.veh.slip ? ['wheel', 'gps'] : []);
  jp.columns = [
    { key: 'n', label: '#' }, { key: 't', label: 't' }, { key: 'v', label: 'Vel.', explain: 'susp.jumps' },
    { key: 'T', label: 'No ar', explain: 'susp.jumps' }, { key: 'h', label: 'Altura', explain: 'susp.jumps' },
    { key: 'vland', label: 'V pouso', explain: 'susp.jumps' },
    ...act.map(k => ({ key: 'shock' + k.id, label: `${k.id}: vel. / curso`, explain: 'susp.jumps' })),
    { key: 'over', label: 'Roda disparou', explain: 'susp.jumps' },
  ];
  const rowS = suspJoinSensors(shockS, staticS, suspSpeedSensors(A), strokeKnown && 'car_data');
  J.forEach((j, n) => {
    jp.rows.push({
      n: n + 1, t: j.t0, seekT: j.t0 - 0.5, jump: j,
      sensors: suspJoinSensors(rowS, ok(j.over) ? ['wheel', 'gps'] : []),
      cells: [String(n + 1), `${j.t0.toFixed(1)} s`, `${j.v.toFixed(0)} km/h`, `${(j.T * 1000).toFixed(0)} ms`,
        `${(j.h * 100).toFixed(0)} cm`, `${j.vland.toFixed(2)} m/s`,
        ...act.map(k => { const s = j.shock[k.id]!; return `${s.vmax.toFixed(0)} mm/s · ${s.travel.toFixed(0)} mm${s.bottom ? ' ⚠ fim' : ''}`; }),
        ok(j.over) ? '+' + (j.over * 100).toFixed(0) + ' %' : '—'],
    });
  });
  jp.none = J.length ? null : 'Nenhum salto detectado neste trecho.';

  const bo = rep.bottom;
  bo.strokeKnown = strokeKnown;
  bo.events = B;
  bo.counts = act.map(k => ({ id: k.id, n: B.filter(b => b.id === k.id).length }));
  bo.sensors = strokeKnown ? suspJoinSensors(shockS, absS, 'car_data') : suspJoinSensors(shockS);
  bo.text = strokeKnown
    ? `Fim de curso (≥ 95 % do curso total): ${act.map(k => `${k.id} ${B.filter(b => b.id === k.id).length}×`).join(' · ')}.`
    : 'Informe o curso total dos amortecedores em “Dados do carro” para contar as batidas no fim de curso.';
}
