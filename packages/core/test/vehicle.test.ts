/* Equivalência de vehicle.ts com legacy/js/vehicle.js: veículo (roda × GPS, aceleração,
 * potência), largadas, curva de potência, coast-down, modelo térmico da CVT, ângulos da
 * carroceria, gradientes, saltos, fim de curso, rugosidade e espectro da pista, chamados
 * como vehicleui.js chama, em vários trechos e com vários carros. O estado da sessão é
 * montado igual ao recompute() do app antigo (mesma réplica de analysis.test.ts). */
import { describe, it, expect } from 'vitest';
import { loadLegacy, legacyCompute, readFixture, DEMO_CAR as LEGACY_DEMO_CAR, type LegacyState } from './legacy';
import { same } from './compare';
import { parseLog, parseCSV, finishChannel } from '../src/parsers';
import { DEFAULT_CFG, guessGpsChannels, computeTrack, computeLaps, autoLine, smooth } from '../src/gps';
import { idxAt } from '../src/util';
import { demoCSV, DEMO_CAR } from '../src/demo';
import {
  DEFAULT_SUSP, stoppedMask, suspPrep, gpsDynamics, deltaToBest, localPeaks, quant, dropTests, type ActiveShock, type Shock,
} from '../src/analysis';
import {
  DEFAULT_CAR, findWheelCh, findCvtCh, lstsq, linFit, vehPrep, launches, powerCurve, coastFit, findCoasts, cvtFit, bodyAngles,
  gradients, jumps, bottomOuts, roughness, roadSpectrum, type VehMotion,
} from '../src/vehicle';
import type { AnalysisConfig, CarConfig, Channel, Session } from '../src/types';

const { BT } = loadLegacy();

/* ------------------------------------------------------------------ estado novo (= legacyCompute) */
function recomputeNew(S: Session, cfg: AnalysisConfig): any {
  const A: any = { S, cfg, sel: -1 };
  A.track = computeTrack(S, cfg);
  A.laps = computeLaps(S, A.track, cfg.line || null, +cfg.minLap || 10);
  A.stopped = stoppedMask(S, A.track);
  A.dyn = A.track.ok ? gpsDynamics(S, A.track) : null;
  A.veh = vehPrep(S, A.track, cfg.car, A.dyn);
  if (!A.stopped && A.veh.v) A.stopped = Uint8Array.from(smooth(S.t, A.veh.v, 1), x => (x === x && x < 0.8 ? 1 : 0));
  A.acc = {
    lon: A.veh.ax || (A.dyn && A.dyn.along), lat: (A.veh.wheel && A.veh.ay) || (A.dyn && A.dyn.alat),
    src: A.veh.wheel ? 'longitudinal pela velocidade da roda, lateral = velocidade da roda × guinada do GPS' : 'pela trajetória do GPS',
  };
  A.susp = suspPrep(S, A.track, cfg.susp);
  A.ang = bodyAngles(A.susp, cfg.car);
  const SG = 'Suspensão (calculado)';
  const sc = (key: string, name: string, unit: string, data: Float64Array) => finishChannel({ key, name, unit, data, src: 'calc', group: SG });
  if (A.ang.pitch) A.susp.channels.push(sc('susp:pitch', 'Arfagem (+ = frente baixa)', '°', A.ang.pitch));
  if (A.ang.rollF) A.susp.channels.push(sc('susp:rollF', 'Rolagem diant. (+ = esq. comprimida)', '°', A.ang.rollF));
  if (A.ang.rollR) A.susp.channels.push(sc('susp:rollR', 'Rolagem tras. (+ = esq. comprimida)', '°', A.ang.rollR));
  const rough = roughness(S.t, A.susp);
  if (rough) A.susp.channels.push(sc('susp:rough', 'Rugosidade (vel. amortecedores RMS 1 s)', 'mm/s', rough));
  const derived: Channel[] = [];
  const tr = A.track;
  if (tr.ok) {
    const mk = (key: string, name: string, unit: string, data: Float64Array) => derived.push(finishChannel({ key, name, unit, data, src: 'gps' }));
    const lapTime = () => {
      const t = S.t, o = new Float64Array(t.length).fill(NaN);
      A.laps.forEach((l: any) => { for (let i = l.i0; i <= l.i1; i++) o[i] = t[i] - l.t0; });
      return o;
    };
    mk('gps:speed', 'GPS · Velocidade', 'km/h', tr.speed);
    mk('gps:lap', 'Tempo na volta', 's', lapTime());
    mk('gps:x', 'GPS · X Leste', 'm', tr.x);
    mk('gps:y', 'GPS · Y Norte', 'm', tr.y);
    mk('gps:dist', 'GPS · Distância', 'm', tr.dist);
    if (A.laps.length >= 2) mk('gps:delta', 'Delta p/ melhor volta', 's', deltaToBest(S, tr, A.laps));
    if (A.dyn) A.dyn.channels.forEach((c: Channel) => { if (!(A.veh && A.veh.wheel && /gps:a(lon|lat)g?/.test(c.key))) derived.push(c); });
    if (S.gps) {
      mk('gps:cx', 'Código X (calculado)', '', tr.codeX);
      mk('gps:cy', 'Código Y (calculado)', '', tr.codeY);
    }
  }
  A.all = derived.concat(A.veh.channels, A.susp.channels, S.channels);
  A.all.forEach((c: Channel) => { c.group = c.group || (c.src === 'gps' ? 'Calculados do GPS' : 'Do log'); });
  return A;
}

function computeNew(S: Session, cfgIn: any = {}, opts: { autoLine?: boolean } = {}): any {
  const cfg: any = Object.assign({}, DEFAULT_CFG, cfgIn);
  cfg.susp = Object.assign({}, DEFAULT_SUSP, cfgIn.susp || {});
  cfg.car = Object.assign({}, DEFAULT_CAR, cfgIn.car || {});
  ['strokeF', 'strokeR', 'massF', 'massR', 'mrF', 'mrR'].forEach(k => {
    if (!(+cfg.car[k] > 0) && +cfg.susp[k] > 0) cfg.car[k] = +cfg.susp[k];
    delete cfg.susp[k];
  });
  const keys = S.channels.map(c => c.key);
  if (!S.gps && (!keys.includes(cfg.chX) || !keys.includes(cfg.chY))) {
    const g = guessGpsChannels(keys);
    cfg.chX = g.x; cfg.chY = g.y; cfg.chStatus = g.status;
  }
  if (cfg.chStatus && !keys.includes(cfg.chStatus)) cfg.chStatus = '';
  let A = recomputeNew(S, cfg);
  if (opts.autoLine && !cfg.line) {
    const l = autoLine(S, A.track);
    if (l) {
      cfg.line = l.map(p => ({ x: +p.x.toFixed(2), y: +p.y.toFixed(2) }));
      A = recomputeNew(S, cfg);
    }
  }
  return A;
}

/* ------------------------------------------------------------------ sessões */
interface Case { label: string; O: LegacyState; N: any }
function makeCases(): Case[] {
  const out: Case[] = [];
  {
    const So = BT.parseCSV(BT.demoCSV(), 'exemplo_baja.csv'); So.demo = true;
    const Sn = parseCSV(demoCSV(), 'exemplo_baja.csv'); Sn.demo = true;
    out.push({ label: 'exemplo', O: legacyCompute(BT, So, { car: LEGACY_DEMO_CAR }, { autoLine: true }), N: computeNew(Sn, { car: DEMO_CAR }, { autoLine: true }) });
  }
  /* variações do exemplo tirando sensores: os caminhos sem roda (velocidade do GPS), sem GPS
   * (parado pela roda), com só um lado e com a suspensão invertida e outro carro */
  const variants: [string, (k: string) => boolean, any][] = [
    ['exemplo sem roda', k => k !== 'Wheel_speed', { car: DEMO_CAR }],
    ['exemplo sem GPS', k => k !== 'O2_General' && k !== 'Back_pressure', { car: DEMO_CAR }],
    ['exemplo só FL e RL, sem vel. da FT', k => !/Right|velocity/.test(k), { car: { ...DEMO_CAR, mrF: 0 } }],
    ['exemplo só a frente', k => !/Rear|_R[LR]$/.test(k), { car: DEFAULT_CAR, susp: { compPos: false, strokeF: 120 } }],
    ['exemplo roda livre, sem CVT', k => k !== 'CVT_temp', { car: { ...DEMO_CAR, wheelDriven: false, mass: 0, rho: 0 } }],
  ];
  for (const [label, keep, cfg] of variants) {
    const So = BT.parseCSV(BT.demoCSV(), 'exemplo_baja.csv'); So.demo = true;
    const Sn = parseCSV(demoCSV(), 'exemplo_baja.csv'); Sn.demo = true;
    So.channels = So.channels.filter((c: any) => keep(c.key)); Sn.channels = Sn.channels.filter(c => keep(c.key));
    out.push({ label, O: legacyCompute(BT, So, cfg, { autoLine: true }), N: computeNew(Sn, cfg, { autoLine: true }) });
  }
  for (const f of ['ft_log3_gps.csv', 'ft_log3_shocks_compact.csv', 'busmaster_14.log', 'Log 3_20261005-1648_20261005-1651.csv']) {
    const text = readFixture(f);
    if (text === null) continue;
    out.push({ label: f, O: legacyCompute(BT, BT.parseLog(text, f), {}, { autoLine: true }), N: computeNew(parseLog(text, f), {}, { autoLine: true }) });
  }
  return out;
}
const CASES = makeCases();

/* trechos como Analysis.range(): sessão, voltas, janela do gráfico, curto, um ponto, vazio */
function windows(N: any): [string, number, number][] {
  const t: Float64Array = N.S.t, n = t.length, out: [string, number, number][] = [['sessão', 0, n - 1]];
  N.laps.slice(0, 6).forEach((l: any) => out.push([`volta ${l.n}`, l.i0, l.i1]));
  out.push(['janela do meio', Math.floor(n / 3), Math.floor(2 * n / 3)]);
  const t0 = t[0] + (t[n - 1] - t[0]) * 0.2, t1 = t0 + 30;
  out.push(['janela 30 s', idxAt(t, t0), idxAt(t, t1)]);
  const m = n >> 1;
  out.push(['curto', m, Math.min(n - 1, m + 10)], ['um ponto', m, m], ['vazio', m, m - 1]);
  return out;
}

/* chama as duas e compara (resultado, ou os dois lançam erro) */
function eq(at: string, fo: () => unknown, fn: () => unknown, opts?: Parameters<typeof same>[2]): void {
  let ro: unknown, rn: unknown, eo: unknown = null, en: unknown = null;
  try { ro = fo(); } catch (e) { eo = e; }
  try { rn = fn(); } catch (e) { en = e; }
  expect(en ? `erro: ${(en as Error).message}` : 'ok', at).toBe(eo ? `erro: ${(eo as Error).message}` : 'ok');
  if (!eo) expect(same(ro, rn, opts), at).toEqual([]);
}

const actOf = (shocks: Shock[]) => shocks.filter((k): k is ActiveShock => k.active);

/* carros para as variações: o do exemplo, o padrão, sem MR, curso pequeno (bate no fim),
 * roda livre, números como texto (vêm assim do formulário do app antigo) */
const CARS: [string, any][] = [
  ['exemplo', { ...DEFAULT_CAR, ...DEMO_CAR }],
  ['padrão', { ...DEFAULT_CAR }],
  ['sem MR, curso 40', { ...DEFAULT_CAR, ...DEMO_CAR, mrF: 0, mrR: 0, strokeF: 40, strokeR: 35 }],
  ['roda livre, texto', { ...DEFAULT_CAR, ...DEMO_CAR, wheelDriven: false, mass: '300', rho: '', crr: '0.07', cda: '1.1', power: '', tAmb: '35', tCvtMax: '90', endurance: '' }],
  ['enduro curto, motor forte', { ...DEFAULT_CAR, ...DEMO_CAR, endurance: 10, power: 12, tCvtMax: 60, trackF: 1400, wb: 1700 }],
];

describe('vehicle: constantes e utilidades', () => {
  it('DEFAULT_CAR', () => {
    expect(same(BT.DEFAULT_CAR, DEFAULT_CAR)).toEqual([]);
  });

  it('findWheelCh e findCvtCh', () => {
    const names = ['Wheel_speed', 'speed wheel', 'Vel_roda', 'velocidade da roda', 'roda_tras', 'Hall', 'Sensor hall 2', 'CVT_temp', 'Temp correia',
      'belt', 'CVT rpm', 'Back_pressure', 'carroda', 'cvt_temp_2'];
    const mk = (key: string, k: number, constant: boolean, src: 'log' | 'calc' = 'log') =>
      finishChannel({ key, name: key, unit: '', data: Float64Array.from({ length: 6 }, (_, i) => (constant ? 3 : i + k)), src });
    const lists: Channel[][] = [
      names.map((n, k) => mk(n, k, false)),
      names.map((n, k) => mk(n, k, k % 2 === 0)),
      names.map((n, k) => mk(n, k, true)),
      names.map((n, k) => mk(n, k, false, 'calc')),
      names.slice(8).map((n, k) => mk(n, k, k === 0)),
      [],
    ];
    for (const l of lists) {
      expect(same(BT.findWheelCh(l), findWheelCh(l))).toEqual([]);
      expect(same(BT.findCvtCh(l), findCvtCh(l))).toEqual([]);
    }
    for (const c of CASES) {
      eq(`${c.label} findWheelCh`, () => BT.findWheelCh(c.O.S.channels), () => findWheelCh(c.N.S.channels));
      eq(`${c.label} findCvtCh`, () => BT.findCvtCh(c.O.S.channels), () => findCvtCh(c.N.S.channels));
    }
  });

  it('lstsq e linFit', () => {
    const rows = (n: number, p: number, f: (r: number, i: number) => number) => Array.from({ length: n }, (_, r) => Array.from({ length: p }, (_, i) => f(r, i)));
    const Xs: number[][][] = [
      rows(50, 2, (r, i) => (i ? 1 : r * 0.3)),
      rows(50, 3, (r, i) => Math.sin(r * (i + 1) * 0.7) + i),
      rows(50, 2, () => 1),                                      /* singular */
      rows(5, 1, r => r),
      rows(1, 1, () => 0),
      rows(30, 3, (r, i) => (i === 2 ? 0 : r + i)),              /* coluna zero */
      rows(30, 2, (r, i) => (i ? 2 * r : r)),                    /* colunas proporcionais */
    ];
    for (const X of Xs) for (const y of [X.map((_, r) => r * 0.5 + Math.cos(r)), X.map(() => 7), X.map((_, r) => (r % 2 ? NaN : r))])
      eq('lstsq', () => BT.lstsq(X, y), () => lstsq(X, y));
    eq('lstsq vazio', () => BT.lstsq([], []), () => lstsq([], []));
    const x = Float64Array.from({ length: 60 }, (_, i) => (i - 30) / 50), y = Float64Array.from(x, (v, i) => 3.2 * v + 0.4 + ((i * 7) % 5) * 0.01);
    const yn = Float64Array.from(y, (v, i) => (i % 4 ? v : NaN)), mask = Uint8Array.from(x, v => (Math.abs(v) > 0.2 ? 1 : 0));
    for (const yy of [y, yn]) for (const m of [undefined, null, mask, new Uint8Array(60)]) {
      eq('linFit', () => BT.linFit(x, yy, m), () => linFit(x, yy, m));
      eq('linFit 19', () => BT.linFit(x.subarray(0, 19), yy.subarray(0, 19), m), () => linFit(x.subarray(0, 19), yy.subarray(0, 19), m));
    }
    eq('linFit constante', () => BT.linFit(new Float64Array(30).fill(1), y, null), () => linFit(new Float64Array(30).fill(1), y, null));
  });
});

describe('vehicle: largadas e coast-down sintéticos (limiares)', () => {
  const dt = 0.04;
  /* perfil por trechos: [duração s, aceleração m/s², ruído na aceleração (g)] a partir de v = 0 */
  const build = (segs: [number, number, number][]) => {
    const t: number[] = [], v: number[] = [], ax: number[] = [];
    let x = 0, tt = 0, k = 0;
    for (const [dur, a, nz] of segs) for (let s = 0; s < dur - 1e-9; s += dt) {
      x = Math.max(0, x + a * dt);
      t.push(tt); v.push(x); ax.push(a / 9.81 + nz * Math.sin(k * 1.7)); tt += dt; k++;
    }
    const d = [0];
    for (let i = 1; i < v.length; i++) d.push(d[i - 1] + (v[i] + v[i - 1]) / 2 * dt);
    return { t: Float64Array.from(t), v: Float64Array.from(v), ax: Float64Array.from(ax), d: Float64Array.from(d) };
  };
  it('launches', () => {
    for (const stop of [0.5, 0.76, 0.8, 0.84, 2]) for (const acc of [0.8, 2.5, 6]) {
      const p = build([[stop, 0, 0], [12, acc, 0], [3, -4, 0], [stop, 0, 0], [1.2, acc, 0], [0.4, -8, 0], [3, 0, 0], [25, 0.6, 0]]);
      const slip = Float64Array.from(p.v, (x, i) => (i % 9 ? 0.1 + x / 50 : NaN));
      for (const s of [slip, null, undefined]) eq(`stop ${stop} acc ${acc}`, () => BT.launches(p.t, p.v, p.d, s, p.ax), () => launches(p.t, p.v, p.d, s, p.ax));
    }
  });
  it('findCoasts e coastFit', () => {
    for (const dur of [3.9, 4.0, 4.2, 8]) for (const nz of [0, 0.02, 0.04, 0.05, 0.055, 0.06]) for (const dec of [-0.1, -0.5, -1, -1.5, -2.5]) {
      const p = build([[2, 0, 0], [6, 2.5, 0], [dur, dec, nz], [1, -6, 0], [2, 0, 0]]);
      const n = p.t.length;
      for (const [i0, i1] of [[0, n - 1], [10, n - 20], [200, 210]])
        eq(`dur ${dur} nz ${nz} dec ${dec}`, () => BT.findCoasts(p.t, p.v, p.ax, i0, i1), () => findCoasts(p.t, p.v, p.ax, i0, i1));
      const a = Float64Array.from(p.ax, x => x * 9.81);
      eq('coastFit', () => BT.coastFit(p.v, a, 0, n - 1, 260, 1.15), () => coastFit(p.v, a, 0, n - 1, 260, 1.15));
    }
  });
});

describe('vehicle: vehPrep e bodyAngles com outros carros', () => {
  for (const c of CASES) {
    it(c.label, () => {
      const { O, N } = c;
      for (const [cl, car] of CARS) {
        for (const wheelCh of ['', 'Wheel_speed', 'Shock_-_Front_Left', 'nao_existe']) for (const cvtCh of ['', 'O2_General']) {
          const carX = { ...car, wheelCh, cvtCh };
          eq(`${c.label} vehPrep ${cl} ${wheelCh} ${cvtCh}`, () => BT.vehPrep(O.S, O.track, carX, O.dyn), () => vehPrep(N.S, N.track, carX, N.dyn));
        }
        eq(`${c.label} vehPrep ${cl} sem dyn`, () => BT.vehPrep(O.S, O.track, car, null), () => vehPrep(N.S, N.track, car, null));
        eq(`${c.label} vehPrep ${cl} sem GPS`, () => BT.vehPrep(O.S, null, car, null), () => vehPrep(N.S, null, car, null));
        eq(`${c.label} bodyAngles ${cl}`, () => BT.bodyAngles(O.susp, car), () => bodyAngles(N.susp, car));
      }
      eq(`${c.label} bodyAngles sem amortecedores`, () => BT.bodyAngles({ shocks: [] }, DEFAULT_CAR), () => bodyAngles({ shocks: [] }, DEFAULT_CAR));
      eq(`${c.label} roughness`, () => BT.roughness(O.S.t, O.susp), () => roughness(N.S.t, N.susp));
      eq(`${c.label} roughness vazio`, () => BT.roughness(O.S.t, { shocks: [] }), () => roughness(N.S.t, { shocks: [] }));
    });
  }
});

describe('vehicle: funções nos trechos (como vehicleui.js)', () => {
  for (const c of CASES) {
    it(c.label, () => {
      const { O, N } = c;
      const tO = O.S.t, tN: Float64Array = N.S.t, n = tN.length;
      const mvO = O.stopped ? Uint8Array.from(O.stopped, (x: number) => 1 - x) : null;
      const mvN = N.stopped ? Uint8Array.from(N.stopped as Uint8Array, x => 1 - x) : null;
      const vehO = O.veh, vehN = N.veh as VehMotion;
      const car: CarConfig = N.cfg.car;
      /* temperaturas para o modelo da CVT: o canal da CVT (se houver), uma curva sintética
       * (aquece com a potência, esfria para o ambiente) e uma constante */
      const Ts: [string, Float64Array][] = [];
      if (vehN.cvt) Ts.push(['CVT', vehN.cvt.data]);
      if (vehN.v) {
        const T = new Float64Array(n);
        T[0] = 35;
        for (let i = 1; i < n; i++) T[i] = T[i - 1] + (tN[i] - tN[i - 1]) * (0.04 * Math.max(0, vehN.P[i] || 0) - 0.01 * (T[i - 1] - 28)) + ((i * 13) % 7 - 3) * 0.01;
        Ts.push(['sintética', T]);
      }
      Ts.push(['constante', new Float64Array(n).fill(50)]);
      for (const [wl, i0, i1] of windows(N)) {
        const at = `${c.label} · ${wl}`;
        if (vehN.v) {
          /* trem de força (renderPower / renderCoast / showCoast) */
          for (const bw of [2, 5]) for (const sl of [true, false])
            eq(`${at} powerCurve ${bw} ${sl}`, () => BT.powerCurve(vehO.v, vehO.P, vehO.ax, i0, i1, bw, sl ? vehO.slip : null),
              () => powerCurve(vehN.v, vehN.P, vehN.ax, i0, i1, bw, sl ? vehN.slip : null));
          eq(`${at} powerCurve padrão`, () => BT.powerCurve(vehO.v, vehO.P, vehO.ax, i0, i1), () => powerCurve(vehN.v, vehN.P, vehN.ax, i0, i1));
          for (const dk of ['track', 'veh']) {
            const dO = dk === 'track' && O.track.ok ? O.track.dist : vehO.dist, dN = dk === 'track' && N.track.ok ? N.track.dist : vehN.dist;
            eq(`${at} launches ${dk}`, () => BT.launches(tO, vehO.v, dO, vehO.slip, vehO.ax).filter((l: any) => l.t0 >= tO[i0] && l.t0 <= tO[i1]),
              () => launches(tN, vehN.v, dN, vehN.slip, vehN.ax).filter(l => l.t0 >= tN[i0] && l.t0 <= tN[i1]));
            eq(`${at} launches ${dk} sem slip`, () => BT.launches(tO, vehO.v, dO, null, vehO.ax), () => launches(tN, vehN.v, dN, null, vehN.ax));
          }
          eq(`${at} findCoasts`, () => BT.findCoasts(tO, vehO.v, vehO.ax, i0, i1), () => findCoasts(tN, vehN.v, vehN.ax, i0, i1));
          const co = findCoasts(tN, vehN.v, vehN.ax, i0, i1);
          for (const s of [...co, { i0, i1 }])
            for (const [m, rho] of [[+car.mass, +car.rho], [300, 1.2], [0, 0]])
              eq(`${at} coastFit ${s.i0}-${s.i1} ${m}`, () => BT.coastFit(vehO.v, vehO.a, s.i0, s.i1, m, rho), () => coastFit(vehN.v, vehN.a, s.i0, s.i1, m, rho));
          /* CVT (renderCvt) */
          for (const [tl, T] of Ts) for (const [cl, cx] of [['carro da sessão', car], ...CARS.slice(3)] as [string, any][])
            eq(`${at} cvtFit ${tl} ${cl}`, () => BT.cvtFit(tO, T, vehO.v, vehO.P, cx, i0, i1), () => cvtFit(tN, T, vehN.v, vehN.P, cx, i0, i1));
        }
        /* suspensão × dinâmica (renderSuspExtra) */
        for (const mv of [true, false]) {
          eq(`${at} gradients ${mv}`, () => BT.gradients(O.ang || {}, O.acc || {}, mv ? mvO : null, i0, i1), () => gradients(N.ang || {}, N.acc || {}, mv ? mvN : null, i0, i1));
          eq(`${at} gradients vazio ${mv}`, () => BT.gradients({}, {}, mv ? mvO : null, i0, i1), () => gradients({}, {}, mv ? mvN : null, i0, i1));
        }
        for (const [cl, cx] of CARS) {
          eq(`${at} jumps ${cl}`, () => BT.jumps(tO, O.susp, O.veh, cx, i0, i1), () => jumps(tN, N.susp, N.veh, cx, i0, i1));
          eq(`${at} bottomOuts ${cl}`, () => BT.bottomOuts(tO, O.susp, cx, i0, i1), () => bottomOuts(tN, N.susp, cx, i0, i1));
        }
        eq(`${at} jumps sem v`, () => BT.jumps(tO, O.susp, {}, car, i0, i1), () => jumps(tN, N.susp, {}, car, i0, i1));
        expect(same(O.susp, N.susp), `${at} susp depois de jumps (ext/thr)`).toEqual([]);
        /* pista × ressonância (renderRoadRes e ficha) */
        const actO = O.susp.shocks.filter((k: any) => k.active), actN = N.susp.shocks.filter((k: Shock): k is ActiveShock => k.active);
        const dists: [string, any, any][] = [];
        if (vehN.dist) dists.push(['veh', vehO.dist, vehN.dist]);
        if (N.track.ok) dists.push(['track', O.track.dist, N.track.dist]);
        if (mvN && actN.length) for (const [dl, dO, dN] of dists) {
          const sO = actO.map((k: any) => k.disp), sN = actN.map((k: ActiveShock) => k.disp);
          for (const ds of [0.25, 0.5]) {
            eq(`${at} roadSpectrum ${dl} ${ds}`, () => BT.roadSpectrum(sO, dO, mvO, i0, i1, ds), () => roadSpectrum(sN, dN, mvN, i0, i1, ds));
            eq(`${at} roadSpectrum um ${dl} ${ds}`, () => BT.roadSpectrum(sO.slice(0, 1), dO, mvO, i0, i1, ds), () => roadSpectrum(sN.slice(0, 1), dN, mvN, i0, i1, ds));
          }
          const r = roadSpectrum(sN, dN, mvN, i0, i1), rO = BT.roadSpectrum(sO, dO, mvO, i0, i1);
          if (r) for (const mx of [5, 3]) eq(`${at} localPeaks pista ${dl}`, () => BT.localPeaks(rO.f, rO.p, 1 / 16, 1 / 0.8, mx), () => localPeaks(r.f, r.p, 1 / 16, 1 / 0.8, mx));
          eq(`${at} roadSpectrum padrão`, () => rO, () => r);
          eq(`${at} roadSpectrum nenhum`, () => BT.roadSpectrum([], dO, mvO, i0, i1), () => roadSpectrum([], dN, mvN, i0, i1));
        }
      }
    });
  }
});

describe('vehicle: sanidade no exemplo (tabela de validação do legacy/README.md)', () => {
  const N = CASES.find(c => c.label === 'exemplo')!.N;
  const t: Float64Array = N.S.t, n = t.length, veh = N.veh as VehMotion, car: CarConfig = N.cfg.car;

  it('erro do sensor de roda (+3 % no modelo, +2,8 % no app)', () => {
    expect(veh.kN).toBeGreaterThan(0);
    expect(((1 / veh.k - 1) * 100).toFixed(1)).toBe('2.8');
  });

  it('potência na roda (5,5 kW no modelo, 5,4–5,9 no app) e força de tração (1222 N, app 1230 N)', () => {
    const pc = powerCurve(veh.v, veh.P, veh.ax, 0, n - 1, 2, veh.slip);
    let pmax = 0;
    pc.y.forEach(y => { if (y > pmax) pmax = y; });
    expect(pmax).toBeGreaterThan(5.3);
    expect(pmax).toBeLessThan(6.0);
    const accs: number[] = [];
    for (let i = 0; i < n; i++) if (veh.ax[i] > 0.05) accs.push(veh.ax[i]);
    accs.sort((a, b) => a - b);
    const Ftr = (+car.mass) * quant(accs, 0.98) * 9.81;
    expect(Math.abs(Ftr - 1230)).toBeLessThan(25);
  });

  it('Crr pelo coast-down (0,06 no modelo, 0,062 no app)', () => {
    const co = findCoasts(t, veh.v, veh.ax, 0, n - 1);
    expect(co.length).toBeGreaterThan(0);
    const f = coastFit(veh.v, veh.a, co[0].i0, co[0].i1, +car.mass, +car.rho)!;
    expect(f.crr.toFixed(3)).toBe('0.062');
  });

  it('ondulação da pista (3,2 m)', () => {
    const act = N.susp.shocks.filter((k: Shock): k is ActiveShock => k.active);
    const mv = Uint8Array.from(N.stopped as Uint8Array, x => 1 - x);
    const rs = roadSpectrum(act.map((k: ActiveShock) => k.disp), veh.dist, mv, 0, n - 1)!;
    const pk = localPeaks(rs.f, rs.p, 1 / 16, 1 / 0.8, 3).map(p => 1 / p.f);
    /* as costelas de 3,2 m aparecem entre as 3 ondulações dominantes (a maior é a do traçado) */
    expect(pk.map(l => l.toFixed(1))).toContain('3.2');
  });

  it('modelo térmico da CVT fecha no exemplo e há teste de queda', () => {
    const r = cvtFit(t, veh.cvt!.data, veh.v, veh.P, car, 0, n - 1);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.r2).toBeGreaterThan(0.5);
    expect(dropTests(t, N.susp.shocks, N.stopped, 0, n - 1).length).toBeGreaterThan(0);
  });
});
